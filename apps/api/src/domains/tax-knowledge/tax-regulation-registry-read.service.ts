import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  countRegistryEntries,
  deriveRegistryResolutionStatus,
  deriveRegistryReviewStatus,
  deriveRegistrySourceStatus,
  emptyRegistryCounts,
  isRegulationRegistryProvenance,
  officialRegistryName,
  presentRegistryStatus,
  sourcedEffectiveFromOrNull,
  yearFromPublishedOn,
} from './tax-regulation-registry.pure.js';

export type RegulationRegistrySliceDto = {
  available: boolean;
  selected_country_code: string | null;
  schema_applied: boolean;
  categories: Array<{
    id: string;
    title: string;
    counts: ReturnType<typeof emptyRegistryCounts>;
    entries: Array<Record<string, unknown>>;
    allowed_actions: Array<{ action_key: string; enabled: boolean; payload: Record<string, string> }>;
  }>;
  selected_draft_references: Array<Record<string, unknown>>;
  allowed_actions: Array<{ action_key: string; enabled: boolean; payload: Record<string, string> }>;
  labels: {
    title: string;
    missing: string;
    source_added: string;
    reviewed: string;
    resolved: string;
    last_owner_review: string;
    effective: string;
  };
};

export function emptyRegulationRegistrySlice(countryCode: string | null = null): RegulationRegistrySliceDto {
  return {
    available: false,
    selected_country_code: countryCode,
    schema_applied: false,
    categories: [],
    selected_draft_references: [],
    allowed_actions: [],
    labels: {
      title: 'תקנות וצווים',
      missing: 'Missing',
      source_added: 'Source added',
      reviewed: 'Reviewed',
      resolved: 'Resolved',
      last_owner_review: 'Last Owner review',
      effective: 'Effective',
    },
  };
}

