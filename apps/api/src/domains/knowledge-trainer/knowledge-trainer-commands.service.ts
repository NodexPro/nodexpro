import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { assertOwnerLegalCommandAccess } from '../owner-country-legal-access/owner-country-legal-access.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
import { identifierPayloadForCanonicalCreate, parseLegalIdentifier } from '../tax-knowledge/legal-identifier.pure.js';
import { executeTaxKnowledgeCommand } from '../tax-knowledge/tax-knowledge-commands.service.js';
import { TAX_SOURCE_PROVENANCE_TYPES } from '../tax-knowledge/tax-knowledge.types.js';
import { queueLayoutUpdatesByPageStatus } from './knowledge-trainer-layout.pure.js';
import {
  assertCountryAgrees,
  assertV1PdfUpload,
  buildOriginalFileAccess,
  isKnownProvenanceType,
  safeAuditExcerpt,
} from './knowledge-trainer.pure.js';
import { persistStructureCandidatesForJob } from './knowledge-trainer-structure.service.js';
import {
  confirmOwnerStructureCompleteness,
  createLegalTextDraftFromCandidate,
  createManualLegalTextDraft,
  prepareLegalTextDraftsForStructure,
  reparentLegalTextDraft,
  resetLegalTextDraftToSource,
  retractOwnerStructureCompleteness,
  setLegalTextDraftBoundary,
  setLegalTextDraftReviewStatus,
  updateLegalTextDraftIdentity,
  updateLegalTextDraftText,
} from './knowledge-trainer-legal-text-draft.service.js';
import {
  createCorrectedTaxKnowledgeProposal,
  createTaxKnowledgeProposal,
  setTaxKnowledgeProposalReviewStatus,
} from './knowledge-trainer-tax-knowledge-proposal.service.js';
import {
  createOwnerLegalMaterialSignedUrl,
  decodeLegalTrainingUpload,
  storeOwnerLegalMaterial,
} from './knowledge-trainer-storage.service.js';
import {
  MALWARE_SCAN_STATUS_V1,
  OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  OWNER_LEGAL_MATERIALS_BUCKET,
  SOURCE_SPAN_IMMUTABLE_FIELDS,
  isKnowledgeTrainerCommand,
  type KnowledgeTrainerCommandName,
  type KnowledgeTrainerCommandResponse,
} from './knowledge-trainer.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function throwIfTrainerSchemaMissing(error: unknown): void {
  if (error && isSupabaseMissingTableError(error)) {
    throw badRequest('Knowledge Trainer schema is not applied. Migration 624 is required on DEV.');
  }
  if (error && isSupabaseMissingColumnError(error as { code?: string; message?: string })) {
    throw badRequest('Knowledge Trainer layout schema is not applied. Migration 625 is required on DEV.');
  }
  if (error instanceof Error && error.message.includes('Migration 627')) {
    throw badRequest(error.message);
  }
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType,
    entityId,
    action,
    payload,
  });
}

async function refreshed(
  ctx: RequestContext,
  countryCode: string,
  documentId?: string | null,
  legalTextDraftId?: string | null,
  taxKnowledgeProposalId?: string | null,
): Promise<KnowledgeTrainerCommandResponse['refreshed']> {
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, {
      tax_knowledge_country_code: countryCode,
      strategy_engine_country_code: countryCode,
      tax_knowledge_trainer_document_id: documentId ?? undefined,
      tax_knowledge_trainer_legal_text_draft_id: legalTextDraftId ?? undefined,
      tax_knowledge_trainer_proposal_id: taxKnowledgeProposalId ?? undefined,
    }),
  };
}

