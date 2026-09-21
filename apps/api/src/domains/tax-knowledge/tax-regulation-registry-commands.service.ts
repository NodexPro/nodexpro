import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, notFound } from '../../shared/errors.js';
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
  throwIfSupabaseError,
} from '../../shared/supabase-errors.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
import { recordTaxKnowledgeProposalExternalReference } from '../knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.js';
import { generateLegalMachineCode } from './tax-knowledge-library.pure.js';
import {
  isRegulationRegistryProvenance,
  officialRegistryName,
  parseOwnerCatalogNumber,
  technicalTitleForPlaceholder,
} from './tax-regulation-registry.pure.js';
import { TAX_KNOWLEDGE_INITIAL_STATUS, type TaxKnowledgeCommandResponse } from './tax-knowledge.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN_TABLE = 'legal_ingestion_draft_legal_references';

function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) throw badRequest(`${field} is required`);
  return value.trim();
}

function asCountryCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) throw badRequest('country_code is required');
  return value.trim().toUpperCase();
}

function asOwnerCatalogNumber(value: unknown): string {
  try {
    return parseOwnerCatalogNumber(value);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'owner_catalog_number is required');
  }
}

async function refreshed(ctx: RequestContext, countryCode: string): Promise<TaxKnowledgeCommandResponse['refreshed']> {
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, {
      tax_knowledge_country_code: countryCode,
      strategy_engine_country_code: countryCode,
    }),
  };
}

async function loadDomain(domainId: string): Promise<{ id: string; country_code: string; title: string }> {
  const { data, error } = await supabaseAdmin
    .from('tax_domains')
    .select('id, country_code, title')
    .eq('id', domainId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax domain not found');
  return { id: String(data.id), country_code: String(data.country_code).toUpperCase(), title: String(data.title) };
}

export async function findOrCreateRegulationRegistryEntry(input: {
  countryCode: string;
  taxDomainId: string;
  ownerCatalogNumber: string;
  provenanceType?: string;
  createdBy: string;
}): Promise<{ id: string; created: boolean; title: string; owner_catalog_number: string; tax_domain_id: string }> {
  const ownerCatalogNumber = asOwnerCatalogNumber(input.ownerCatalogNumber);
  const provenanceType = input.provenanceType ?? 'regulation';
  if (!isRegulationRegistryProvenance(provenanceType)) {
    throw badRequest('provenance_type must be regulation or order');
  }
  const existing = await supabaseAdmin
    .from('tax_sources')
    .select('id, title, owner_catalog_number, tax_domain_id')
    .eq('country_code', input.countryCode)
    .eq('tax_domain_id', input.taxDomainId)
    .eq('owner_catalog_number', ownerCatalogNumber)
    .maybeSingle();
  if (existing.error && !isSupabaseMissingColumnError(existing.error)) throw existing.error;
  if (existing.data?.id) {
    return {
      id: String(existing.data.id),
      created: false,
      title: String(existing.data.title ?? ownerCatalogNumber),
      owner_catalog_number: ownerCatalogNumber,
      tax_domain_id: input.taxDomainId,
    };
  }

  const sourceCode = generateLegalMachineCode('src', ownerCatalogNumber, randomBytes(6).toString('hex'));
  const insert = await supabaseAdmin
    .from('tax_sources')
    .insert({
      country_code: input.countryCode,
      source_code: sourceCode,
      title: technicalTitleForPlaceholder(ownerCatalogNumber),
      provenance_type: provenanceType,
      status: TAX_KNOWLEDGE_INITIAL_STATUS,
      tax_domain_id: input.taxDomainId,
      owner_catalog_number: ownerCatalogNumber,
    })
    .select('id, title, owner_catalog_number, tax_domain_id')
    .maybeSingle();
  if (insert.error && (insert.error.code === '23505' || /uq_tax_sources_domain_owner_catalog/i.test(insert.error.message ?? ''))) {
    const raced = await supabaseAdmin
      .from('tax_sources')
      .select('id, title, owner_catalog_number, tax_domain_id')
      .eq('country_code', input.countryCode)
      .eq('tax_domain_id', input.taxDomainId)
      .eq('owner_catalog_number', ownerCatalogNumber)
      .maybeSingle();
    if (raced.error) throw raced.error;
    if (!raced.data?.id) throw conflict('Regulation registry entry already exists');
    return {
      id: String(raced.data.id),
      created: false,
      title: String(raced.data.title ?? ownerCatalogNumber),
      owner_catalog_number: ownerCatalogNumber,
      tax_domain_id: input.taxDomainId,
    };
  }
  if (insert.error) throw insert.error;
  if (!insert.data?.id) throw conflict('Could not create regulation registry entry');
  return {
    id: String(insert.data.id),
    created: true,
    title: String(insert.data.title ?? ownerCatalogNumber),
    owner_catalog_number: ownerCatalogNumber,
    tax_domain_id: input.taxDomainId,
  };
}

export async function handleEnsureRegulationRegistryEntry(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const countryCode = asCountryCode(payload.country_code);
  const domain = await loadDomain(asUuid(payload.tax_domain_id, 'tax_domain_id'));
  if (domain.country_code !== countryCode) throw badRequest('tax_domain_id must belong to the same country');
  const entry = await findOrCreateRegulationRegistryEntry({
    countryCode,
    taxDomainId: domain.id,
    ownerCatalogNumber: asOwnerCatalogNumber(payload.owner_catalog_number),
    provenanceType: typeof payload.provenance_type === 'string' ? payload.provenance_type : 'regulation',
    createdBy: ctx.user.id,
  });
  if (entry.created) {
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'tax_source',
      entityId: entry.id,
      action: AUDIT_ACTIONS.TAX_SOURCE_CREATED,
      payload: {
        country_code: countryCode,
        tax_domain_id: domain.id,
        owner_catalog_number: entry.owner_catalog_number,
        registry_placeholder: true,
      },
    });
  }
  return { ok: true, command: 'ensure_regulation_registry_entry', refreshed: await refreshed(ctx, countryCode) };
}

