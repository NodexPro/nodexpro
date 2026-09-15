import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { parseLegalIdentifier } from '../tax-knowledge/legal-identifier.pure.js';
import { fetchAllPaged } from './knowledge-trainer-pagination.js';
import { parseSourceBBox } from './knowledge-trainer-source-notes.pure.js';
import {
  captureExclusiveSourceBody,
  captureOwnerDefinedSourceBody,
  createDraftRequiresParentFirst,
  draftWouldCycle,
  findDraftIdentityConflict,
  hierarchyRankCompatible,
  isLegalTextDraftReviewStatus,
  reparentScopeError,
  validateDraftReady,
  type DraftPageEvidence,
  type DraftStructureCandidate,
} from './knowledge-trainer-legal-text-draft.pure.js';
import type { StructureKindCatalogItem } from './knowledge-trainer.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LegalTextDraftCommandResult = {
  country_code: string;
  document_id: string;
  draft_id: string;
  duplicate?: boolean;
};

function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function asOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asUuid(value, field);
}

function throwIfDraftSchemaMissing(error: unknown): void {
  if (error && isSupabaseMissingTableError(error)) {
    throw badRequest('Knowledge Trainer legal-text draft schema is not applied. Migration 630 is required on DEV.');
  }
}

function optionalNumber(value: unknown): number | null {
  return value == null || value === '' ? null : Number(value);
}

function optionalText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asDraftStructureCandidate(row: Record<string, unknown>): DraftStructureCandidate {
  return {
    id: String(row.id),
    sort_order: Number(row.sort_order ?? 0),
    parent_candidate_id: row.parent_candidate_id == null ? null : String(row.parent_candidate_id),
    source_page: optionalNumber(row.source_page),
    source_item_start: optionalNumber(row.source_item_start),
    source_item_end: optionalNumber(row.source_item_end),
    source_line_index: optionalNumber(row.source_line_index),
    page_start: optionalNumber(row.page_start),
    page_end: optionalNumber(row.page_end),
    kind_label: optionalText(row.kind_label),
    source_display_identifier: optionalText(row.source_display_identifier),
    normalized_machine_identifier: optionalText(row.normalized_machine_identifier),
    printed_marker: optionalText(row.printed_marker),
    title: optionalText(row.title),
  };
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: 'legal_ingestion_legal_text_draft',
    entityId,
    action,
    payload,
  });
}

const DRAFT_SELECT =
  'id, country_code, document_id, job_id, tax_source_id, structure_run_id, source_candidate_id, kind_label, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_letter_suffix, identifier_nested_components, printed_marker, title, parent_draft_id, original_source_text, draft_legal_text, original_source_page_start, original_source_page_end, original_source_item_start, original_source_item_end, original_source_line_start, original_source_line_end, original_source_bbox, original_subtree_text, original_subtree_page_start, original_subtree_page_end, original_subtree_item_start, original_subtree_item_end, original_subtree_line_start, original_subtree_line_end, owner_source_page_start, owner_source_page_end, owner_source_item_start, owner_source_item_end, owner_source_line_start, owner_source_line_end, owner_source_bbox, text_boundary_status, review_status, created_by, updated_by, created_at, updated_at';

async function loadDraft(draftId: string) {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select(DRAFT_SELECT)
    .eq('id', draftId)
    .maybeSingle();
  throwIfDraftSchemaMissing(error);
  if (error) throw error;
  if (!data) throw notFound('Legal text draft not found');
  return data;
}

async function loadDraftsForDocument(documentId: string) {
  return fetchAllPaged<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .select(DRAFT_SELECT)
      .eq('document_id', documentId)
      .order('created_at', { ascending: true })
      .range(from, to),
  );
}

async function loadKindCatalog(countryCode: string): Promise<StructureKindCatalogItem[]> {
  const { data, error } = await supabaseAdmin
    .from('tax_legal_node_kinds')
    .select('id, label')
    .eq('country_code', countryCode);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: String(row.id), label: String(row.label) }));
}