async function loadSource(sourceId: string): Promise<{ id: string; country_code: string }> {
  const { data, error } = await supabaseAdmin
    .from('tax_sources')
    .select('id, country_code')
    .eq('id', sourceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Tax source not found');
  return { id: String(data.id), country_code: String(data.country_code) };
}

async function loadDocument(documentId: string) {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, country_code, tax_source_id, storage_bucket, storage_key, original_filename')
    .eq('id', documentId)
    .maybeSingle();
  throwIfTrainerSchemaMissing(error);
  if (error) throw error;
  if (!data) throw notFound('Legal training document not found');
  return data;
}

async function loadLatestJob(documentId: string) {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('id, status, document_id, country_code')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfTrainerSchemaMissing(error);
  if (error) throw error;
  if (!data) throw notFound('Legal training job not found');
  return data;
}

async function loadCandidate(candidateId: string) {
  const selectWithIds =
    'id, job_id, document_id, country_code, tax_source_id, candidate_kind, candidate_status, kind_label, node_number, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_letter_suffix, identifier_nested_components, printed_marker, title, parent_candidate_id, parent_tax_legal_node_id, accepted_tax_legal_node_id, structure_run_id';
  const selectLegacy =
    'id, job_id, document_id, country_code, tax_source_id, candidate_kind, candidate_status, kind_label, node_number, title, parent_candidate_id, parent_tax_legal_node_id, accepted_tax_legal_node_id';
  let result = await supabaseAdmin.from('legal_ingestion_candidates').select(selectWithIds).eq('id', candidateId).maybeSingle();
  if (result.error && isSupabaseMissingColumnError(result.error, 'printed_marker')) {
    result = await supabaseAdmin
      .from('legal_ingestion_candidates')
      .select(selectWithIds.replace(', printed_marker', ''))
      .eq('id', candidateId)
      .maybeSingle();
  }
  if (result.error && isSupabaseMissingColumnError(result.error, 'source_display_identifier')) {
    result = await supabaseAdmin.from('legal_ingestion_candidates').select(selectLegacy).eq('id', candidateId).maybeSingle();
  }
  if (result.error && isSupabaseMissingColumnError(result.error, 'structure_run_id')) {
    result = await supabaseAdmin
      .from('legal_ingestion_candidates')
      .select(selectWithIds.replace(', structure_run_id', ''))
      .eq('id', candidateId)
      .maybeSingle();
  }
  throwIfTrainerSchemaMissing(result.error);
  if (result.error) throw result.error;
  if (!result.data) throw notFound('Extraction candidate not found');
  return result.data;
}

async function assertCandidateOnActiveRun(candidate: {
  job_id: unknown;
  structure_run_id?: unknown;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('active_structure_run_id')
    .eq('id', String(candidate.job_id))
    .maybeSingle();
  if (error && isSupabaseMissingColumnError(error, 'active_structure_run_id')) return;
  if (error) throw error;
  const active = data?.active_structure_run_id == null ? null : String(data.active_structure_run_id);
  if (!active) throw conflict('No active complete structure run');
  const runId = candidate.structure_run_id == null ? null : String(candidate.structure_run_id);
  if (runId && runId !== active) {
    throw conflict('Candidate is not on the active structure run');
  }
}

async function handleUpload(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const source = await loadSource(asUuid(payload.tax_source_id, 'tax_source_id'));
  try {
    assertCountryAgrees(source.country_code, payload.country_code);
  } catch (cause) {
    throw forbidden(cause instanceof Error ? cause.message : 'Country mismatch', 'COUNTRY_MISMATCH');
  }
  const provenanceType = typeof payload.provenance_type === 'string' ? payload.provenance_type.trim() : '';
  if (!isKnownProvenanceType(provenanceType)) {
    throw badRequest(`provenance_type must be one of: ${TAX_SOURCE_PROVENANCE_TYPES.join(', ')}`);
  }
  const decoded = decodeLegalTrainingUpload(payload.file_base64, payload.file_name);
  let validated;
  try {
    validated = assertV1PdfUpload({
      input_type: payload.input_type,
      mime_type: payload.mime_type,
      bytes: decoded.bytes,
    });
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'BAD_REQUEST';
    throw badRequest(cause instanceof Error ? cause.message : 'Invalid upload', code);
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, country_code')
    .eq('country_code', source.country_code)
    .eq('tax_source_id', source.id)
    .eq('content_sha256', decoded.content_sha256)
    .maybeSingle();
  throwIfTrainerSchemaMissing(existingError);
  if (existingError) throw existingError;
  if (existing) {
    await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_DOCUMENT_UPLOADED, 'legal_ingestion_document', String(existing.id), {
      country_code: source.country_code,
      tax_source_id: source.id,
      content_sha256: decoded.content_sha256,
      duplicate: true,
    });
    return {
      ok: true,
      command: 'upload_legal_training_document',
      duplicate: true,
      refreshed: await refreshed(ctx, source.country_code, String(existing.id)),
    };
  }

  const stored = await storeOwnerLegalMaterial({
    countryCode: source.country_code,
    taxSourceId: source.id,
    bytes: decoded.bytes,
    mimeType: validated.mime_type,
  });

  const { data: document, error: insertError } = await supabaseAdmin
    .from('legal_ingestion_documents')
    .insert({
      country_code: source.country_code,
      tax_source_id: source.id,
      parent_legal_node_id: asOptionalUuid(payload.parent_legal_node_id, 'parent_legal_node_id'),
      input_type: validated.input_type,
      provenance_type: provenanceType,
      original_filename: decoded.original_filename,
      mime_type: validated.mime_type,
      byte_size: decoded.bytes.length,
      content_sha256: decoded.content_sha256,
      storage_bucket: stored.bucket,
      storage_key: stored.key,
      malware_scan_status: MALWARE_SCAN_STATUS_V1,
      uploaded_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (insertError || !document) {
    throwIfTrainerSchemaMissing(insertError);
    throw insertError ?? new Error('Failed to record legal training document');
  }

  const { error: jobError } = await supabaseAdmin.from('legal_ingestion_jobs').insert({
    document_id: document.id,
    country_code: source.country_code,
    tax_source_id: source.id,
    status: 'queued',
  });
  if (jobError) throw jobError;

  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_DOCUMENT_UPLOADED, 'legal_ingestion_document', String(document.id), {
    country_code: source.country_code,
    tax_source_id: source.id,
    original_filename: decoded.original_filename,
    mime_type: validated.mime_type,
    byte_size: decoded.bytes.length,
    content_sha256: decoded.content_sha256,
    provenance_type: provenanceType,
    malware_scan_status: MALWARE_SCAN_STATUS_V1,
  });
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_EXTRACTION_STARTED, 'legal_ingestion_job', String(document.id), {
    country_code: source.country_code,
    document_id: document.id,
    status: 'queued',
  });

  return {
    ok: true,
    command: 'upload_legal_training_document',
    duplicate: false,
    refreshed: await refreshed(ctx, source.country_code, String(document.id)),
  };
}

async function handleStartExtraction(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const document = await loadDocument(asUuid(payload.legal_ingestion_document_id, 'legal_ingestion_document_id'));
  const job = await loadLatestJob(String(document.id));
  if (job.status === 'uploaded') {
    const { error } = await supabaseAdmin.from('legal_ingestion_jobs').update({ status: 'queued' }).eq('id', job.id);
    if (error) throw error;
  }
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_EXTRACTION_STARTED, 'legal_ingestion_job', String(job.id), {
    country_code: document.country_code,
    document_id: document.id,
    status: 'queued',
  });
  return {
    ok: true,
    command: 'start_legal_document_extraction',
    refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
  };
}

async function handleRetryPage(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const document = await loadDocument(asUuid(payload.legal_ingestion_document_id, 'legal_ingestion_document_id'));
  const pageNo = Number(payload.page_no);
  if (!Number.isInteger(pageNo) || pageNo < 1) throw badRequest('page_no is required');
  const job = await loadLatestJob(String(document.id));
  const { data: page, error } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('id, status')
    .eq('job_id', job.id)
    .eq('page_no', pageNo)
    .maybeSingle();
  if (error) throw error;
  if (!page) throw notFound('Page not found');
  if (page.status === 'extracted') {
    return {
      ok: true,
      command: 'retry_legal_document_page',
      refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
    };
  }
  const { error: updateError } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .update({
      status: 'pending',
      last_error: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq('id', page.id);
  if (updateError) throw updateError;
  await supabaseAdmin.from('legal_ingestion_jobs').update({ status: 'queued' }).eq('id', job.id).in('status', [
    'extraction_failed',
    'partially_extracted',
    'needs_review',
  ]);
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_PAGE_RETRIED, 'legal_ingestion_page', String(page.id), {
    country_code: document.country_code,
    document_id: document.id,
    page_no: pageNo,
  });
  return {
    ok: true,
    command: 'retry_legal_document_page',
    refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
  };
}

async function handleRebuildStructure(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const document = await loadDocument(asUuid(payload.legal_ingestion_document_id, 'legal_ingestion_document_id'));
  const job = await loadLatestJob(String(document.id));
  if (['uploaded', 'queued', 'extracting'].includes(String(job.status))) {
    throw conflict('Wait until page extraction finishes before rebuilding structure');
  }
  let result;
  try {
    result = await persistStructureCandidatesForJob(String(job.id), {
      replaceStaging: true,
      createdBy: ctx.user.id,
    });
  } catch (error) {
    throwIfTrainerSchemaMissing(error);
    throw error;
  }
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_STRUCTURE_REBUILT, 'legal_ingestion_job', String(job.id), {
    country_code: document.country_code,
    document_id: document.id,
    reused_existing_pages: true,
    reuploaded: false,
    reextracted: false,
    preserved_accepted: result?.preserved_accepted ?? 0,
    candidates_found: result?.analysis.candidates_found ?? 0,
    toc_index_rejected: result?.analysis.toc_index_rejected ?? 0,
    structure_run_id: result?.structure_run_id ?? null,
    previous_active_run_id: result?.previous_active_run_id ?? null,
    source_note_count: result?.source_note_count ?? 0,
  });
  if (result?.structure_run_id) {
    await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_STRUCTURE_RUN_ACTIVATED, 'legal_ingestion_structure_run', result.structure_run_id, {
      country_code: document.country_code,
      document_id: document.id,
      job_id: job.id,
      previous_active_run_id: result.previous_active_run_id,
      candidates_found: result.analysis.candidates_found,
    });
  }
  return {
    ok: true,
    command: 'rebuild_legal_structure_candidates',
    refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
  };
}