export async function buildRegulationRegistrySlice(input: {
  countryCode: string | null;
  selectedDraftId?: string | null;
}): Promise<RegulationRegistrySliceDto> {
  const empty = emptyRegulationRegistrySlice(input.countryCode);
  if (!input.countryCode) return empty;

  const domains = await supabaseAdmin
    .from('tax_domains')
    .select('id, title, sort_order, status')
    .eq('country_code', input.countryCode)
    .order('sort_order', { ascending: true });
  if (domains.error) {
    if (isSupabaseMissingTableError(domains.error)) return empty;
    throw domains.error;
  }

  const sources = await supabaseAdmin
    .from('tax_sources')
    .select(
      'id, tax_domain_id, title, provenance_type, published_on, owner_catalog_number, owner_catalog_year, status, updated_at',
    )
    .eq('country_code', input.countryCode);
  if (sources.error && isSupabaseMissingColumnError(sources.error)) {
    const legacy = await supabaseAdmin
      .from('tax_sources')
      .select('id, tax_domain_id, title, provenance_type, published_on, status, updated_at')
      .eq('country_code', input.countryCode);
    if (legacy.error) throw legacy.error;
    return {
      ...empty,
      available: true,
      schema_applied: false,
      allowed_actions: catalogActions(input.countryCode),
    };
  }
  if (sources.error) throw sources.error;

  const registrySources = (sources.data ?? []).filter(
    (row) => isRegulationRegistryProvenance(row.provenance_type) && row.tax_domain_id && row.owner_catalog_number,
  );
  const sourceIds = registrySources.map((row) => String(row.id));

  const documents = sourceIds.length
    ? await supabaseAdmin
        .from('legal_ingestion_documents')
        .select('id, tax_source_id, created_at')
        .in('tax_source_id', sourceIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null };
  if (documents.error && !isSupabaseMissingTableError(documents.error)) throw documents.error;

  const drafts = sourceIds.length
    ? await supabaseAdmin
        .from('legal_ingestion_legal_text_drafts')
        .select('id, document_id, review_status, draft_legal_text, updated_at')
        .in(
          'document_id',
          (documents.data ?? []).map((row) => String(row.id)),
        )
    : { data: [], error: null };
  if (drafts.error && !isSupabaseMissingTableError(drafts.error)) throw drafts.error;

  const draftIds = (drafts.data ?? []).map((row) => String(row.id));
  const proposals = draftIds.length
    ? await supabaseAdmin
        .from('legal_ingestion_tax_knowledge_proposals')
        .select('id, legal_text_draft_id, status, updated_at')
        .in('legal_text_draft_id', draftIds)
    : { data: [], error: null };
  if (proposals.error && !isSupabaseMissingTableError(proposals.error)) throw proposals.error;

  const unresolved = sourceIds.length
    ? await supabaseAdmin
        .from('tax_rule_unresolved_legal_references')
        .select('id, source_tax_source_id, status, resolved_relationship_id')
        .in('source_tax_source_id', sourceIds)
    : { data: [], error: null };
  if (unresolved.error && !isSupabaseMissingTableError(unresolved.error) && !isSupabaseMissingColumnError(unresolved.error)) {
    throw unresolved.error;
  }

  const versions = sourceIds.length
    ? await supabaseAdmin
        .from('tax_rule_version_sources')
        .select('tax_source_id, tax_rule_version_id')
        .in('tax_source_id', sourceIds)
    : { data: [], error: null };
  if (versions.error && !isSupabaseMissingTableError(versions.error)) throw versions.error;
  const versionIds = (versions.data ?? []).map((row) => String(row.tax_rule_version_id));
  const versionRows = versionIds.length
    ? await supabaseAdmin
        .from('tax_rule_versions')
        .select('id, effective_from, effective_to, status')
        .in('id', versionIds)
    : { data: [], error: null };
  if (versionRows.error && !isSupabaseMissingTableError(versionRows.error)) throw versionRows.error;

  const docsBySource = new Map<string, Array<{ id: string; created_at: string }>>();
  for (const row of documents.data ?? []) {
    const list = docsBySource.get(String(row.tax_source_id)) ?? [];
    list.push({ id: String(row.id), created_at: String(row.created_at) });
    docsBySource.set(String(row.tax_source_id), list);
  }
  const draftsByDocument = new Map<string, Array<Record<string, unknown>>>();
  for (const row of drafts.data ?? []) {
    const list = draftsByDocument.get(String(row.document_id)) ?? [];
    list.push(row as Record<string, unknown>);
    draftsByDocument.set(String(row.document_id), list);
  }

  const categories = (domains.data ?? []).map((domain) => {
    const rows = registrySources.filter((source) => String(source.tax_domain_id) === String(domain.id));
    const entries = rows.map((source) => {
      const sourceId = String(source.id);
      const sourceDocs = docsBySource.get(sourceId) ?? [];
      const sourceDrafts = sourceDocs.flatMap((doc) => draftsByDocument.get(doc.id) ?? []);
      const sourceDraftIds = new Set(sourceDrafts.map((row) => String(row.id)));
      const sourceProposals = (proposals.data ?? []).filter((row) => sourceDraftIds.has(String(row.legal_text_draft_id)));
      const sourceUnresolved = (unresolved.data ?? []).filter((row) => String(row.source_tax_source_id) === sourceId);
      const sourceVersions = (versions.data ?? [])
        .filter((row) => String(row.tax_source_id) === sourceId)
        .map((row) => (versionRows.data ?? []).find((version) => String(version.id) === String(row.tax_rule_version_id)))
        .filter(Boolean);
      const ownerRef = String(source.owner_catalog_number ?? '');
      const sourceStatus = deriveRegistrySourceStatus({
        has_document: sourceDocs.length > 0,
        has_owner_legal_text: sourceDrafts.some((row) => String(row.draft_legal_text ?? '').trim().length > 0),
      });
      const reviewStatus = deriveRegistryReviewStatus({
        has_ready_draft: sourceDrafts.some((row) => row.review_status === 'ready'),
        has_owner_approved_proposal: sourceProposals.some((row) => row.status === 'owner_approved'),
      });
      const resolutionStatus = deriveRegistryResolutionStatus({
        has_resolved_relationship: sourceUnresolved.some(
          (row) => row.status === 'resolved' || row.resolved_relationship_id,
        ),
      });
      const presentation = presentRegistryStatus({
        source_status: sourceStatus,
        review_status: reviewStatus,
        resolution_status: resolutionStatus,
      });
      const reviewedAt = [
        ...sourceDrafts.filter((row) => row.review_status === 'ready').map((row) => String(row.updated_at ?? '')),
        ...sourceProposals.filter((row) => row.status === 'owner_approved').map((row) => String(row.updated_at ?? '')),
      ]
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      const effectiveFrom =
        sourcedEffectiveFromOrNull(
          sourceVersions
            .map((row) => (row && typeof row.effective_from === 'string' ? row.effective_from : null))
            .find((value) => value) ?? null,
        );
      const trainerDocumentId = sourceDocs[0]?.id ?? null;
      return {
        id: sourceId,
        tax_source_id: sourceId,
        owner_catalog_number: ownerRef,
        name: officialRegistryName(String(source.title ?? ''), ownerRef),
        year: typeof source.owner_catalog_year === 'number' ? source.owner_catalog_year : yearFromPublishedOn(source.published_on == null ? null : String(source.published_on)),
        source_status: sourceStatus,
        review_status: reviewStatus,
        resolution_status: resolutionStatus,
        status_code: presentation.code,
        status_label: presentation.label,
        effective_from: effectiveFrom,
        effective_to: sourceVersions[0] && typeof sourceVersions[0].effective_to === 'string' ? sourceVersions[0].effective_to : null,
        last_owner_review_at: reviewedAt,
        trainer_document_id: trainerDocumentId,
        open_command: trainerDocumentId
          ? {
              action_key: 'select_legal_training_document',
              enabled: true,
              payload: { legal_ingestion_document_id: trainerDocumentId },
            }
          : {
              action_key: 'upload_legal_training_document',
              enabled: true,
              payload: { tax_source_id: sourceId },
            },
      };
    });
    const counts = countRegistryEntries(entries);
    return {
      id: String(domain.id),
      title: String(domain.title),
      counts,
      entries,
      allowed_actions: [
        {
          action_key: 'ensure_regulation_registry_entry',
          enabled: true,
          payload: {
            country_code: String(input.countryCode),
            tax_domain_id: String(domain.id),
            owner_catalog_number: '',
          } satisfies Record<string, string>,
        },
      ],
    };
  }).filter((category) => category.entries.length > 0 || true);

  const selectedDraftReferences = input.selectedDraftId
    ? await loadDraftReferences(input.selectedDraftId)
    : [];

  return {
    ...empty,
    available: true,
    schema_applied: true,
    categories,
    selected_draft_references: selectedDraftReferences,
    allowed_actions: catalogActions(input.countryCode),
  };
}