async function loadPagesForJob(jobId: string): Promise<DraftPageEvidence[]> {
  const rows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from('legal_ingestion_pages')
      .select('page_no, status, page_text, page_text_items')
      .eq('job_id', jobId)
      .order('page_no', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    page_no: Number(row.page_no),
    status: String(row.status ?? ''),
    page_text: typeof row.page_text === 'string' ? row.page_text : null,
    page_text_items: row.page_text_items,
  }));
}

async function assertCandidateOnActiveRun(candidate: { job_id: unknown; structure_run_id?: unknown }): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('active_structure_run_id')
    .eq('id', String(candidate.job_id))
    .maybeSingle();
  if (error) throw error;
  const active = data?.active_structure_run_id == null ? null : String(data.active_structure_run_id);
  if (!active) throw conflict('No active complete structure run');
  const { data: run, error: runError } = await supabaseAdmin
    .from('legal_ingestion_structure_runs')
    .select('id, status')
    .eq('id', active)
    .maybeSingle();
  if (runError) throw runError;
  if (!run || String(run.status) !== 'ready') throw conflict('Active structure run is not READY');
  const runId = candidate.structure_run_id == null ? null : String(candidate.structure_run_id);
  if (!runId || runId !== active) throw conflict('Candidate is not on the active structure run');
}

function identifierFieldsFromParsed(parsed: NonNullable<ReturnType<typeof parseLegalIdentifier>>, printedMarker?: string | null) {
  return {
    source_display_identifier: parsed.source_display_identifier,
    normalized_machine_identifier: parsed.normalized_machine_identifier,
    identifier_base_number: parsed.base_number,
    identifier_letter_suffix: parsed.letter_suffix,
    identifier_nested_components: parsed.nested_components,
    printed_marker: printedMarker === undefined ? parsed.printed_marker : printedMarker,
  };
}