async function handleReextractLayout(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const document = await loadDocument(asUuid(payload.legal_ingestion_document_id, 'legal_ingestion_document_id'));
  if (!document.storage_key) throw notFound('Original material is not stored');
  const job = await loadLatestJob(String(document.id));
  if (['uploaded', 'queued', 'extracting'].includes(String(job.status))) {
    throw conflict('Wait until page extraction finishes before extracting layout');
  }
  const { data: pages, error } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('id, status, layout_status')
    .eq('job_id', job.id);
  throwIfTrainerSchemaMissing(error);
  if (error) throw error;
  const queued = queueLayoutUpdatesByPageStatus(
    (pages ?? []).map((page) => ({
      id: String(page.id),
      status: String(page.status),
      layout_status: page.layout_status == null ? null : String(page.layout_status),
    })),
  );
  const layoutQueuePatch = { layout_error: null, lease_owner: null, lease_expires_at: null };
  if (queued.pendingIds.length) {
    const { error: pendingError } = await supabaseAdmin
      .from('legal_ingestion_pages')
      .update({ ...layoutQueuePatch, layout_status: 'pending' })
      .in('id', queued.pendingIds);
    if (pendingError) throw pendingError;
  }
  if (queued.skippedIds.length) {
    const { error: skippedError } = await supabaseAdmin
      .from('legal_ingestion_pages')
      .update({ ...layoutQueuePatch, layout_status: 'skipped_needs_ocr' })
      .in('id', queued.skippedIds);
    if (skippedError) throw skippedError;
  }
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_LAYOUT_EXTRACTION_STARTED, 'legal_ingestion_job', String(job.id), {
    country_code: document.country_code,
    document_id: document.id,
    reused_existing_document: true,
    reupload_required: false,
  });
  return {
    ok: true,
    command: 'reextract_legal_document_layout',
    refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
  };
}