export async function handleRecordLegalTextDraftRegulationReference(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxKnowledgeCommandResponse> {
  const draftId = asUuid(payload.legal_text_draft_id, 'legal_text_draft_id');
  const domain = await loadDomain(asUuid(payload.tax_domain_id, 'tax_domain_id'));
  const locatorText = typeof payload.locator_text === 'string' ? payload.locator_text.trim() : '';
  if (!locatorText) throw badRequest('locator_text is required');
  const ownerCatalogNumber = asOwnerCatalogNumber(payload.owner_catalog_number);
  const creationOrigin = payload.creation_origin === 'ai_suggestion' ? 'ai_suggestion' : 'owner_manual';
  const confirmationState =
    creationOrigin === 'ai_suggestion' && payload.owner_confirmed !== true ? 'ai_suggested' : 'owner_confirmed';

  const draft = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select('id, country_code, document_id, original_source_text, draft_legal_text')
    .eq('id', draftId)
    .maybeSingle();
  if (draft.error) throw draft.error;
  if (!draft.data) throw notFound('Legal text draft not found');
  const countryCode = String(draft.data.country_code).toUpperCase();
  if (domain.country_code !== countryCode) throw badRequest('tax_domain_id must belong to the same country');
  if (!String(draft.data.draft_legal_text ?? '').includes(locatorText)) {
    throw badRequest('locator_text must be an exact span from the current Owner-reviewed legal text');
  }

  const entry = await findOrCreateRegulationRegistryEntry({
    countryCode,
    taxDomainId: domain.id,
    ownerCatalogNumber,
    provenanceType: typeof payload.provenance_type === 'string' ? payload.provenance_type : 'regulation',
    createdBy: ctx.user.id,
  });

  const existingPins = await supabaseAdmin
    .from(PIN_TABLE)
    .select('id, tax_source_id, locator_text')
    .eq('legal_text_draft_id', draftId)
    .eq('tax_source_id', entry.id)
    .eq('locator_text', locatorText);
  if (existingPins.error && !isSupabaseMissingTableError(existingPins.error)) {
    throwIfSupabaseError(existingPins.error, 'regulationRegistry.record_pin', {
      migrationHint:
        'Apply supabase/migrations/653_tax_regulation_registry_service_role_grants.sql on DEV only.',
    });
  }
  const alreadyPinned = (existingPins.data ?? []).length > 0;
  if (!alreadyPinned) {
    const insert = await supabaseAdmin.from(PIN_TABLE).insert({
      country_code: countryCode,
      legal_text_draft_id: draftId,
      tax_source_id: entry.id,
      relationship_type: 'depends_on',
      cited_instrument_kind: isRegulationRegistryProvenance(payload.cited_instrument_kind)
        ? payload.cited_instrument_kind
        : 'regulation',
      locator_text: locatorText,
      locator_start: typeof payload.locator_start === 'number' ? payload.locator_start : null,
      locator_end: typeof payload.locator_end === 'number' ? payload.locator_end : null,
      confirmation_state: confirmationState,
      creation_origin: creationOrigin,
      created_by: ctx.user.id,
    });
    if (insert.error && insert.error.code !== '23505') {
      throwIfSupabaseError(insert.error, 'regulationRegistry.record_pin', {
        migrationHint:
          'Apply supabase/migrations/653_tax_regulation_registry_service_role_grants.sql on DEV only.',
      });
    }
  }

  const latestProposal = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposals')
    .select('id')
    .eq('legal_text_draft_id', draftId)
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestProposal.error && !isSupabaseMissingTableError(latestProposal.error)) throw latestProposal.error;
  if (latestProposal.data?.id && confirmationState === 'owner_confirmed') {
    try {
      await recordTaxKnowledgeProposalExternalReference(ctx, {
        tax_knowledge_proposal_id: String(latestProposal.data.id),
        relationship_type: 'depends_on',
        cited_instrument_kind: 'regulation',
        locator_text: locatorText,
        cited_law_name: domain.title,
        source_tax_source_id: entry.id,
        owner_catalog_number: ownerCatalogNumber,
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'TAX_KNOWLEDGE_PROPOSAL_EXTERNAL_REFERENCE_EXISTS') throw error;
    }
  }

  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: PIN_TABLE,
    entityId: draftId,
    action: AUDIT_ACTIONS.LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_EXTERNAL_REFERENCE_RECORDED,
    payload: {
      country_code: countryCode,
      legal_text_draft_id: draftId,
      tax_source_id: entry.id,
      tax_domain_id: domain.id,
      owner_catalog_number: ownerCatalogNumber,
      locator_text: locatorText,
      confirmation_state: confirmationState,
      created_placeholder: entry.created,
      reused: !entry.created || alreadyPinned,
      layer_a_unchanged: true,
      layer_b_rewritten: false,
      official_name: officialRegistryName(entry.title, ownerCatalogNumber),
    },
  });

  return {
    ok: true,
    command: 'record_legal_text_draft_regulation_reference',
    refreshed: await refreshed(ctx, countryCode),
  };
}
