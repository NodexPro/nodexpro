import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { supabaseAdmin } from '../../db/client.js';
import { resolvePersistedUiLanguage } from '../platform-localization/platform-localization.pure.js';
import { resolvePlatformSellerVat } from '../billing/platform-seller-vat.service.js';
import {
  OWNER_TAX_CATEGORIES,
  OWNER_TAXES_AGGREGATE_KEY,
  buildOwnerTaxRuleRows,
  ownerTaxCreateLegalValuePrefill,
} from './owner-legal-taxes.pure.js';
import { ownerTaxesCopy, type OwnerTaxesLang } from './owner-taxes-copy.pure.js';

async function loadOwnerTaxesLegalSource(): Promise<{
  legalRows: Array<Record<string, unknown>>;
  countryCatalog: {
    countries: Array<{ code?: string; name?: string }>;
    country_packs: Array<{ id?: string; country_code?: string; name?: string; status?: string }>;
    rulesets: Array<{
      id?: string;
      country_pack_id?: string;
      ruleset_code?: string;
      ruleset_version?: string;
      status?: string;
      effective_from?: string;
      effective_to?: string | null;
    }>;
  };
}> {
  const [values, countries, packs, rulesets] = await Promise.all([
    supabaseAdmin
      .from('country_legal_values')
      .select('id, country_code, value_key, label, category, module_scope, usage_hint, owner_note, value_type, status, updated_at')
      .in('category', [...OWNER_TAX_CATEGORIES])
      .order('updated_at', { ascending: false }),
    supabaseAdmin.from('countries').select('code, name, status').order('code'),
    supabaseAdmin.from('country_packs').select('id, country_code, name, status').order('updated_at', { ascending: false }),
    supabaseAdmin
      .from('country_pack_rulesets')
      .select('id, country_pack_id, ruleset_code, ruleset_version, effective_from, effective_to, status')
      .order('updated_at', { ascending: false }),
  ]);
  if (values.error) throw values.error;
  if (countries.error) throw countries.error;
  if (packs.error) throw packs.error;
  if (rulesets.error) throw rulesets.error;

  const legalIds = (values.data ?? []).map((row) => row.id);
  const versions = legalIds.length
    ? await supabaseAdmin
        .from('country_legal_value_versions')
        .select('id, legal_value_id, country_pack_ruleset_id, value_payload_json, effective_from, effective_to, status, updated_at')
        .in('legal_value_id', legalIds)
        .order('updated_at', { ascending: false })
    : { data: [], error: null };
  if (versions.error) throw versions.error;

  const byLegalValueId = new Map<string, Array<Record<string, unknown>>>();
  for (const version of versions.data ?? []) {
    const list = byLegalValueId.get(version.legal_value_id) ?? [];
    list.push(version);
    byLegalValueId.set(version.legal_value_id, list);
  }

  return {
    legalRows: (values.data ?? []).map((row) => ({
      ...row,
      versions: byLegalValueId.get(row.id) ?? [],
    })),
    countryCatalog: {
      countries: countries.data ?? [],
      country_packs: packs.data ?? [],
      rulesets: rulesets.data ?? [],
    },
  };
}

function vatMessage(copy: Record<string, string>, reason: string | null, authoritative: boolean): string {
  if (authoritative) return copy.vat_ready;
  if (reason === 'country_pack_ruleset_missing') return copy.vat_missing_ruleset;
  if (reason === 'legal_value_missing') return copy.vat_missing_value;
  if (reason === 'active_version_missing') return copy.vat_missing_version;
  if (reason === 'rate_unparseable') return copy.vat_unparseable;
  return copy.vat_missing_version;
}

export async function buildOwnerTaxesAggregate(ctx: RequestContext): Promise<Record<string, unknown>> {
  assertPlatformOwner(ctx);
  const lang = (resolvePersistedUiLanguage(ctx.user.uiLanguage) === 'he' ? 'he' : 'en') as OwnerTaxesLang;
  const copy = ownerTaxesCopy(lang);
  const asOfDate = new Date().toISOString().slice(0, 10);
  const started = Date.now();
  const [legalSource, vat, auditRes] = await Promise.all([
    loadOwnerTaxesLegalSource(),
    resolvePlatformSellerVat(asOfDate),
    supabaseAdmin
      .from('audit_log')
      .select('id, action, entity_type, entity_id, created_at')
      .in('entity_type', ['country_legal_value', 'country_legal_value_version'])
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  const rules = buildOwnerTaxRuleRows({
    legalRows: legalSource.legalRows,
    asOfDate,
    lang,
    copy,
    countryCatalog: legalSource.countryCatalog,
  });
  return {
    aggregate_key: OWNER_TAXES_AGGREGATE_KEY,
    diagnostics: { built_ms: Date.now() - started },
    ui: { locale: lang, direction: lang === 'he' ? 'rtl' : 'ltr', text: copy },
    as_of_date: asOfDate,
    platform_seller_vat: {
      ...vat,
      message: vatMessage(copy, vat.unresolved_reason, vat.authoritative),
    },
    supported_tax_types: [
      { category: 'VAT', value_type: 'percentage', calculation_type: 'percentage' },
      { category: 'Income Tax', value_type: 'percentage', calculation_type: 'percentage' },
      { category: 'National Insurance', value_type: 'percentage', calculation_type: 'percentage' },
    ],
    rules,
    default_country_code: rules.some((row) => String(row.country_code ?? '').toUpperCase() === 'IL')
      ? 'IL'
      : String(rules[0]?.country_code ?? ''),
    empty: rules.length === 0,
    audit: (auditRes.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      created_at: row.created_at,
    })),
    available_actions: [
      {
        action_key: 'create_legal_value',
        enabled: true,
        button_label: copy.add_tax_type,
        note: copy.supported_types,
        payload: {
          country_code: 'ISO 3166-1 alpha-2',
          value_key: 'string unique per country',
          label: 'string',
          category: 'VAT|Income Tax|National Insurance',
          module_scope: 'nodexpro_platform_sales|string',
          value_type: 'percentage',
          status: 'optional draft|active|disabled',
          usage_hint: 'optional string',
          owner_note: 'optional string',
          owner_surface: 'taxes',
        },
        prefill: ownerTaxCreateLegalValuePrefill(),
      },
    ],
  };
}