async function handleRebuildWithLayout(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const document = await loadDocument(asUuid(payload.legal_ingestion_document_id, 'legal_ingestion_document_id'));
  const job = await loadLatestJob(String(document.id));
  if (['uploaded', 'queued', 'extracting'].includes(String(job.status))) {
    throw conflict('Wait until page extraction finishes before rebuilding structure');
  }
  const { data: readyPages, error } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('id')
    .eq('job_id', job.id)
    .eq('layout_status', 'ready')
    .limit(1);
  throwIfTrainerSchemaMissing(error);
  if (error) throw error;
  if (!readyPages?.length) throw conflict('Extract layout evidence before rebuilding with layout');
  let result;
  try {
    result = await persistStructureCandidatesForJob(String(job.id), {
      replaceStaging: true,
      useLayout: true,
      createdBy: ctx.user.id,
    });
  } catch (error) {
    throwIfTrainerSchemaMissing(error);
    throw error;
  }
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_STRUCTURE_REBUILT_WITH_LAYOUT, 'legal_ingestion_job', String(job.id), {
    country_code: document.country_code,
    document_id: document.id,
    reused_existing_pages: true,
    reuploaded: false,
    layout_used: true,
    preserved_accepted: result?.preserved_accepted ?? 0,
    candidates_found: result?.analysis.candidates_found ?? 0,
    structure_run_id: result?.structure_run_id ?? null,
    previous_active_run_id: result?.previous_active_run_id ?? null,
    source_note_count: result?.source_note_count ?? 0,
  });
  if (result?.structure_run_id) {
    await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_STRUCTURE_RUN_ACTIVATED, 'legal_ingestion_structure_run', result.structure_run_id, {
      country_code: document.country_code,
      document_id: document.id,
      job_id: job.id,
      previous_active_run_id: result.previous_active_run_id,
      candidates_found: result.analysis.candidates_found,
      layout_used: true,
    });
  }
  return {
    ok: true,
    command: 'rebuild_legal_structure_with_layout',
    refreshed: await refreshed(ctx, String(document.country_code), String(document.id)),
  };
}

