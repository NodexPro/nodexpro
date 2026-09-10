import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { getOrganizationCountrySettings } from '../country-pack/organization-country.service.js';
import { businessYmd } from '../../shared/business-time.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  buildTaxAdvisoryAllowedActions,
  taxAdvisoryImplementedCommands,
} from './tax-advisory-allowed-actions.pure.js';
import { normalizeIsoCountry } from './tax-advisory-country.pure.js';
import {
  loadTenantActiveFactCatalog,
  pickFactPresentation,
  type TenantActiveFactDefinition,
} from './tax-advisory-fact-catalog.service.js';
import {
  TAX_ADVISORY_AGGREGATE_KEY,
  TAX_ADVISORY_LIFECYCLE_ARCHIVED,
  TAX_ADVISORY_PERMISSIONS,
  TAX_ADVISORY_WORKFLOW_BUSINESS_SETUP,
  type TaxAdvisoryCaseAggregate,
  type TaxAdvisoryCaseSlice,
  type TaxAdvisoryClientSummary,
  type TaxAdvisoryFactRow,
} from './tax-advisory.types.js';

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isTaxAdvisoryUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function canEditTaxAdvisory(ctx: RequestContext): boolean {
  return hasPermission(ctx.membership?.permissions ?? [], TAX_ADVISORY_PERMISSIONS.edit);
}

function uiLocale(ctx: RequestContext): string {
  return ctx.user.uiLanguage === 'en' ? 'en' : 'he';
}

function mapCase(row: Record<string, unknown>): TaxAdvisoryCaseSlice {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    client_id: String(row.client_id),
    country_code: String(row.country_code).trim().toUpperCase(),
    workflow_type: String(row.workflow_type),
    lifecycle_state: String(row.lifecycle_state),
    as_of: String(row.as_of).slice(0, 10),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    archived_at: row.archived_at == null ? null : String(row.archived_at),
    archived_by: row.archived_by == null ? null : String(row.archived_by),
  };
}

export async function loadTaxAdvisoryClient(
  orgId: string,
  clientId: string,
): Promise<TaxAdvisoryClientSummary | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, country_code, status, organization_id, is_archived')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    display_name: typeof data.display_name === 'string' ? data.display_name : null,
    tax_id: typeof data.tax_id === 'string' ? data.tax_id : null,
    country_code: normalizeIsoCountry(data.country_code),
    status: typeof data.status === 'string' ? data.status : null,
  };
}

export async function loadOpenTaxAdvisoryCase(
  orgId: string,
  clientId: string,
): Promise<TaxAdvisoryCaseSlice | null> {
  const { data, error } = await supabaseAdmin
    .from('tax_advisory_cases')
    .select(
      'id, organization_id, client_id, country_code, workflow_type, lifecycle_state, as_of, created_by, created_at, archived_at, archived_by',
    )
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('workflow_type', TAX_ADVISORY_WORKFLOW_BUSINESS_SETUP)
    .neq('lifecycle_state', TAX_ADVISORY_LIFECYCLE_ARCHIVED)
    .maybeSingle();
  if (error) {
    if (isSupabaseMissingTableError(error, 'tax_advisory_cases')) {
      throw error;
    }
    throw error;
  }
  if (!data) return null;
  return mapCase(data as Record<string, unknown>);
}

