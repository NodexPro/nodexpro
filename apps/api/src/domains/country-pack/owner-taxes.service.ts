import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { supabaseAdmin } from '../../db/client.js';
import { resolvePersistedUiLanguage } from '../platform-localization/platform-localization.pure.js';
import { resolvePlatformSellerVat } from '../billing/platform-seller-vat.service.js';
import { buildOwnerLegalValuesAggregate } from './country-pack-read-models.service.js';
import {
  OWNER_TAXES_AGGREGATE_KEY,
  buildOwnerTaxRuleRows,
  ownerTaxCreateLegalValuePrefill,
} from './owner-legal-taxes.pure.js';
import { ownerTaxesCopy, type OwnerTaxesLang } from './owner-taxes-copy.pure.js';

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
  const [legalValues, vat, auditRes] = await Promise.all([
    buildOwnerLegalValuesAggregate(ctx),
    resolvePlatformSellerVat(asOfDate),
    supabaseAdmin
      .from('audit_log')
      .select('id, action, entity_type, entity_id, created_at')
      .in('entity_type', ['country_legal_value', 'country_legal_value_version'])
      .order('created_at', { ascending: false })
      .limit(40),
  ]);
  const legalRows = Array.isArray(legalValues.table) ? (legalValues.table as Array<Record<string, unknown>>) : [];
  const countryCatalog = (legalValues.country_catalog ?? {}) as {
    countries?: Array<{ code?: string; name?: string }>;
    country_packs?: Array<{ id?: string; country_code?: string; name?: string; status?: string }>;
    rulesets?: Array<{
      id?: string;
      country_pack_id?: string;
      ruleset_code?: string;
      ruleset_version?: string;
      status?: string;
      effective_from?: string;
      effective_to?: string | null;
    }>;
  };
  const rules = buildOwnerTaxRuleRows({ legalRows, asOfDate, lang, copy, countryCatalog });
  return {
    aggregate_key: OWNER_TAXES_AGGREGATE_KEY,
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