async function handleUpdateCandidate(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const candidate = await loadCandidate(asUuid(payload.legal_ingestion_candidate_id, 'legal_ingestion_candidate_id'));
  await assertCandidateOnActiveRun(candidate);
  if (candidate.candidate_status === 'accepted' || candidate.candidate_status === 'rejected') {
    throw conflict('Accepted or rejected candidates cannot be edited');
  }
  const patch: Record<string, unknown> = {};
  if (SOURCE_SPAN_IMMUTABLE_FIELDS.some((field) => payload[field] !== undefined)) {
    throw badRequest('Original source span evidence is immutable');
  }
  if (payload.kind_label !== undefined) {
    if (typeof payload.kind_label !== 'string' || !payload.kind_label.trim()) throw badRequest('kind_label is required');
    patch.kind_label = payload.kind_label.trim();
  }
  if (payload.node_number !== undefined) {
    patch.node_number = typeof payload.node_number === 'string' && payload.node_number.trim() ? payload.node_number.trim() : null;
  }
  if (payload.source_display_identifier !== undefined) {
    const raw = typeof payload.source_display_identifier === 'string' ? payload.source_display_identifier.trim() : '';
    if (!raw) {
      patch.source_display_identifier = null;
      patch.normalized_machine_identifier = null;
      patch.identifier_base_number = null;
      patch.identifier_letter_suffix = null;
      patch.identifier_nested_components = [];
      if (payload.printed_marker === undefined) patch.printed_marker = null;
    } else {
      const parsed = parseLegalIdentifier(raw);
      if (!parsed) throw badRequest('source_display_identifier is not a valid exact legal identifier');
      patch.source_display_identifier = parsed.source_display_identifier;
      patch.normalized_machine_identifier = parsed.normalized_machine_identifier;
      patch.identifier_base_number = parsed.base_number;
      patch.identifier_letter_suffix = parsed.letter_suffix;
      patch.identifier_nested_components = parsed.nested_components;
      if (payload.printed_marker === undefined) patch.printed_marker = parsed.printed_marker;
    }
  }
  if (payload.printed_marker !== undefined) {
    patch.printed_marker =
      typeof payload.printed_marker === 'string' && payload.printed_marker.trim()
        ? payload.printed_marker.trim()
        : null;
  }
  if (payload.title !== undefined) {
    patch.title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : null;
  }
  if (payload.parent_candidate_id !== undefined) {
    patch.parent_candidate_id = asOptionalUuid(payload.parent_candidate_id, 'parent_candidate_id');
  }
  if (payload.parent_tax_legal_node_id !== undefined) {
    patch.parent_tax_legal_node_id = asOptionalUuid(payload.parent_tax_legal_node_id, 'parent_tax_legal_node_id');
  }
  if (!Object.keys(patch).length) throw badRequest('No candidate fields to update');
  if (patch.parent_candidate_id && patch.parent_candidate_id === candidate.id) {
    throw badRequest('Candidate cannot be its own parent');
  }
  let { error } = await supabaseAdmin.from('legal_ingestion_candidates').update(patch).eq('id', candidate.id);
  if (error && isSupabaseMissingColumnError(error, 'printed_marker') && 'printed_marker' in patch) {
    const { printed_marker: _printed, ...withoutPrinted } = patch;
    void _printed;
    ({ error } = await supabaseAdmin.from('legal_ingestion_candidates').update(withoutPrinted).eq('id', candidate.id));
  }
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_CANDIDATE_EDITED, 'legal_ingestion_candidate', String(candidate.id), {
    country_code: candidate.country_code,
    document_id: candidate.document_id,
    fields: Object.keys(patch),
  });
  return {
    ok: true,
    command: 'update_legal_extraction_candidate',
    refreshed: await refreshed(ctx, String(candidate.country_code), String(candidate.document_id)),
  };
}