export async function createLegalTextDraftFromCandidate(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const documentId = asUuid(payload.legal_ingestion_document_id ?? payload.document_id, 'legal_ingestion_document_id');
  const candidateId = asUuid(payload.legal_ingestion_candidate_id ?? payload.candidate_id, 'legal_ingestion_candidate_id');
  const { data: candidate, error } = await supabaseAdmin
    .from('legal_ingestion_candidates')
    .select(
      'id, job_id, document_id, country_code, tax_source_id, candidate_kind, kind_label, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_letter_suffix, identifier_nested_components, printed_marker, title, parent_candidate_id, structure_run_id, sort_order, page_start, page_end, source_page, source_item_start, source_item_end, source_line_index, source_bbox',
    )
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!candidate) throw notFound('Extraction candidate not found');
  if (String(candidate.document_id) !== documentId) {
    throw badRequest('Candidate does not belong to this document');
  }
  if (candidate.candidate_kind !== 'structure') {
    throw badRequest('V1 can create legal-text drafts from structure candidates only');
  }
  const { data: job, error: jobError } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('id, document_id, country_code')
    .eq('id', String(candidate.job_id))
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job || String(job.document_id) !== documentId) {
    throw badRequest('Candidate does not belong to this document/job');
  }
  if (String(job.country_code) !== String(candidate.country_code)) {
    throw badRequest('Candidate country does not match the job');
  }
  await assertCandidateOnActiveRun(candidate);

  const existing = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select('id, country_code, document_id')
    .eq('document_id', documentId)
    .eq('source_candidate_id', candidateId)
    .maybeSingle();
  throwIfDraftSchemaMissing(existing.error);
  if (existing.error) throw existing.error;
  if (existing.data) {
    return {
      country_code: String(existing.data.country_code),
      document_id: String(existing.data.document_id),
      draft_id: String(existing.data.id),
      duplicate: true,
    };
  }

  let parentDraftId: string | null = null;
  const parentCandidateId = candidate.parent_candidate_id == null ? null : String(candidate.parent_candidate_id);
  if (parentCandidateId) {
    const { data: parentDraft, error: parentError } = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .select('id')
      .eq('document_id', documentId)
      .eq('source_candidate_id', parentCandidateId)
      .maybeSingle();
    throwIfDraftSchemaMissing(parentError);
    if (parentError) throw parentError;
    parentDraftId = parentDraft?.id ? String(parentDraft.id) : null;
    if (createDraftRequiresParentFirst(parentCandidateId, parentDraftId)) {
      // Smallest safe ancestor model: refuse. Do not invent a disconnected
      // hierarchy and do not silently create ancestor drafts. Same parent-first
      // rule as accept_legal_structure_candidate.
      throw conflict('Create the parent legal-text draft first', 'PARENT_DRAFT_REQUIRED');
    }
  }

  const runCandidates = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from('legal_ingestion_candidates')
      .select(
        'id, sort_order, parent_candidate_id, source_page, source_item_start, source_item_end, source_line_index, page_start, page_end, kind_label, source_display_identifier, normalized_machine_identifier, printed_marker, title',
      )
      .eq('structure_run_id', String(candidate.structure_run_id))
      .eq('candidate_kind', 'structure')
      .order('sort_order', { ascending: true })
      .range(from, to),
  );
  const ordered: DraftStructureCandidate[] = runCandidates.map((row) => asDraftStructureCandidate(row));
  const current =
    ordered.find((row) => row.id === candidateId) ??
    asDraftStructureCandidate({ ...candidate, parent_candidate_id: parentCandidateId });
  const pages = await loadPagesForJob(String(candidate.job_id));
  const captured = captureExclusiveSourceBody(current, ordered, pages);
  const reviewStatus = captured.boundary_status === 'uncertain' ? 'needs_review' : 'draft';
  const nested = Array.isArray(candidate.identifier_nested_components)
    ? candidate.identifier_nested_components.map((item) => String(item))
    : [];

  const insert = {
    country_code: String(candidate.country_code),
    document_id: documentId,
    job_id: String(candidate.job_id),
    tax_source_id: String(candidate.tax_source_id),
    structure_run_id: candidate.structure_run_id == null ? null : String(candidate.structure_run_id),
    source_candidate_id: candidateId,
    kind_label: String(candidate.kind_label ?? '').trim() || 'סעיף',
    source_display_identifier: candidate.source_display_identifier == null ? null : String(candidate.source_display_identifier),
    normalized_machine_identifier:
      candidate.normalized_machine_identifier == null ? null : String(candidate.normalized_machine_identifier),
    identifier_base_number: candidate.identifier_base_number == null ? null : String(candidate.identifier_base_number),
    identifier_letter_suffix: candidate.identifier_letter_suffix == null ? null : String(candidate.identifier_letter_suffix),
    identifier_nested_components: nested,
    printed_marker: candidate.printed_marker == null ? null : String(candidate.printed_marker),
    title: candidate.title == null ? null : String(candidate.title),
    parent_draft_id: parentDraftId,
    original_source_text: captured.text,
    draft_legal_text: captured.text,
    original_source_page_start: captured.page_start,
    original_source_page_end: captured.page_end,
    original_source_item_start: captured.item_start,
    original_source_item_end: captured.item_end,
    original_source_line_start: captured.line_start,
    original_source_line_end: captured.line_end,
    original_source_bbox: parseSourceBBox(candidate.source_bbox),
    original_subtree_text: captured.subtree_text,
    original_subtree_page_start: captured.page_start,
    original_subtree_page_end: captured.subtree_page_end,
    original_subtree_item_start: captured.item_start,
    original_subtree_item_end: captured.subtree_item_end,
    original_subtree_line_start: captured.subtree_line_start,
    original_subtree_line_end: captured.subtree_line_end,
    text_boundary_status: captured.boundary_status,
    review_status: reviewStatus,
    created_by: ctx.user.id,
    updated_by: ctx.user.id,
  };

  const { data: created, error: insertError } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .insert(insert)
    .select('id')
    .maybeSingle();
  throwIfDraftSchemaMissing(insertError);
  if (insertError && String(insertError.code) === '23505') {
    const raced = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .select('id, country_code, document_id')
      .eq('document_id', documentId)
      .eq('source_candidate_id', candidateId)
      .maybeSingle();
    if (raced.data) {
      return {
        country_code: String(raced.data.country_code),
        document_id: String(raced.data.document_id),
        draft_id: String(raced.data.id),
        duplicate: true,
      };
    }
  }
  if (insertError) throw insertError;
  if (!created) throw new Error('Legal text draft was not created');
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_CREATED, String(created.id), {
    country_code: insert.country_code,
    document_id: documentId,
    source_candidate_id: candidateId,
    text_boundary_status: captured.boundary_status,
  });
  return {
    country_code: insert.country_code,
    document_id: documentId,
    draft_id: String(created.id),
  };
}