export async function loadTaxAdvisoryCaseForOrg(
  orgId: string,
  caseId: string,
): Promise<TaxAdvisoryCaseSlice | null> {
  const { data, error } = await supabaseAdmin
    .from('tax_advisory_cases')
    .select(
      'id, organization_id, client_id, country_code, workflow_type, lifecycle_state, as_of, created_by, created_at, archived_at, archived_by',
    )
    .eq('id', caseId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapCase(data as Record<string, unknown>);
}

async function loadCaseAnswers(
  orgId: string,
  caseId: string,
): Promise<Map<string, { version_id: string; value: unknown; value_type: string; fact_key: string }>> {
  const { data, error } = await supabaseAdmin
    .from('tax_advisory_case_facts')
    .select('fact_definition_id, fact_definition_version_id, value_json, value_type, fact_key')
    .eq('organization_id', orgId)
    .eq('case_id', caseId);
  if (error) throw error;
  const map = new Map<
    string,
    { version_id: string; value: unknown; value_type: string; fact_key: string }
  >();
  for (const row of data ?? []) {
    map.set(String(row.fact_definition_id), {
      version_id: String(row.fact_definition_version_id),
      value: row.value_json,
      value_type: String(row.value_type),
      fact_key: String(row.fact_key),
    });
  }
  return map;
}

function mergeFacts(input: {
  catalog: TenantActiveFactDefinition[];
  answers: Map<string, { version_id: string; value: unknown; value_type: string; fact_key: string }>;
  legalCountry: string;
  locale: string;
}): TaxAdvisoryFactRow[] {
  return input.catalog.map((definition) => {
    const answer = input.answers.get(definition.id);
    const activeVersionId = definition.active_version?.id ?? null;
    const presentation = pickFactPresentation(definition.presentations, input.legalCountry, input.locale);
    return {
      fact_definition_id: definition.id,
      fact_key: definition.fact_key,
      value_type: definition.active_version?.value_type ?? '',
      scope: definition.scope,
      country_code: definition.country_code,
      presentation: presentation
        ? {
            locale: presentation.locale,
            label: presentation.label,
            professional_question: presentation.professional_question,
            client_question: presentation.client_question,
            help_text: presentation.help_text,
            enum_option_labels: presentation.enum_option_labels,
          }
        : {
            locale: input.locale,
            label: definition.semantic_title,
            professional_question: definition.semantic_title,
            client_question: null,
            help_text: null,
            enum_option_labels: {},
          },
      answered: Boolean(answer),
      value: answer ? answer.value : null,
      fact_definition_version_id: answer ? answer.version_id : null,
      current_active_version_id: activeVersionId,
      pinned_version_not_current: Boolean(answer && activeVersionId && answer.version_id !== activeVersionId),
      enum_codes: definition.active_version?.enum_codes ?? [],
    };
  });
}

export async function buildTaxAdvisoryCaseAggregate(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
): Promise<TaxAdvisoryCaseAggregate> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const client = await loadTaxAdvisoryClient(orgId, clientId);
  const settings = await getOrganizationCountrySettings(orgId);
  const orgLegalCountry = normalizeIsoCountry(settings?.country_code ?? null);
  const currentCase = await loadOpenTaxAdvisoryCase(orgId, clientId);
  const legalCountry = currentCase?.country_code ?? orgLegalCountry;
  const asOf = currentCase?.as_of ?? businessYmd(new Date());

  if (!orgLegalCountry) {
    warnings.push('organization_legal_country_missing');
  }
  if (
    currentCase &&
    orgLegalCountry &&
    currentCase.country_code !== orgLegalCountry
  ) {
    warnings.push('organization_legal_country_changed_case_frozen');
  }
  if (
    client?.country_code &&
    orgLegalCountry &&
    client.country_code !== orgLegalCountry
  ) {
    warnings.push('client_country_differs_from_organization_legal_country');
  }

  let catalog: TenantActiveFactDefinition[] = [];
  if (legalCountry) {
    const loaded = await loadTenantActiveFactCatalog({ countryCode: legalCountry, asOf });
    catalog = loaded.definitions;
    warnings.push(...loaded.warnings);
  }

  const answers = currentCase
    ? await loadCaseAnswers(orgId, currentCase.id)
    : new Map<string, { version_id: string; value: unknown; value_type: string; fact_key: string }>();

  const facts = legalCountry
    ? mergeFacts({
        catalog,
        answers,
        legalCountry,
        locale: uiLocale(ctx),
      })
    : [];
  const answered = facts.filter((row) => row.answered).length;

  return {
    aggregate_key: TAX_ADVISORY_AGGREGATE_KEY,
    client: client ?? {
      id: clientId,
      display_name: null,
      tax_id: null,
      country_code: null,
      status: null,
    },
    country: {
      legal_engine_country_code: orgLegalCountry,
      case_country_code: currentCase?.country_code ?? null,
      client_country_code: client?.country_code ?? null,
      client_country_is_tax_residency: false,
    },
    current_case: currentCase,
    as_of: currentCase?.as_of ?? null,
    workflow_type: currentCase?.workflow_type ?? null,
    lifecycle_state: currentCase?.lifecycle_state ?? null,
    allowed_actions: buildTaxAdvisoryAllowedActions({
      canEdit: canEditTaxAdvisory(ctx),
      hasOpenCase: Boolean(currentCase),
      lifecycleState: currentCase?.lifecycle_state ?? null,
    }),
    implemented_commands: taxAdvisoryImplementedCommands(),
    facts,
    counts: {
      answered,
      unanswered_available: facts.length - answered,
    },
    scenarios: [],
    latest_evaluation: null,
    missing_facts_from_engine: null,
    evaluation_notice: {
      code: 'evaluation_not_run',
      message: 'No tax evaluation has been run yet',
    },
    warnings,
    errors,
  };
}