async function handleAcceptCandidate(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const candidate = await loadCandidate(asUuid(payload.legal_ingestion_candidate_id, 'legal_ingestion_candidate_id'));
  await assertCandidateOnActiveRun(candidate);
  if (candidate.candidate_kind !== 'structure') {
    throw badRequest('V1 can accept structure candidates only');
  }
  if (candidate.candidate_status === 'rejected') throw conflict('Rejected candidates cannot be accepted');
  if (candidate.candidate_status === 'accepted' && candidate.accepted_tax_legal_node_id) {
    return {
      ok: true,
      command: 'accept_legal_structure_candidate',
      refreshed: await refreshed(ctx, String(candidate.country_code), String(candidate.document_id)),
    };
  }

  const { data: kinds, error: kindError } = await supabaseAdmin
    .from('tax_legal_node_kinds')
    .select('id, label, country_code')
    .eq('country_code', candidate.country_code);
  if (kindError) throw kindError;
  const kind = (kinds ?? []).find((row) => String(row.label) === String(candidate.kind_label));
  if (!kind) throw badRequest('Structure type is not in this country catalog');

  let parentNodeId = candidate.parent_tax_legal_node_id ? String(candidate.parent_tax_legal_node_id) : null;
  if (!parentNodeId && candidate.parent_candidate_id) {
    const parent = await loadCandidate(String(candidate.parent_candidate_id));
    if (parent.country_code !== candidate.country_code || parent.tax_source_id !== candidate.tax_source_id) {
      throw badRequest('Parent candidate must belong to the same source');
    }
    if (!parent.accepted_tax_legal_node_id) {
      throw conflict('Accept the parent structure candidate first');
    }
    parentNodeId = String(parent.accepted_tax_legal_node_id);
  }

  const title = candidate.title || candidate.kind_label;
  const identifier = identifierPayloadForCanonicalCreate({
    source_display_identifier: candidate.source_display_identifier == null ? null : String(candidate.source_display_identifier),
    normalized_machine_identifier:
      candidate.normalized_machine_identifier == null ? null : String(candidate.normalized_machine_identifier),
    identifier_base_number: candidate.identifier_base_number == null ? null : String(candidate.identifier_base_number),
    identifier_letter_suffix: candidate.identifier_letter_suffix == null ? null : String(candidate.identifier_letter_suffix),
    identifier_nested_components: Array.isArray(candidate.identifier_nested_components)
      ? candidate.identifier_nested_components
      : [],
    printed_marker: candidate.printed_marker == null ? null : String(candidate.printed_marker),
  });
  await executeTaxKnowledgeCommand(ctx, 'create_tax_legal_node', {
    tax_source_id: candidate.tax_source_id,
    tax_legal_node_kind_id: kind.id,
    title,
    node_number: candidate.node_number,
    parent_node_id: parentNodeId,
    ...identifier,
  });
  const { data: createdNode, error: createdError } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id, status, country_code, created_at')
    .eq('tax_source_id', candidate.tax_source_id)
    .eq('title', title)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (createdError || !createdNode) throw createdError ?? new Error('Canonical draft was not created');
  const created = {
    id: String(createdNode.id),
    status: String(createdNode.status),
    country_code: String(createdNode.country_code),
  };

  const { error } = await supabaseAdmin
    .from('legal_ingestion_candidates')
    .update({
      candidate_status: 'accepted',
      accepted_tax_legal_node_id: created.id,
    })
    .eq('id', candidate.id);
  if (error) throw error;

  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_CANDIDATE_ACCEPTED, 'legal_ingestion_candidate', String(candidate.id), {
    country_code: candidate.country_code,
    document_id: candidate.document_id,
    tax_legal_node_id: created.id,
    status: created.status,
    excerpt: safeAuditExcerpt(candidate.title),
  });
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_CANONICAL_DRAFT_CREATED, 'tax_legal_node', created.id, {
    country_code: created.country_code,
    from_candidate_id: candidate.id,
    status: created.status,
  });

  return {
    ok: true,
    command: 'accept_legal_structure_candidate',
    refreshed: await refreshed(ctx, created.country_code, String(candidate.document_id)),
  };
}