export async function updateLegalTextDraftText(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  if (typeof payload.draft_legal_text !== 'string') throw badRequest('draft_legal_text is required');
  const draft = await loadDraft(draftId);
  const { error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .update({ draft_legal_text: payload.draft_legal_text, updated_by: ctx.user.id })
    .eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_TEXT_UPDATED, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export async function updateLegalTextDraftIdentity(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  const draft = await loadDraft(draftId);
  const patch: Record<string, unknown> = { updated_by: ctx.user.id };
  if (payload.legal_identifier !== undefined || payload.source_display_identifier !== undefined) {
    const raw =
      typeof payload.legal_identifier === 'string'
        ? payload.legal_identifier
        : typeof payload.source_display_identifier === 'string'
          ? payload.source_display_identifier
          : '';
    if (!raw.trim()) throw badRequest('legal_identifier is required');
    const parsed = parseLegalIdentifier(raw);
    if (!parsed) throw badRequest('legal_identifier is not a valid exact legal identifier');
    Object.assign(
      patch,
      identifierFieldsFromParsed(
        parsed,
        payload.printed_marker === undefined
          ? undefined
          : typeof payload.printed_marker === 'string' && payload.printed_marker.trim()
            ? payload.printed_marker.trim()
            : null,
      ),
    );
  }
  if (payload.printed_marker !== undefined && patch.printed_marker === undefined) {
    patch.printed_marker =
      typeof payload.printed_marker === 'string' && payload.printed_marker.trim()
        ? payload.printed_marker.trim()
        : null;
  }
  if (payload.kind_label !== undefined) {
    if (typeof payload.kind_label !== 'string' || !payload.kind_label.trim()) throw badRequest('kind_label is required');
    patch.kind_label = payload.kind_label.trim();
  }
  if (payload.title !== undefined) {
    patch.title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : null;
  }
  if (Object.keys(patch).length <= 1) throw badRequest('No identity fields to update');

  const siblings = await loadDraftsForDocument(String(draft.document_id));
  const next = {
    id: draftId,
    parent_draft_id: draft.parent_draft_id == null ? null : String(draft.parent_draft_id),
    kind_label: String(patch.kind_label ?? draft.kind_label ?? ''),
    normalized_machine_identifier:
      patch.normalized_machine_identifier == null
        ? draft.normalized_machine_identifier == null
          ? null
          : String(draft.normalized_machine_identifier)
        : String(patch.normalized_machine_identifier),
  };
  const conflictRow = findDraftIdentityConflict(
    next,
    siblings.map((row) => ({
      id: String(row.id),
      parent_draft_id: row.parent_draft_id == null ? null : String(row.parent_draft_id),
      kind_label: row.kind_label == null ? null : String(row.kind_label),
      normalized_machine_identifier:
        row.normalized_machine_identifier == null ? null : String(row.normalized_machine_identifier),
    })),
  );
  if (conflictRow) throw conflict('Exact legal identifier already exists under this parent');

  const { error } = await supabaseAdmin.from('legal_ingestion_legal_text_drafts').update(patch).eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_IDENTITY_UPDATED, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    fields: Object.keys(patch).filter((key) => key !== 'updated_by'),
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export async function reparentLegalTextDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  if (!('new_parent_draft_id' in payload) && !('parent_draft_id' in payload)) {
    throw badRequest('new_parent_draft_id is required');
  }
  const newParentId = asOptionalUuid(payload.new_parent_draft_id ?? payload.parent_draft_id, 'new_parent_draft_id');
  const draft = await loadDraft(draftId);
  const siblings = await loadDraftsForDocument(String(draft.document_id));
  const parentRows = siblings.map((row) => ({
    id: String(row.id),
    parent_draft_id: row.parent_draft_id == null ? null : String(row.parent_draft_id),
    document_id: String(row.document_id),
    country_code: String(row.country_code),
    kind_label: row.kind_label == null ? null : String(row.kind_label),
  }));
  if (draftWouldCycle(draftId, newParentId, parentRows)) {
    throw badRequest('Parent draft cannot create a cycle');
  }
  const parent = newParentId ? parentRows.find((row) => row.id === newParentId) ?? null : null;
  if (newParentId && !parent) throw notFound('Parent legal text draft not found');
  const scopeError = reparentScopeError(
    { id: draftId, document_id: String(draft.document_id), country_code: String(draft.country_code) },
    parent,
  );
  if (scopeError) throw badRequest(scopeError);
  const catalog = await loadKindCatalog(String(draft.country_code));
  if (!hierarchyRankCompatible(String(draft.kind_label ?? ''), parent?.kind_label ?? null, catalog)) {
    throw badRequest('Parent hierarchy is not valid for this structure type');
  }
  const conflictRow = findDraftIdentityConflict(
    {
      id: draftId,
      parent_draft_id: newParentId,
      kind_label: draft.kind_label == null ? null : String(draft.kind_label),
      normalized_machine_identifier:
        draft.normalized_machine_identifier == null ? null : String(draft.normalized_machine_identifier),
    },
    siblings.map((row) => ({
      id: String(row.id),
      parent_draft_id: row.parent_draft_id == null ? null : String(row.parent_draft_id),
      kind_label: row.kind_label == null ? null : String(row.kind_label),
      normalized_machine_identifier:
        row.normalized_machine_identifier == null ? null : String(row.normalized_machine_identifier),
    })),
  );
  if (conflictRow) throw conflict('Exact legal identifier already exists under this parent');
  const { error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .update({ parent_draft_id: newParentId, updated_by: ctx.user.id })
    .eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_REPARENTED, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    new_parent_draft_id: newParentId,
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export async function setLegalTextDraftBoundary(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  const draft = await loadDraft(draftId);
  const pageStart = Number(payload.owner_source_page_start ?? payload.page_start);
  const pageEnd = Number(payload.owner_source_page_end ?? payload.page_end ?? pageStart);
  if (!Number.isInteger(pageStart) || pageStart < 1) throw badRequest('owner_source_page_start is required');
  if (!Number.isInteger(pageEnd) || pageEnd < pageStart) throw badRequest('owner_source_page_end is invalid');
  const itemStart =
    payload.owner_source_item_start === undefined || payload.owner_source_item_start === null
      ? null
      : Number(payload.owner_source_item_start);
  const itemEnd =
    payload.owner_source_item_end === undefined || payload.owner_source_item_end === null
      ? null
      : Number(payload.owner_source_item_end);
  if (itemStart != null && (!Number.isInteger(itemStart) || itemStart < 0)) {
    throw badRequest('owner_source_item_start is invalid');
  }
  if (itemEnd != null && (!Number.isInteger(itemEnd) || (itemStart != null && itemEnd < itemStart))) {
    throw badRequest('owner_source_item_end is invalid');
  }
  const resetFromBoundary = payload.reset_from_boundary === true;
  const patch: Record<string, unknown> = {
    owner_source_page_start: pageStart,
    owner_source_page_end: pageEnd,
    owner_source_item_start: itemStart,
    owner_source_item_end: itemEnd,
    owner_source_line_start:
      payload.owner_source_line_start == null ? null : Number(payload.owner_source_line_start),
    owner_source_line_end: payload.owner_source_line_end == null ? null : Number(payload.owner_source_line_end),
    text_boundary_status: 'owner_defined',
    updated_by: ctx.user.id,
  };
  if (resetFromBoundary) {
    const pages = await loadPagesForJob(String(draft.job_id));
    patch.draft_legal_text = captureOwnerDefinedSourceBody(
      { page_start: pageStart, page_end: pageEnd, item_start: itemStart, item_end: itemEnd },
      pages,
    );
  }
  const { error } = await supabaseAdmin.from('legal_ingestion_legal_text_drafts').update(patch).eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_BOUNDARY_SET, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    reset_from_boundary: resetFromBoundary,
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export async function resetLegalTextDraftToSource(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  const draft = await loadDraft(draftId);
  let text = String(draft.original_source_text ?? '');
  if (String(draft.text_boundary_status) === 'owner_defined' && draft.owner_source_page_start != null) {
    const pages = await loadPagesForJob(String(draft.job_id));
    text = captureOwnerDefinedSourceBody(
      {
        page_start: Number(draft.owner_source_page_start),
        page_end: Number(draft.owner_source_page_end ?? draft.owner_source_page_start),
        item_start: draft.owner_source_item_start == null ? null : Number(draft.owner_source_item_start),
        item_end: draft.owner_source_item_end == null ? null : Number(draft.owner_source_item_end),
      },
      pages,
    );
  }
  const { error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .update({ draft_legal_text: text, updated_by: ctx.user.id })
    .eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_RESET_TO_SOURCE, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export async function setLegalTextDraftReviewStatus(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LegalTextDraftCommandResult> {
  const draftId = asUuid(payload.legal_text_draft_id ?? payload.draft_id, 'legal_text_draft_id');
  if (!isLegalTextDraftReviewStatus(payload.review_status)) {
    throw badRequest('review_status must be draft, needs_review, or ready');
  }
  const draft = await loadDraft(draftId);
  if (payload.review_status === 'ready') {
    const siblings = await loadDraftsForDocument(String(draft.document_id));
    const catalog = await loadKindCatalog(String(draft.country_code));
    const parent = draft.parent_draft_id
      ? siblings.find((row) => String(row.id) === String(draft.parent_draft_id))
      : null;
    const conflictRow = findDraftIdentityConflict(
      {
        id: draftId,
        parent_draft_id: draft.parent_draft_id == null ? null : String(draft.parent_draft_id),
        kind_label: draft.kind_label == null ? null : String(draft.kind_label),
        normalized_machine_identifier:
          draft.normalized_machine_identifier == null ? null : String(draft.normalized_machine_identifier),
      },
      siblings.map((row) => ({
        id: String(row.id),
        parent_draft_id: row.parent_draft_id == null ? null : String(row.parent_draft_id),
        kind_label: row.kind_label == null ? null : String(row.kind_label),
        normalized_machine_identifier:
          row.normalized_machine_identifier == null ? null : String(row.normalized_machine_identifier),
      })),
    );
    const ready = validateDraftReady({
      source_display_identifier: draft.source_display_identifier == null ? null : String(draft.source_display_identifier),
      kind_label: draft.kind_label == null ? null : String(draft.kind_label),
      parent_draft_id: draft.parent_draft_id == null ? null : String(draft.parent_draft_id),
      draft_legal_text: String(draft.draft_legal_text ?? ''),
      original_source_text: String(draft.original_source_text ?? ''),
      text_boundary_status: String(draft.text_boundary_status),
      identityConflict: Boolean(conflictRow),
      hierarchyCompatible: hierarchyRankCompatible(
        draft.kind_label == null ? null : String(draft.kind_label),
        parent?.kind_label == null ? null : String(parent.kind_label),
        catalog,
      ),
    });
    if (!ready.ok) throw conflict(ready.message);
  }
  const { error } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .update({ review_status: payload.review_status, updated_by: ctx.user.id })
    .eq('id', draftId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LEGAL_TEXT_DRAFT_REVIEW_STATUS_SET, draftId, {
    country_code: draft.country_code,
    document_id: draft.document_id,
    review_status: payload.review_status,
  });
  return { country_code: String(draft.country_code), document_id: String(draft.document_id), draft_id: draftId };
}

export { loadDraftsForDocument };