function catalogActions(countryCode: string): Array<{ action_key: string; enabled: boolean; payload: Record<string, string> }> {
  return [
    {
      action_key: 'create_tax_domain',
      enabled: true,
      payload: { country_code: countryCode, title: '', status: 'draft' },
    },
    {
      action_key: 'ensure_regulation_registry_entry',
      enabled: true,
      payload: { country_code: countryCode, tax_domain_id: '', owner_catalog_number: '' },
    },
    {
      action_key: 'record_legal_text_draft_regulation_reference',
      enabled: true,
      payload: {
        legal_text_draft_id: '',
        tax_domain_id: '',
        owner_catalog_number: '',
        locator_text: '',
      },
    },
  ];
}

export async function loadDraftReferences(draftId: string): Promise<Array<Record<string, unknown>>> {
  const pins = await supabaseAdmin
    .from('legal_ingestion_draft_legal_references')
    .select('id, tax_source_id, locator_text, confirmation_state, creation_origin, relationship_type, cited_instrument_kind')
    .eq('legal_text_draft_id', draftId)
    .order('created_at', { ascending: true });
  if (pins.error) {
    if (isSupabaseMissingTableError(pins.error)) return [];
    throw pins.error;
  }
  const sourceIds = (pins.data ?? []).map((row) => String(row.tax_source_id));
  const sources = sourceIds.length
    ? await supabaseAdmin
        .from('tax_sources')
        .select('id, title, owner_catalog_number, tax_domain_id')
        .in('id', sourceIds)
    : { data: [], error: null };
  if (sources.error && !isSupabaseMissingColumnError(sources.error)) throw sources.error;
  const domains = (sources.data ?? [])
    .map((row) => row.tax_domain_id)
    .filter(Boolean);
  const domainRows = domains.length
    ? await supabaseAdmin.from('tax_domains').select('id, title').in('id', domains.map(String))
    : { data: [], error: null };
  if (domainRows.error) throw domainRows.error;
  return (pins.data ?? []).map((pin) => {
    const source = (sources.data ?? []).find((row) => String(row.id) === String(pin.tax_source_id));
    const domain = (domainRows.data ?? []).find((row) => String(row.id) === String(source?.tax_domain_id ?? ''));
    const ownerRef = String(source?.owner_catalog_number ?? '');
    return {
      id: String(pin.id),
      tax_source_id: String(pin.tax_source_id),
      tax_domain_id: source?.tax_domain_id == null ? null : String(source.tax_domain_id),
      category_title: domain ? String(domain.title) : null,
      owner_catalog_number: ownerRef,
      label: [domain ? String(domain.title) : null, ownerRef].filter(Boolean).join(' · '),
      locator_text: String(pin.locator_text),
      confirmation_state: String(pin.confirmation_state),
      creation_origin: String(pin.creation_origin),
      relationship_type: String(pin.relationship_type),
      cited_instrument_kind: String(pin.cited_instrument_kind),
      name: officialRegistryName(source ? String(source.title) : null, ownerRef),
    };
  });
}