async function handleRejectCandidate(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  const candidate = await loadCandidate(asUuid(payload.legal_ingestion_candidate_id, 'legal_ingestion_candidate_id'));
  await assertCandidateOnActiveRun(candidate);
  if (candidate.candidate_status === 'accepted') {
    throw conflict('Accepted candidates cannot be rejected');
  }
  const { error } = await supabaseAdmin
    .from('legal_ingestion_candidates')
    .update({ candidate_status: 'rejected' })
    .eq('id', candidate.id);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_CANDIDATE_REJECTED, 'legal_ingestion_candidate', String(candidate.id), {
    country_code: candidate.country_code,
    document_id: candidate.document_id,
  });
  return {
    ok: true,
    command: 'reject_legal_extraction_candidate',
    refreshed: await refreshed(ctx, String(candidate.country_code), String(candidate.document_id)),
  };
}

export async function executeKnowledgeTrainerCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<KnowledgeTrainerCommandResponse> {
  await assertOwnerLegalCommandAccess(ctx, command, payload);
  if (!isKnowledgeTrainerCommand(command)) {
    throw badRequest(`Unsupported knowledge-trainer command: ${command || 'unknown'}`);
  }
  switch (command as KnowledgeTrainerCommandName) {
    case 'upload_legal_training_document':
      return handleUpload(ctx, payload);
    case 'start_legal_document_extraction':
      return handleStartExtraction(ctx, payload);
    case 'retry_legal_document_page':
      return handleRetryPage(ctx, payload);
    case 'rebuild_legal_structure_candidates':
      return handleRebuildStructure(ctx, payload);
    case 'reextract_legal_document_layout':
      return handleReextractLayout(ctx, payload);
    case 'rebuild_legal_structure_with_layout':
      return handleRebuildWithLayout(ctx, payload);
    case 'update_legal_extraction_candidate':
      return handleUpdateCandidate(ctx, payload);
    case 'accept_legal_structure_candidate':
      return handleAcceptCandidate(ctx, payload);
    case 'reject_legal_extraction_candidate':
      return handleRejectCandidate(ctx, payload);
    case 'create_legal_text_draft_from_candidate':
      return handleLegalTextDraftCommand(ctx, 'create_legal_text_draft_from_candidate', payload, createLegalTextDraftFromCandidate);
    case 'prepare_legal_text_drafts_for_structure':
      return handleLegalTextDraftCommand(ctx, 'prepare_legal_text_drafts_for_structure', payload, prepareLegalTextDraftsForStructure);
    case 'update_legal_text_draft_text':
      return handleLegalTextDraftCommand(ctx, 'update_legal_text_draft_text', payload, updateLegalTextDraftText);
    case 'update_legal_text_draft_identity':
      return handleLegalTextDraftCommand(ctx, 'update_legal_text_draft_identity', payload, updateLegalTextDraftIdentity);
    case 'reparent_legal_text_draft':
      return handleLegalTextDraftCommand(ctx, 'reparent_legal_text_draft', payload, reparentLegalTextDraft);
    case 'set_legal_text_draft_boundary':
      return handleLegalTextDraftCommand(ctx, 'set_legal_text_draft_boundary', payload, setLegalTextDraftBoundary);
    case 'reset_legal_text_draft_to_source':
      return handleLegalTextDraftCommand(ctx, 'reset_legal_text_draft_to_source', payload, resetLegalTextDraftToSource);
    case 'set_legal_text_draft_review_status':
      return handleLegalTextDraftCommand(ctx, 'set_legal_text_draft_review_status', payload, setLegalTextDraftReviewStatus);
    case 'create_manual_legal_text_draft':
      return handleLegalTextDraftCommand(ctx, 'create_manual_legal_text_draft', payload, createManualLegalTextDraft);
    case 'confirm_owner_structure_completeness':
      return handleLegalTextDraftCommand(ctx, 'confirm_owner_structure_completeness', payload, confirmOwnerStructureCompleteness);
    case 'retract_owner_structure_completeness':
      return handleLegalTextDraftCommand(ctx, 'retract_owner_structure_completeness', payload, retractOwnerStructureCompleteness);
    case 'create_tax_knowledge_proposal':
      return handleTaxKnowledgeProposalCommand(ctx, 'create_tax_knowledge_proposal', payload, createTaxKnowledgeProposal);
    case 'set_tax_knowledge_proposal_review_status':
      return handleTaxKnowledgeProposalCommand(ctx, 'set_tax_knowledge_proposal_review_status', payload, setTaxKnowledgeProposalReviewStatus);
    case 'create_corrected_tax_knowledge_proposal':
      return handleTaxKnowledgeProposalCommand(ctx, 'create_corrected_tax_knowledge_proposal', payload, createCorrectedTaxKnowledgeProposal);
    default:
      throw badRequest(`Unsupported knowledge-trainer command: ${command}`);
  }
}

async function handleLegalTextDraftCommand(
  ctx: RequestContext,
  command: KnowledgeTrainerCommandName,
  payload: Record<string, unknown>,
  run: typeof createLegalTextDraftFromCandidate,
): Promise<KnowledgeTrainerCommandResponse> {
  const result = await run(ctx, payload);
  return {
    ok: true,
    command,
    duplicate: result.duplicate,
    created_count: result.created_count,
    skipped_existing_count: result.skipped_existing_count,
    remaining_count: result.remaining_count,
    uncertain_count: result.uncertain_count,
    refreshed: await refreshed(ctx, result.country_code, result.document_id, result.draft_id || null),
  };
}

async function handleTaxKnowledgeProposalCommand(
  ctx: RequestContext,
  command: KnowledgeTrainerCommandName,
  payload: Record<string, unknown>,
  run: typeof createTaxKnowledgeProposal,
): Promise<KnowledgeTrainerCommandResponse> {
  const result = await run(ctx, payload);
  return {
    ok: true,
    command,
    refreshed: await refreshed(
      ctx,
      result.country_code,
      result.document_id,
      result.draft_id,
      result.proposal_id,
    ),
  };
}

export async function openLegalTrainingDocumentFile(
  ctx: RequestContext,
  documentId: string,
): Promise<{ filename: string; signed_url: string; expires_at: string; expires_in_sec: number }> {
  await assertOwnerLegalCommandAccess(ctx, 'upload_legal_training_document', {
    legal_ingestion_document_id: documentId,
  });
  const document = await loadDocument(documentId);
  if (!document.storage_key) throw notFound('Original material is not stored');
  const signedUrl = await createOwnerLegalMaterialSignedUrl(
    String(document.storage_bucket || OWNER_LEGAL_MATERIALS_BUCKET),
    String(document.storage_key),
    OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  );
  await audit(ctx, AUDIT_ACTIONS.LEGAL_TRAINING_DOCUMENT_OPENED, 'legal_ingestion_document', documentId, {
    country_code: document.country_code,
  });
  const access = buildOriginalFileAccess(
    String(document.original_filename),
    signedUrl,
    OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  );
  return {
    filename: access.filename,
    signed_url: access.url,
    expires_at: access.expires_at,
    expires_in_sec: access.expires_in_sec,
  };
}

export { isKnowledgeTrainerCommand, KNOWLEDGE_TRAINER_COMMANDS } from './knowledge-trainer.types.js';
