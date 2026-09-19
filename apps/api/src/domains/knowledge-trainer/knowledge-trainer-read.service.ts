import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { summarizeLayoutReadiness } from './knowledge-trainer-layout.pure.js';
import { fetchAllPaged } from './knowledge-trainer-pagination.js';
import {
  attachStructureCompleteness,
  buildLegalTextReviewNodes,
  buildLegalTextSearchIndex,
  creationOriginFromDraft,
  displayDraftLabel,
  draftCreateFrontier,
  notesOverlappingDraftSpan,
} from './knowledge-trainer-legal-text-draft.pure.js';
import {
  allowedTaxKnowledgeProposalReviewStatuses,
  pickSelectedTaxKnowledgeProposal,
  taxKnowledgeProposalAllowedActions,
  taxKnowledgeProposalStatusLabel,
} from './knowledge-trainer-tax-knowledge-proposal.pure.js';
import {
  buildTaxKnowledgeProposalOwnerView,
  emptyTaxKnowledgeProposalOwnerView,
} from './tax-knowledge-proposal-owner-view.pure.js';
import { validateTaxKnowledgeProposalV1AgainstStore } from './tax-knowledge-proposal-v1-catalog.service.js';
import {
  canOwnerApproveTaxKnowledgeProposal,
  emptyTaxKnowledgeProposalValidationResult,
  summarizeTaxKnowledgeProposalValidation,
} from './tax-knowledge-proposal-v1.pure.js';
import { attachStructureReviewModel, describeStoredLayoutEvidence } from './knowledge-trainer-review.pure.js';
import { emptySourceNoteSummary, parseSourceBBox, summarizeSourceNotes } from './knowledge-trainer-source-notes.pure.js';
import { structureRunStatusLabel } from './knowledge-trainer-structure-run.pure.js';
import { createOwnerLegalMaterialSignedUrl } from './knowledge-trainer-storage.service.js';
import {
  buildOriginalFileAccess,
  decodeStructureAnalysis,
  emptyStructureAnalysis,
  jobStatusLabel,
  trainerInputOptions,
} from './knowledge-trainer.pure.js';
import {
  OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  OWNER_LEGAL_MATERIALS_BUCKET,
} from './knowledge-trainer.types.js';
import type {
  KnowledgeTrainerCandidateDto,
  KnowledgeTrainerDocumentSummaryDto,
  KnowledgeTrainerDraftCreateFrontierItemDto,
  KnowledgeTrainerLegalTextDraftDto,
  KnowledgeTrainerLegalTextDraftListItemDto,
  KnowledgeTrainerLegalTextDraftSummaryDto,
  KnowledgeTrainerLegalTextReviewNodeDto,
  KnowledgeTrainerLegalTextSearchIndexItemDto,
  KnowledgeTrainerLegalTextCompletenessDto,
  KnowledgeTrainerSliceDto,
  KnowledgeTrainerSourceNoteAnchorDto,
  KnowledgeTrainerSourceNoteDto,
  KnowledgeTrainerTaxKnowledgeProposalDetailDto,
  KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto,
  KnowledgeTrainerTaxKnowledgeProposalSliceDto,
  LegalIngestionJobStatus,
  LegalIngestionPageStatus,
  SourceNoteClassification,
  SourceNoteInlineLinkStatus,
  SourceNoteOriginZone,
  SourceNoteReviewStatus,
  StructureRunReadDto,
} from './knowledge-trainer.types.js';

export type KnowledgeTrainerReadOpts = {
  document_id?: string | null;
  page_no?: number | null;
  tax_source_id?: string | null;
  legal_text_draft_id?: string | null;
  tax_knowledge_proposal_id?: string | null;
};

function action(actionKey: string, enabled: boolean, required: Record<string, string>) {
  return { action_key: actionKey, enabled, required_fields: required };
}

export function emptyKnowledgeTrainerSlice(available: boolean): KnowledgeTrainerSliceDto {
  return {
    available,
    schema_applied: available,
    status_label: available ? 'Available' : 'Coming later',
    malware_scanning: 'not_implemented',
    input_options: trainerInputOptions(available),
    documents: [],
    selected_document: null,
    allowed_actions: available
      ? [
          action('upload_legal_training_document', true, {
            tax_source_id: 'uuid',
            input_type: 'pdf',
            file_base64: 'string',
            file_name: 'string',
            mime_type: 'application/pdf',
            provenance_type: 'existing provenance taxonomy',
          }),
        ]
      : [],
  };
}

export async function buildKnowledgeTrainerSlice(
  countryCode: string,
  opts?: KnowledgeTrainerReadOpts,
): Promise<KnowledgeTrainerSliceDto> {
  const { data: documents, error } = await supabaseAdmin
    .from('legal_ingestion_documents')
    .select('id, tax_source_id, original_filename, input_type, provenance_type, created_at, storage_bucket, storage_key')
    .eq('country_code', countryCode)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    if (isSupabaseMissingTableError(error)) return emptyKnowledgeTrainerSlice(false);
    throw error;
  }

  const documentIds = (documents ?? []).map((row) => String(row.id));
  const jobSelectWithRun =
    'id, document_id, status, page_count, extracted_page_count, needs_ocr_page_count, failed_page_count, structure_candidate_count, last_error, created_at, active_structure_run_id';
  const jobSelectLegacy =
    'id, document_id, status, page_count, extracted_page_count, needs_ocr_page_count, failed_page_count, structure_candidate_count, last_error, created_at';
  let jobsResult: { data: Array<Record<string, unknown>> | null; error: { message?: string; code?: string } | null } =
    documentIds.length
      ? await supabaseAdmin
          .from('legal_ingestion_jobs')
          .select(jobSelectWithRun)
          .in('document_id', documentIds)
          .order('created_at', { ascending: false })
      : { data: [], error: null };
  if (jobsResult.error && isSupabaseMissingColumnError(jobsResult.error, 'active_structure_run_id')) {
    jobsResult = documentIds.length
      ? await supabaseAdmin
          .from('legal_ingestion_jobs')
          .select(jobSelectLegacy)
          .in('document_id', documentIds)
          .order('created_at', { ascending: false })
      : { data: [], error: null };
  }
  if (jobsResult.error) throw jobsResult.error;
  const jobs = jobsResult.data;

  const jobRows = jobs ?? [];
  const latestJobByDocument = new Map<string, (typeof jobRows)[number]>();
  for (const job of jobRows) {
    const documentId = String(job.document_id);
    if (!latestJobByDocument.has(documentId)) latestJobByDocument.set(documentId, job);
  }

  const summaries: KnowledgeTrainerDocumentSummaryDto[] = (documents ?? []).map((row) => {
    const job = latestJobByDocument.get(String(row.id));
    const runSchema = Boolean(job && Object.prototype.hasOwnProperty.call(job, 'active_structure_run_id'));
    const visibleCount =
      runSchema && !job?.active_structure_run_id ? 0 : Number(job?.structure_candidate_count ?? 0);
    return {
      id: String(row.id),
      tax_source_id: String(row.tax_source_id),
      original_filename: String(row.original_filename),
      input_type: row.input_type as KnowledgeTrainerDocumentSummaryDto['input_type'],
      provenance_type: String(row.provenance_type),
      page_count: Number(job?.page_count ?? 0),
      extracted_page_count: Number(job?.extracted_page_count ?? 0),
      needs_ocr_page_count: Number(job?.needs_ocr_page_count ?? 0),
      failed_page_count: Number(job?.failed_page_count ?? 0),
      structure_candidate_count: visibleCount,
      job_status: String(job?.status ?? 'uploaded') as LegalIngestionJobStatus,
      job_status_label: jobStatusLabel(String(job?.status ?? 'uploaded')),
      duplicate_of_existing: false,
    };
  });

  const filtered = opts?.tax_source_id
    ? summaries.filter((row) => row.tax_source_id === opts.tax_source_id)
    : summaries;
  const selectedId = opts?.document_id || filtered[0]?.id || null;
  const selectedSummary = filtered.find((row) => row.id === selectedId) ?? null;
  const selectedJob = selectedId ? latestJobByDocument.get(selectedId) : null;

  let selected: KnowledgeTrainerSliceDto['selected_document'] = null;
  if (selectedSummary && selectedJob) {
    let pages: Array<{
      page_no: number;
      status: string;
      page_text?: string | null;
      layout_status?: string | null;
      layout_item_count?: number | null;
    }>;
    try {
      pages = await fetchAllPaged((from, to) =>
        supabaseAdmin
          .from('legal_ingestion_pages')
          .select('page_no, status, layout_status, layout_item_count')
          .eq('job_id', selectedJob.id)
          .order('page_no', { ascending: true })
          .range(from, to),
      );
    } catch (error) {
      if (!isSupabaseMissingColumnError(error as { message?: string; code?: string })) throw error;
      pages = await fetchAllPaged((from, to) =>
        supabaseAdmin
          .from('legal_ingestion_pages')
          .select('page_no, status')
          .eq('job_id', selectedJob.id)
          .order('page_no', { ascending: true })
          .range(from, to),
      );
    }
    const structureRunSchemaApplied = Object.prototype.hasOwnProperty.call(selectedJob, 'active_structure_run_id');
    const activeRunId =
      selectedJob.active_structure_run_id == null ? null : String(selectedJob.active_structure_run_id);
    const candidateSelect =
      'id, candidate_kind, candidate_status, kind_label, node_number, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_letter_suffix, identifier_nested_components, printed_marker, title, parent_candidate_id, parent_tax_legal_node_id, page_start, page_end, source_page, source_item_start, source_item_end, source_line_index, source_bbox, excerpt, confidence, validation_warnings, matched_tax_legal_node_id, accepted_tax_legal_node_id, sort_order, structure_run_id';
    const candidateSelectLegacy =
      'id, candidate_kind, candidate_status, kind_label, node_number, title, parent_candidate_id, parent_tax_legal_node_id, page_start, page_end, excerpt, confidence, validation_warnings, matched_tax_legal_node_id, accepted_tax_legal_node_id, sort_order';
    const selectedJobId = String(selectedJob.id);
    async function loadCandidatesBy(columns: string): Promise<Array<Record<string, unknown>>> {
      return fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabaseAdmin
          .from('legal_ingestion_candidates')
          .select(columns)
          .eq('job_id', selectedJobId)
          .order('sort_order', { ascending: true })
          .range(from, to) as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message?: string; code?: string } | null }>,
      );
    }
    let candidates: Array<Record<string, unknown>> = [];
    if (structureRunSchemaApplied && !activeRunId) {
      candidates = [];
    } else {
      try {
        candidates = await fetchAllPaged((from, to) => {
          let query = supabaseAdmin
            .from('legal_ingestion_candidates')
            .select(candidateSelect)
            .eq('job_id', selectedJob.id)
            .order('sort_order', { ascending: true })
            .range(from, to);
          if (activeRunId) query = query.eq('structure_run_id', activeRunId);
          return query;
        });
      } catch (error) {
        if (isSupabaseMissingColumnError(error as { message?: string; code?: string }, 'printed_marker')) {
          candidates = await loadCandidatesBy(candidateSelect.replace(', printed_marker', ''));
        } else if (isSupabaseMissingColumnError(error as { message?: string; code?: string }, 'source_page')) {
          candidates = await loadCandidatesBy(
            candidateSelect.replace(', source_page, source_item_start, source_item_end, source_line_index, source_bbox', ''),
          );
        } else if (isSupabaseMissingColumnError(error as { message?: string; code?: string }, 'source_display_identifier')) {
          candidates = await loadCandidatesBy(candidateSelectLegacy);
        } else if (isSupabaseMissingColumnError(error as { message?: string; code?: string }, 'structure_run_id')) {
          candidates = await loadCandidatesBy(candidateSelect.replace(', structure_run_id', ''));
        } else {
          throw error;
        }
      }
    }

    const pageNo = opts?.page_no && opts.page_no > 0 ? opts.page_no : pages?.[0] ? Number(pages[0].page_no) : null;
    const selectedPageMeta = pages?.find((page) => Number(page.page_no) === pageNo) ?? null;
    const selectedPageText = pageNo
      ? await supabaseAdmin
          .from('legal_ingestion_pages')
          .select('page_no, page_text, status')
          .eq('job_id', selectedJob.id)
          .eq('page_no', pageNo)
          .maybeSingle()
      : { data: null, error: null };
    if (selectedPageText.error) throw selectedPageText.error;
    const selectedPage = selectedPageText.data
      ? {
          page_no: Number(selectedPageText.data.page_no),
          page_text: selectedPageText.data.page_text == null ? null : String(selectedPageText.data.page_text),
          status: String(selectedPageText.data.status),
        }
      : selectedPageMeta;
    const ocrPageNumbers = (pages ?? [])
      .filter((page) => String(page.status) === 'needs_ocr')
      .map((page) => Number(page.page_no))
      .filter((page) => page > 0);
    const { data: kinds } = await supabaseAdmin
      .from('tax_legal_node_kinds')
      .select('id, label')
      .eq('country_code', countryCode)
      .order('sort_order', { ascending: true });
    let buildingRun: { id: string } | null = null;
    let lastFailed: { id: string; failure_reason: string | null } | null = null;
    let activeRunMeta: { detector_version: string | null; status: string | null } | null = null;
    if (structureRunSchemaApplied) {
      const { data: runRows, error: runError } = await supabaseAdmin
        .from('legal_ingestion_structure_runs')
        .select('id, status, detector_version, failure_reason, started_at')
        .eq('job_id', selectedJob.id)
        .in('status', ['building', 'ready', 'failed'])
        .order('started_at', { ascending: false });
      if (runError && !isSupabaseMissingTableError(runError)) throw runError;
      for (const row of runRows ?? []) {
        if (String(row.status) === 'building' && !buildingRun) buildingRun = { id: String(row.id) };
        if (String(row.status) === 'failed' && !lastFailed) {
          lastFailed = {
            id: String(row.id),
            failure_reason: row.failure_reason == null ? null : String(row.failure_reason),
          };
        }
        if (activeRunId && String(row.id) === activeRunId) {
          activeRunMeta = {
            detector_version: row.detector_version == null ? null : String(row.detector_version),
            status: String(row.status),
          };
        }
      }
    }
    const structureRun: StructureRunReadDto = {
      schema_applied: structureRunSchemaApplied,
      active_run_id: activeRunId,
      active_status: activeRunMeta?.status ?? (activeRunId ? 'ready' : null),
      detector_version: activeRunMeta?.detector_version ?? null,
      visible_candidate_count: candidates?.length ?? 0,
      building_run_id: buildingRun?.id ?? null,
      building_status_label: buildingRun
        ? 'Building. Not visible until atomic cutover.'
        : null,
      last_failed_run_id: lastFailed?.id ?? null,
      last_failed_reason: lastFailed?.failure_reason ?? null,
      status_label: structureRunStatusLabel({
        schema_applied: structureRunSchemaApplied,
        active_run_id: activeRunId,
        building_run_id: buildingRun?.id ?? null,
      }),
    };
    const baseCandidates = (candidates ?? []).map((row) => {
        const warnings = Array.isArray(row.validation_warnings)
          ? row.validation_warnings.map((item) => String(item))
          : [];
        return {
          id: String(row.id),
          candidate_kind: row.candidate_kind as KnowledgeTrainerCandidateDto['candidate_kind'],
          candidate_status: row.candidate_status as KnowledgeTrainerCandidateDto['candidate_status'],
          kind_label: row.kind_label == null ? null : String(row.kind_label),
          node_number: row.node_number == null ? null : String(row.node_number),
          source_display_identifier:
            row.source_display_identifier == null ? null : String(row.source_display_identifier),
          normalized_machine_identifier:
            row.normalized_machine_identifier == null ? null : String(row.normalized_machine_identifier),
          identifier_base_number: row.identifier_base_number == null ? null : String(row.identifier_base_number),
          identifier_letter_suffix:
            row.identifier_letter_suffix == null ? null : String(row.identifier_letter_suffix),
          identifier_nested_components: Array.isArray(row.identifier_nested_components)
            ? row.identifier_nested_components.map((item) => String(item))
            : [],
          printed_marker: row.printed_marker == null ? null : String(row.printed_marker),
          title: row.title == null ? null : String(row.title),
          parent_candidate_id: row.parent_candidate_id == null ? null : String(row.parent_candidate_id),
          parent_tax_legal_node_id: row.parent_tax_legal_node_id == null ? null : String(row.parent_tax_legal_node_id),
          page_start: row.page_start == null ? null : Number(row.page_start),
          page_end: row.page_end == null ? null : Number(row.page_end),
          source_page: row.source_page == null ? null : Number(row.source_page),
          source_item_start: row.source_item_start == null ? null : Number(row.source_item_start),
          source_item_end: row.source_item_end == null ? null : Number(row.source_item_end),
          source_line_index: row.source_line_index == null ? null : Number(row.source_line_index),
          source_bbox: parseSourceBBox(row.source_bbox),
          excerpt: row.excerpt == null ? null : String(row.excerpt),
          confidence: row.confidence == null ? null : Number(row.confidence),
          validation_warnings: warnings,
          matched_tax_legal_node_id: row.matched_tax_legal_node_id == null ? null : String(row.matched_tax_legal_node_id),
          accepted_tax_legal_node_id: row.accepted_tax_legal_node_id == null ? null : String(row.accepted_tax_legal_node_id),
          sort_order: Number(row.sort_order ?? 0),
          possible_existing_match: Boolean(row.matched_tax_legal_node_id),
        };
      });
    const structureAnalysis = decodeStructureAnalysis(
      typeof selectedJob.last_error === 'string' ? selectedJob.last_error : null,
    ) ?? {
      ...emptyStructureAnalysis(),
      candidates_found: selectedSummary.structure_candidate_count,
      ocr_pages_untouched: selectedSummary.needs_ocr_page_count,
      ocr_gap_warning: selectedSummary.needs_ocr_page_count > 0,
      low_confidence_count: (candidates ?? []).filter((row) => Number(row.confidence ?? 1) < 0.55).length,
      unresolved_parent_count: (candidates ?? []).filter(
        (row) =>
          Array.isArray(row.validation_warnings) &&
          row.validation_warnings.map((item) => String(item)).includes('unresolved_parent'),
      ).length,
    };
    const layoutSummary = summarizeLayoutReadiness(
      (pages ?? []).map((page) => ({
        status: String(page.status),
        layout_status: page.layout_status == null ? null : String(page.layout_status),
        layout_item_count: Number(page.layout_item_count ?? 0),
      })),
    );
    const reviewed = attachStructureReviewModel(baseCandidates, {
      catalog: (kinds ?? []).map((row) => ({ id: String(row.id), label: String(row.label) })),
      ocr_pages: ocrPageNumbers,
      layout_used: structureAnalysis.layout_used === true,
    });
    const canExtract =
      Boolean(selectedSummary) && !['uploaded', 'queued', 'extracting'].includes(selectedSummary.job_status);
    const selectedRow = (documents ?? []).find((row) => String(row.id) === selectedSummary.id);
    const storageKey = String((selectedRow as { storage_key?: string | null } | undefined)?.storage_key ?? '');
    const storageBucket = String(
      (selectedRow as { storage_bucket?: string | null } | undefined)?.storage_bucket || OWNER_LEGAL_MATERIALS_BUCKET,
    );
    let originalFileAccess = null;
    if (storageKey) {
      try {
        const url = await createOwnerLegalMaterialSignedUrl(
          storageBucket,
          storageKey,
          OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
        );
        originalFileAccess = buildOriginalFileAccess(
          selectedSummary.original_filename,
          url,
          OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
        );
      } catch {
        originalFileAccess = null;
      }
    }
    const sourceEvidence = await loadSourceNotesForActiveRun(activeRunId);
    selected = {
      id: selectedSummary.id,
      original_filename: selectedSummary.original_filename,
      job_status: selectedSummary.job_status,
      job_status_label: selectedSummary.job_status_label,
      page_count: selectedSummary.page_count,
      extracted_page_count: selectedSummary.extracted_page_count,
      needs_ocr_page_count: selectedSummary.needs_ocr_page_count,
      failed_page_count: selectedSummary.failed_page_count,
      structure_candidate_count: structureRunSchemaApplied && !activeRunId ? 0 : selectedSummary.structure_candidate_count,
      pages: (pages ?? []).map((page) => ({
        page_no: Number(page.page_no),
        status: String(page.status) as LegalIngestionPageStatus,
        has_text: String(page.status) === 'extracted',
      })),
      selected_page: selectedPage
        ? {
            page_no: Number(selectedPage.page_no),
            text: typeof selectedPage.page_text === 'string' ? selectedPage.page_text : null,
            status: String(selectedPage.status) as LegalIngestionPageStatus,
          }
        : null,
      candidates: reviewed.candidates,
      source_notes: sourceEvidence.notes,
      source_note_summary: sourceEvidence.summary,
      unresolved_source_note_anchors: sourceEvidence.unresolved_anchors,
      can_open_original: Boolean(storageKey),
      original_file_access: originalFileAccess,
      structure_analysis: structureAnalysis,
      can_rebuild_structure: canExtract,
      review_summary: reviewed.review_summary,
      review_filters: reviewed.review_filters,
      structure_tree: reviewed.structure_tree,
      ocr_page_numbers: ocrPageNumbers,
      structure_run: structureRun,
      ...mapLegalTextDraftSlice(
        await loadLegalTextDraftsForDocument(selectedSummary.id, sourceEvidence.notes, {
          selectedDraftId: opts?.legal_text_draft_id,
          selectedProposalId: opts?.tax_knowledge_proposal_id,
          candidates: reviewed.candidates,
        }),
      ),
      layout_evidence: describeStoredLayoutEvidence(pages ?? []),
      layout_readiness: {
        ...layoutSummary,
        high_confidence_trusted: structureAnalysis.layout_used === true,
        reupload_required: false,
        reuse_document_label: 'Existing document reused. No re-upload required.',
        can_extract_layout: canExtract,
        can_rebuild_with_layout: canExtract && layoutSummary.readiness === 'ready',
        pages: (pages ?? []).map((page) => ({
          page_no: Number(page.page_no),
          layout_status: page.layout_status == null ? 'not_extracted' : String(page.layout_status),
          item_count: Number(page.layout_item_count ?? 0),
        })),
      },
    };
  }

  const proposalActions = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: Boolean(selected?.selected_legal_text_draft),
    selectedDraftReviewStatus: selected?.selected_legal_text_draft?.review_status ?? null,
    selectedProposalStatus: selected?.tax_knowledge_proposals.selected?.status ?? null,
    publicationEligible: selected?.tax_knowledge_proposals.selected?.validation?.publication_eligible === true,
  });

  return {
    available: true,
    schema_applied: true,
    status_label: 'Available',
    malware_scanning: 'not_implemented',
    input_options: trainerInputOptions(true),
    documents: filtered,
    selected_document: selected,
    allowed_actions: [
      action('upload_legal_training_document', true, {
        tax_source_id: 'uuid',
        input_type: 'pdf',
        file_base64: 'string',
        file_name: 'string',
        mime_type: 'application/pdf',
        provenance_type: 'existing provenance taxonomy',
      }),
      action('retry_legal_document_page', true, {
        legal_ingestion_document_id: 'uuid',
        page_no: 'integer',
      }),
      action('rebuild_legal_structure_candidates', Boolean(selected && !['uploaded', 'queued', 'extracting'].includes(selected.job_status)), {
        legal_ingestion_document_id: 'uuid',
      }),
      action('reextract_legal_document_layout', Boolean(selected?.layout_readiness.can_extract_layout), {
        legal_ingestion_document_id: 'uuid',
      }),
      action('rebuild_legal_structure_with_layout', Boolean(selected?.layout_readiness.can_rebuild_with_layout), {
        legal_ingestion_document_id: 'uuid',
      }),
      action('update_legal_extraction_candidate', true, {
        legal_ingestion_candidate_id: 'uuid',
        kind_label: 'optional string',
        node_number: 'optional string',
        source_display_identifier: 'optional exact legal identifier',
        printed_marker: 'optional printed local marker',
        title: 'optional string',
        parent_candidate_id: 'optional uuid',
        parent_tax_legal_node_id: 'optional uuid',
      }),
      action('accept_legal_structure_candidate', true, {
        legal_ingestion_candidate_id: 'uuid',
      }),
      action('reject_legal_extraction_candidate', true, {
        legal_ingestion_candidate_id: 'uuid',
      }),
      action('create_legal_text_draft_from_candidate', Boolean(selected), {
        legal_ingestion_document_id: 'uuid',
        legal_ingestion_candidate_id: 'uuid',
      }),
      action('prepare_legal_text_drafts_for_structure', Boolean(selected && selected.structure_candidate_count > 0), {
        legal_ingestion_document_id: 'uuid',
      }),
      action('update_legal_text_draft_text', true, {
        legal_text_draft_id: 'uuid',
        draft_legal_text: 'string',
      }),
      action('update_legal_text_draft_identity', true, {
        legal_text_draft_id: 'uuid',
        legal_identifier: 'optional exact legal identifier',
        printed_marker: 'optional printed local marker',
        kind_label: 'optional string',
        title: 'optional string',
      }),
      action('reparent_legal_text_draft', true, {
        legal_text_draft_id: 'uuid',
        new_parent_draft_id: 'uuid or null',
      }),
      action('set_legal_text_draft_boundary', true, {
        legal_text_draft_id: 'uuid',
        owner_source_page_start: 'integer',
        owner_source_page_end: 'optional integer',
        owner_source_item_start: 'optional integer',
        owner_source_item_end: 'optional integer',
        reset_from_boundary: 'optional boolean',
      }),
      action('reset_legal_text_draft_to_source', true, {
        legal_text_draft_id: 'uuid',
      }),
      action('set_legal_text_draft_review_status', true, {
        legal_text_draft_id: 'uuid',
        review_status: 'draft | needs_review | ready',
      }),
      action('create_manual_legal_text_draft', Boolean(selected), {
        legal_ingestion_document_id: 'uuid',
        kind_label: 'string',
        legal_identifier: 'exact legal identifier',
        printed_marker: 'optional printed local marker',
        title: 'optional string',
        parent_draft_id: 'optional uuid',
        draft_legal_text: 'string',
      }),
      action('confirm_owner_structure_completeness', Boolean(selected), {
        legal_ingestion_document_id: 'uuid',
        branch_draft_id: 'optional uuid; omit for whole document',
      }),
      action('retract_owner_structure_completeness', Boolean(selected), {
        legal_ingestion_document_id: 'uuid',
        branch_draft_id: 'optional uuid; omit for whole document',
      }),
      action('create_tax_knowledge_proposal', proposalActions.create_tax_knowledge_proposal, {
        legal_text_draft_id: 'uuid',
        creation_origin: 'owner_corrected',
        proposal_json: 'object',
        supersedes_proposal_id: 'optional uuid; same Owner Draft only',
      }),
      action('generate_tax_knowledge_proposal', proposalActions.generate_tax_knowledge_proposal, {
        legal_text_draft_id: 'uuid',
      }),
      action('set_tax_knowledge_proposal_review_status', proposalActions.set_tax_knowledge_proposal_review_status, {
        tax_knowledge_proposal_id: 'uuid',
        status: 'needs_review | owner_approved | rejected',
      }),
      action('create_corrected_tax_knowledge_proposal', proposalActions.create_corrected_tax_knowledge_proposal, {
        source_tax_knowledge_proposal_id: 'uuid',
        proposal_json: 'object',
      }),
      action('ensure_tax_knowledge_proposal_owner_presentations', proposalActions.ensure_tax_knowledge_proposal_owner_presentations, {
        tax_knowledge_proposal_id: 'uuid',
      }),
      action('publish_tax_knowledge_proposal_to_canonical_draft', proposalActions.publish_tax_knowledge_proposal_to_canonical_draft, {
        tax_knowledge_proposal_id: 'uuid',
      }),
    ],
  };
}

function mapSourceNoteAnchor(row: Record<string, unknown>): KnowledgeTrainerSourceNoteAnchorDto {
  return {
    id: String(row.id),
    printed_marker: String(row.printed_marker ?? ''),
    source_page: Number(row.source_page),
    source_item_start: row.source_item_start == null ? null : Number(row.source_item_start),
    source_item_end: row.source_item_end == null ? null : Number(row.source_item_end),
    source_line_index: row.source_line_index == null ? null : Number(row.source_line_index),
    source_bbox: parseSourceBBox(row.source_bbox),
    link_status: row.link_status === 'linked' ? 'linked' : 'unresolved',
    confidence: row.confidence == null ? null : Number(row.confidence),
  };
}

async function loadSourceNotesForActiveRun(activeRunId: string | null): Promise<{
  notes: KnowledgeTrainerSourceNoteDto[];
  unresolved_anchors: KnowledgeTrainerSourceNoteAnchorDto[];
  summary: ReturnType<typeof summarizeSourceNotes>;
}> {
  const empty = {
    notes: [] as KnowledgeTrainerSourceNoteDto[],
    unresolved_anchors: [] as KnowledgeTrainerSourceNoteAnchorDto[],
    summary: emptySourceNoteSummary(),
  };
  if (!activeRunId) return empty;
  try {
    const noteRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_source_notes')
        .select(
          'id, source_page, source_item_start, source_item_end, source_line_index, source_bbox, printed_marker, note_text, classification, origin_zone, review_status, inline_link_status, confidence, validation_warnings, sort_order',
        )
        .eq('structure_run_id', activeRunId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    );
    const anchorRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_source_note_anchors')
        .select(
          'id, source_note_id, source_page, source_item_start, source_item_end, source_line_index, source_bbox, printed_marker, link_status, confidence',
        )
        .eq('structure_run_id', activeRunId)
        .order('source_page', { ascending: true })
        .range(from, to),
    );
    const anchorsByNote = new Map<string, KnowledgeTrainerSourceNoteAnchorDto[]>();
    const unresolved: KnowledgeTrainerSourceNoteAnchorDto[] = [];
    for (const row of anchorRows) {
      const mapped = mapSourceNoteAnchor(row);
      const noteId = row.source_note_id == null ? null : String(row.source_note_id);
      if (!noteId) {
        unresolved.push(mapped);
        continue;
      }
      const list = anchorsByNote.get(noteId) ?? [];
      list.push(mapped);
      anchorsByNote.set(noteId, list);
    }
    const notes: KnowledgeTrainerSourceNoteDto[] = noteRows.map((row) => ({
      id: String(row.id),
      source_page: Number(row.source_page),
      source_item_start: row.source_item_start == null ? null : Number(row.source_item_start),
      source_item_end: row.source_item_end == null ? null : Number(row.source_item_end),
      source_line_index: row.source_line_index == null ? null : Number(row.source_line_index),
      source_bbox: parseSourceBBox(row.source_bbox),
      printed_marker: row.printed_marker == null ? null : String(row.printed_marker),
      note_text: String(row.note_text ?? ''),
      classification: String(row.classification) as SourceNoteClassification,
      origin_zone: String(row.origin_zone) as SourceNoteOriginZone,
      review_status: String(row.review_status) as SourceNoteReviewStatus,
      inline_link_status: String(row.inline_link_status) as SourceNoteInlineLinkStatus,
      confidence: row.confidence == null ? null : Number(row.confidence),
      validation_warnings: Array.isArray(row.validation_warnings)
        ? row.validation_warnings.map((item) => String(item))
        : [],
      anchors: anchorsByNote.get(String(row.id)) ?? [],
    }));
    return {
      notes,
      unresolved_anchors: unresolved,
      summary: summarizeSourceNotes(notes),
    };
  } catch (error) {
    if (
      isSupabaseMissingTableError(error as { message?: string; code?: string }) ||
      isSupabaseMissingColumnError(error as { message?: string; code?: string })
    ) {
      return empty;
    }
    throw error;
  }
}

type SourceNoteWithRun = KnowledgeTrainerSourceNoteDto & { structure_run_id: string | null };

const LEGAL_TEXT_DRAFT_LIST_SELECT =
  'id, kind_label, source_display_identifier, normalized_machine_identifier, printed_marker, title, parent_draft_id, text_boundary_status, review_status, original_source_page_start, original_source_page_end, original_source_item_start, original_source_item_end, original_subtree_page_start, original_subtree_page_end, original_subtree_item_start, original_subtree_item_end, owner_source_page_start, owner_source_page_end, owner_source_item_start, owner_source_item_end, structure_run_id, source_candidate_id, creation_origin, owner_sort_key, created_at, updated_at';

const LEGAL_TEXT_DRAFT_DETAIL_SELECT = `${LEGAL_TEXT_DRAFT_LIST_SELECT}, original_source_text, original_subtree_text, draft_legal_text`;

function emptyLegalTextDraftSummary(): KnowledgeTrainerLegalTextDraftSummaryDto {
  return { all: 0, draft: 0, needs_review: 0, ready: 0, reviewed: 0, not_prepared: 0, structure_candidates: 0 };
}

function asDraftBoundary(value: unknown): KnowledgeTrainerLegalTextDraftDto['text_boundary_status'] {
  if (value === 'certain' || value === 'uncertain' || value === 'owner_defined') return value;
  return 'uncertain';
}

function asDraftReview(value: unknown): KnowledgeTrainerLegalTextDraftDto['review_status'] {
  if (value === 'draft' || value === 'needs_review' || value === 'ready') return value;
  return 'draft';
}

function optionalInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function draftNoteSpan(row: Record<string, unknown>): {
  pageStart: number | null;
  pageEnd: number | null;
  itemStart: number | null;
  itemEnd: number | null;
  subtreePageStart: number | null;
  subtreePageEnd: number | null;
  subtreeItemStart: number | null;
  subtreeItemEnd: number | null;
} {
  const boundary = asDraftBoundary(row.text_boundary_status);
  const ownerDefined = boundary === 'owner_defined' && row.owner_source_page_start != null;
  return {
    pageStart: ownerDefined ? Number(row.owner_source_page_start) : optionalInt(row.original_source_page_start),
    pageEnd: ownerDefined
      ? Number(row.owner_source_page_end ?? row.owner_source_page_start)
      : optionalInt(row.original_source_page_end),
    itemStart: ownerDefined ? optionalInt(row.owner_source_item_start) : optionalInt(row.original_source_item_start),
    itemEnd: ownerDefined ? optionalInt(row.owner_source_item_end) : optionalInt(row.original_source_item_end),
    subtreePageStart: optionalInt(row.original_subtree_page_start),
    subtreePageEnd: optionalInt(row.original_subtree_page_end),
    subtreeItemStart: optionalInt(row.original_subtree_item_start),
    subtreeItemEnd: optionalInt(row.original_subtree_item_end),
  };
}

function draftNotesForSpan(
  scopedNotes: SourceNoteWithRun[],
  span: { page_start: number | null; page_end: number | null; item_start: number | null; item_end: number | null },
): KnowledgeTrainerSourceNoteDto[] {
  const noteEvidence = scopedNotes.map((note) => ({
    id: note.id,
    source_page: note.source_page,
    source_item_start: note.source_item_start,
    source_item_end: note.source_item_end,
    inline_link_status: note.inline_link_status,
  }));
  const overlappingIds = new Set(notesOverlappingDraftSpan(noteEvidence, span).map((note) => note.id));
  return scopedNotes.filter((note) => overlappingIds.has(note.id)).map(({ structure_run_id: _run, ...note }) => note);
}

function unresolvedNoteCount(notes: KnowledgeTrainerSourceNoteDto[]): number {
  return notes.filter(
    (note) => note.inline_link_status !== 'linked' || note.anchors.some((anchor) => anchor.link_status !== 'linked'),
  ).length;
}

function mapDraftListItem(
  row: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>,
  notesByRun: SourceNoteWithRun[],
): KnowledgeTrainerLegalTextDraftListItemDto {
  const id = String(row.id);
  const parentId = row.parent_draft_id == null ? null : String(row.parent_draft_id);
  const parent = parentId ? byId.get(parentId) : null;
  const span = draftNoteSpan(row);
  const runId = row.structure_run_id == null ? null : String(row.structure_run_id);
  const scopedNotes = runId ? notesByRun.filter((note) => note.structure_run_id === runId) : notesByRun;
  const sourceNotes = draftNotesForSpan(scopedNotes, {
    page_start: span.pageStart,
    page_end: span.pageEnd,
    item_start: span.itemStart,
    item_end: span.itemEnd,
  });
  const subtreeNotes = draftNotesForSpan(scopedNotes, {
    page_start: span.subtreePageStart,
    page_end: span.subtreePageEnd,
    item_start: span.subtreeItemStart,
    item_end: span.subtreeItemEnd,
  });
  const kind = row.kind_label == null ? null : String(row.kind_label);
  const displayIdentifier = row.source_display_identifier == null ? null : String(row.source_display_identifier);
  const title = row.title == null ? null : String(row.title);
  return {
    id,
    kind_label: kind,
    display_identifier: displayIdentifier,
    display_label: displayDraftLabel({
      kind_label: kind,
      source_display_identifier: displayIdentifier,
      title,
    }),
    printed_marker: row.printed_marker == null ? null : String(row.printed_marker),
    title,
    parent_draft_id: parentId,
    parent_display_label: parent
      ? displayDraftLabel({
          kind_label: parent.kind_label == null ? null : String(parent.kind_label),
          source_display_identifier:
            parent.source_display_identifier == null ? null : String(parent.source_display_identifier),
          title: parent.title == null ? null : String(parent.title),
        })
      : null,
    text_boundary_status: asDraftBoundary(row.text_boundary_status),
    review_status: asDraftReview(row.review_status),
    source_page_start: span.pageStart,
    source_page_end: span.pageEnd,
    unresolved_source_note_count: unresolvedNoteCount(sourceNotes),
    subtree_unresolved_source_note_count: unresolvedNoteCount(subtreeNotes),
    provenance: {
      structure_run_id: runId,
      source_candidate_id: row.source_candidate_id == null ? null : String(row.source_candidate_id),
    },
    creation_origin: creationOriginFromDraft(row.creation_origin == null ? null : String(row.creation_origin)),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapDraftDetail(
  row: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>,
  notesByRun: SourceNoteWithRun[],
): KnowledgeTrainerLegalTextDraftDto {
  const list = mapDraftListItem(row, byId, notesByRun);
  const span = draftNoteSpan(row);
  const runId = row.structure_run_id == null ? null : String(row.structure_run_id);
  const scopedNotes = runId ? notesByRun.filter((note) => note.structure_run_id === runId) : notesByRun;
  const sourceNotes = draftNotesForSpan(scopedNotes, {
    page_start: span.pageStart,
    page_end: span.pageEnd,
    item_start: span.itemStart,
    item_end: span.itemEnd,
  });
  const subtreeNotes = draftNotesForSpan(scopedNotes, {
    page_start: span.subtreePageStart,
    page_end: span.subtreePageEnd,
    item_start: span.subtreeItemStart,
    item_end: span.subtreeItemEnd,
  });
  return {
    ...list,
    original_source_text: String(row.original_source_text ?? ''),
    original_subtree_text: row.original_subtree_text == null ? null : String(row.original_subtree_text),
    draft_legal_text: String(row.draft_legal_text ?? ''),
    source_item_start: span.itemStart,
    source_item_end: span.itemEnd,
    subtree_page_start: span.subtreePageStart,
    subtree_page_end: span.subtreePageEnd,
    subtree_item_start: span.subtreeItemStart,
    subtree_item_end: span.subtreeItemEnd,
    owner_source_page_start: optionalInt(row.owner_source_page_start),
    owner_source_page_end: optionalInt(row.owner_source_page_end),
    owner_source_item_start: optionalInt(row.owner_source_item_start),
    owner_source_item_end: optionalInt(row.owner_source_item_end),
    source_notes: sourceNotes,
    subtree_source_notes: subtreeNotes,
  };
}

function mapLegalTextDraftSlice(input: {
  drafts: KnowledgeTrainerLegalTextDraftListItemDto[];
  selected: KnowledgeTrainerLegalTextDraftDto | null;
  frontier: KnowledgeTrainerDraftCreateFrontierItemDto[];
  summary: KnowledgeTrainerLegalTextDraftSummaryDto;
  review_tree: KnowledgeTrainerLegalTextReviewNodeDto[];
  selected_review_node: KnowledgeTrainerLegalTextReviewNodeDto | null;
  search_index: KnowledgeTrainerLegalTextSearchIndexItemDto[];
  completeness: KnowledgeTrainerLegalTextCompletenessDto;
  tax_knowledge_proposals: KnowledgeTrainerTaxKnowledgeProposalSliceDto;
}): {
  legal_text_drafts: KnowledgeTrainerLegalTextDraftListItemDto[];
  selected_legal_text_draft: KnowledgeTrainerLegalTextDraftDto | null;
  legal_text_draft_create_frontier: KnowledgeTrainerDraftCreateFrontierItemDto[];
  legal_text_draft_summary: KnowledgeTrainerLegalTextDraftSummaryDto;
  legal_text_review_tree: KnowledgeTrainerLegalTextReviewNodeDto[];
  selected_legal_text_review_node: KnowledgeTrainerLegalTextReviewNodeDto | null;
  legal_text_search_index: KnowledgeTrainerLegalTextSearchIndexItemDto[];
  legal_text_completeness: KnowledgeTrainerLegalTextCompletenessDto;
  tax_knowledge_proposals: KnowledgeTrainerTaxKnowledgeProposalSliceDto;
} {
  return {
    legal_text_drafts: input.drafts,
    selected_legal_text_draft: input.selected,
    legal_text_draft_create_frontier: input.frontier,
    legal_text_draft_summary: input.summary,
    legal_text_review_tree: input.review_tree,
    selected_legal_text_review_node: input.selected_review_node,
    legal_text_search_index: input.search_index,
    legal_text_completeness: input.completeness,
    tax_knowledge_proposals: input.tax_knowledge_proposals,
  };
}

function pickSelectedReviewNode(
  nodes: KnowledgeTrainerLegalTextReviewNodeDto[],
  requested?: string | null,
): KnowledgeTrainerLegalTextReviewNodeDto | null {
  if (requested) {
    return (
      nodes.find((row) => row.id === requested) ??
      nodes.find((row) => row.draft_id === requested) ??
      nodes.find((row) => row.source_candidate_id === requested) ??
      null
    );
  }
  return nodes.find((row) => row.draft_id) ?? nodes[0] ?? null;
}

function pickSelectedDraftId(
  rows: Record<string, unknown>[],
  requested?: string | null,
): string | null {
  if (requested && rows.some((row) => String(row.id) === requested)) return requested;
  const root = rows.find((row) => row.parent_draft_id == null);
  return root ? String(root.id) : rows[0] ? String(rows[0].id) : null;
}

function emptyTaxKnowledgeProposalSlice(): KnowledgeTrainerTaxKnowledgeProposalSliceDto {
  return { latest: null, selected: null, history: [], owner_view: emptyTaxKnowledgeProposalOwnerView() };
}

const PROPOSAL_HISTORY_SELECT =
  'id, legal_text_draft_id, revision_no, creation_origin, status, supersedes_proposal_id, created_at, published_tax_rule_id, published_tax_rule_version_id, published_tax_legal_node_id';

function mapProposalHistoryItem(row: Record<string, unknown>): KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto {
  const status = String(row.status) as KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto['status'];
  return {
    id: String(row.id),
    revision_no: Number(row.revision_no),
    creation_origin: String(row.creation_origin) as KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto['creation_origin'],
    status,
    status_label: taxKnowledgeProposalStatusLabel(status),
    supersedes_proposal_id: row.supersedes_proposal_id == null ? null : String(row.supersedes_proposal_id),
    created_at: String(row.created_at),
    publication_trace: {
      published_tax_rule_id: row.published_tax_rule_id == null ? null : String(row.published_tax_rule_id),
      published_tax_rule_version_id:
        row.published_tax_rule_version_id == null ? null : String(row.published_tax_rule_version_id),
      published_tax_legal_node_id:
        row.published_tax_legal_node_id == null ? null : String(row.published_tax_legal_node_id),
    },
  };
}

async function loadTaxKnowledgeProposalsForSelectedDraft(
  draftId: string | null,
  requestedProposalId?: string | null,
  draftReviewStatus?: string | null,
): Promise<KnowledgeTrainerTaxKnowledgeProposalSliceDto> {
  if (!draftId) return emptyTaxKnowledgeProposalSlice();
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_tax_knowledge_proposals')
        .select(PROPOSAL_HISTORY_SELECT)
        .eq('legal_text_draft_id', draftId)
        .order('revision_no', { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (
      isSupabaseMissingTableError(error as { message?: string; code?: string }) ||
      isSupabaseMissingColumnError(error as { message?: string; code?: string })
    ) {
      return emptyTaxKnowledgeProposalSlice();
    }
    throw error;
  }
  const history = rows.map(mapProposalHistoryItem);
  const latest = pickSelectedTaxKnowledgeProposal(history, null);
  const selectedMeta = pickSelectedTaxKnowledgeProposal(history, requestedProposalId);
  const generateEnabled = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedDraftReviewStatus: draftReviewStatus ?? null,
    selectedProposalStatus: selectedMeta?.status ?? null,
  }).generate_tax_knowledge_proposal;
  if (!selectedMeta) {
    return {
      latest,
      selected: null,
      history,
      owner_view: buildTaxKnowledgeProposalOwnerView({
        selected: null,
        proposal_json: null,
        validation: null,
        draft: { id: draftId, review_status: draftReviewStatus ?? null },
        generate_enabled: generateEnabled,
      }),
    };
  }
  let data: Record<string, unknown> | null = null;
  {
    const first = await supabaseAdmin
      .from('legal_ingestion_tax_knowledge_proposals')
      .select(`${PROPOSAL_HISTORY_SELECT}, proposal_json, owner_presentation_json`)
      .eq('id', selectedMeta.id)
      .eq('legal_text_draft_id', draftId)
      .maybeSingle();
    if (first.error && isSupabaseMissingColumnError(first.error)) {
      const fallback = await supabaseAdmin
        .from('legal_ingestion_tax_knowledge_proposals')
        .select(`${PROPOSAL_HISTORY_SELECT}, proposal_json`)
        .eq('id', selectedMeta.id)
        .eq('legal_text_draft_id', draftId)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      data = (fallback.data as Record<string, unknown> | null) ?? null;
    } else if (first.error) {
      throw first.error;
    } else {
      data = (first.data as Record<string, unknown> | null) ?? null;
    }
  }
  const json = data ? proposalJsonFromRow(data) : {};
  const { data: draftRow, error: draftError } = await supabaseAdmin
    .from('legal_ingestion_legal_text_drafts')
    .select('id, country_code, tax_source_id, draft_legal_text')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  let validationSummary = summarizeTaxKnowledgeProposalValidation(emptyTaxKnowledgeProposalValidationResult());
  try {
    const validation = await validateTaxKnowledgeProposalV1AgainstStore({
      proposal_json: json,
      context: {
        country_code: String(draftRow?.country_code ?? ''),
        tax_source_id: String(draftRow?.tax_source_id ?? ''),
        legal_text_draft_id: draftId,
        draft_legal_text: String(draftRow?.draft_legal_text ?? ''),
      },
    });
    validationSummary = summarizeTaxKnowledgeProposalValidation(validation);
  } catch {
    validationSummary = summarizeTaxKnowledgeProposalValidation({
      ...emptyTaxKnowledgeProposalValidationResult(String(draftRow?.draft_legal_text ?? '')),
      errors: [
        {
          path: 'proposal_json',
          code: 'validation_unavailable',
          message: 'Deterministic proposal validation could not load catalog bindings',
        },
      ],
    });
  }
  const ownerApprovalAllowed = canOwnerApproveTaxKnowledgeProposal(validationSummary);
  const next = allowedTaxKnowledgeProposalReviewStatuses(selectedMeta.status).filter(
    (status) => status !== 'owner_approved' || ownerApprovalAllowed,
  );
  const actions = taxKnowledgeProposalAllowedActions({
    hasSelectedDraft: true,
    selectedProposalStatus: selectedMeta.status,
    publicationEligible: validationSummary.publication_eligible,
  });
  const selected: KnowledgeTrainerTaxKnowledgeProposalDetailDto = {
    ...selectedMeta,
    legal_text_draft_id: draftId,
    proposal_json: json,
    validation: validationSummary,
    allowed_next_statuses: next,
    allowed_actions: [
      {
        action_key: 'set_tax_knowledge_proposal_review_status',
        enabled: actions.set_tax_knowledge_proposal_review_status && next.length > 0,
        required_fields: { tax_knowledge_proposal_id: 'uuid', status: next.join(' | ') || 'none' },
      },
      {
        action_key: 'create_corrected_tax_knowledge_proposal',
        enabled: actions.create_corrected_tax_knowledge_proposal,
        required_fields: {
          source_tax_knowledge_proposal_id: 'uuid',
          proposal_json: 'object when replacing the full snapshot',
          rule_text_corrections: 'human-readable rule title, statement, notes',
        },
      },
      {
        action_key: 'publish_tax_knowledge_proposal_to_canonical_draft',
        enabled: actions.publish_tax_knowledge_proposal_to_canonical_draft,
        required_fields: { tax_knowledge_proposal_id: 'uuid' },
      },
    ],
  };
  return {
    latest,
    selected,
    history,
    owner_view: buildTaxKnowledgeProposalOwnerView({
      selected,
      proposal_json: json,
      validation: validationSummary,
      owner_presentation_json: data?.owner_presentation_json,
      draft: { id: draftId, review_status: draftReviewStatus ?? null },
      generate_enabled: generateEnabled,
    }),
  };
}

function proposalJsonFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.proposal_json;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function loadLegalTextDraftsForDocument(
  documentId: string,
  fallbackNotes: KnowledgeTrainerSourceNoteDto[],
  opts?: {
    selectedDraftId?: string | null;
    selectedProposalId?: string | null;
    candidates?: KnowledgeTrainerCandidateDto[];
  },
): Promise<{
  drafts: KnowledgeTrainerLegalTextDraftListItemDto[];
  selected: KnowledgeTrainerLegalTextDraftDto | null;
  frontier: KnowledgeTrainerDraftCreateFrontierItemDto[];
  summary: KnowledgeTrainerLegalTextDraftSummaryDto;
  review_tree: KnowledgeTrainerLegalTextReviewNodeDto[];
  selected_review_node: KnowledgeTrainerLegalTextReviewNodeDto | null;
  search_index: KnowledgeTrainerLegalTextSearchIndexItemDto[];
  completeness: KnowledgeTrainerLegalTextCompletenessDto;
  tax_knowledge_proposals: KnowledgeTrainerTaxKnowledgeProposalSliceDto;
}> {
  const emptyCompleteness: KnowledgeTrainerLegalTextCompletenessDto = {
    document_confirmed: false,
    document_confirmed_at: null,
    selected_branch_confirmed: false,
    selected_branch_confirmed_at: null,
  };
  const emptyProposals = emptyTaxKnowledgeProposalSlice();
  const empty = {
    drafts: [] as KnowledgeTrainerLegalTextDraftListItemDto[],
    selected: null,
    frontier: [] as KnowledgeTrainerDraftCreateFrontierItemDto[],
    summary: emptyLegalTextDraftSummary(),
    review_tree: [] as KnowledgeTrainerLegalTextReviewNodeDto[],
    selected_review_node: null,
    search_index: [] as KnowledgeTrainerLegalTextSearchIndexItemDto[],
    completeness: emptyCompleteness,
    tax_knowledge_proposals: emptyProposals,
  };
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_legal_text_drafts')
        .select(LEGAL_TEXT_DRAFT_LIST_SELECT)
        .eq('document_id', documentId)
        .order('created_at', { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (
      isSupabaseMissingTableError(error as { message?: string; code?: string }) ||
      isSupabaseMissingColumnError(error as { message?: string; code?: string })
    ) {
      return empty;
    }
    throw error;
  }

  const notesByRun = await loadSourceNotesForDocument(documentId, fallbackNotes);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const drafts = rows.map((row) => mapDraftListItem(row, byId, notesByRun));
  const review_tree = buildLegalTextReviewNodes(
    (opts?.candidates ?? []).map((row, index) => ({
      id: row.id,
      parent_candidate_id: row.parent_candidate_id,
      candidate_kind: row.candidate_kind,
      kind_label: row.kind_label,
      source_display_identifier: row.source_display_identifier ?? row.display_identifier,
      printed_marker: row.printed_marker ?? null,
      title: row.title,
      sort_order: row.sort_order ?? index,
    })),
    drafts.map((row, index) => ({
      id: row.id,
      source_candidate_id: row.provenance.source_candidate_id,
      parent_draft_id: row.parent_draft_id,
      review_status: row.review_status,
      kind_label: row.kind_label,
      display_identifier: row.display_identifier,
      printed_marker: row.printed_marker,
      title: row.title,
      creation_origin: row.creation_origin,
      owner_sort_key: optionalInt(rows[index]?.owner_sort_key),
      normalized_machine_identifier:
        rows[index]?.normalized_machine_identifier == null
          ? null
          : String(rows[index]?.normalized_machine_identifier),
    })),
  );
  let selected_review_node = pickSelectedReviewNode(review_tree, opts?.selectedDraftId);
  const summary = emptyLegalTextDraftSummary();
  summary.all = drafts.length;
  for (const draft of drafts) summary[draft.review_status] += 1;
  summary.reviewed = summary.ready;
  summary.structure_candidates = review_tree.length;
  summary.not_prepared = review_tree.filter((row) => row.review_state === 'not_prepared').length;

  const selectedId =
    selected_review_node?.draft_id ??
    (opts?.selectedDraftId && rows.some((row) => String(row.id) === opts.selectedDraftId)
      ? opts.selectedDraftId
      : null);
  let selected: KnowledgeTrainerLegalTextDraftDto | null = null;
  if (selectedId) {
    const { data, error } = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .select(LEGAL_TEXT_DRAFT_DETAIL_SELECT)
      .eq('id', selectedId)
      .maybeSingle();
    if (error) throw error;
    if (data) selected = mapDraftDetail(data as Record<string, unknown>, byId, notesByRun);
  }

  const frontier = draftCreateFrontier(
    (opts?.candidates ?? []).map((row) => ({
      id: row.id,
      parent_candidate_id: row.parent_candidate_id,
      candidate_kind: row.candidate_kind,
      kind_label: row.kind_label,
      source_display_identifier: row.source_display_identifier ?? row.display_identifier,
      title: row.title,
    })),
    rows.map((row) => ({
      id: String(row.id),
      source_candidate_id: row.source_candidate_id == null ? null : String(row.source_candidate_id),
    })),
  );

  let completenessRows: Array<{ branch_draft_id: string | null; confirmed_at: string | null }> = [];
  try {
    const loaded = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_owner_completeness')
        .select('branch_draft_id, confirmed_at')
        .eq('document_id', documentId)
        .order('confirmed_at', { ascending: false })
        .range(from, to),
    );
    completenessRows = loaded.map((row) => ({
      branch_draft_id: row.branch_draft_id == null ? null : String(row.branch_draft_id),
      confirmed_at: row.confirmed_at == null ? null : String(row.confirmed_at),
    }));
  } catch (error) {
    if (
      !isSupabaseMissingTableError(error as { message?: string; code?: string }) &&
      !isSupabaseMissingColumnError(error as { message?: string; code?: string })
    ) {
      throw error;
    }
  }
  const confirmedBranchIds = new Set(
    completenessRows.filter((row) => row.branch_draft_id).map((row) => String(row.branch_draft_id)),
  );
  const review_tree_with_completeness = attachStructureCompleteness(review_tree, confirmedBranchIds);
  selected_review_node = pickSelectedReviewNode(review_tree_with_completeness, opts?.selectedDraftId);
  const documentCompleteness = completenessRows.find((row) => row.branch_draft_id == null) ?? null;
  const branchCompleteness = selected_review_node?.draft_id
    ? completenessRows.find((row) => row.branch_draft_id === selected_review_node.draft_id) ?? null
    : null;
  const completeness: KnowledgeTrainerLegalTextCompletenessDto = {
    document_confirmed: Boolean(documentCompleteness),
    document_confirmed_at: documentCompleteness?.confirmed_at ?? null,
    selected_branch_confirmed: Boolean(branchCompleteness),
    selected_branch_confirmed_at: branchCompleteness?.confirmed_at ?? null,
  };
  const tax_knowledge_proposals = await loadTaxKnowledgeProposalsForSelectedDraft(
    selected_review_node?.draft_id ?? selected?.id ?? null,
    opts?.selectedProposalId,
    selected?.review_status ?? null,
  );

  return {
    drafts,
    selected,
    frontier,
    summary,
    review_tree: review_tree_with_completeness,
    selected_review_node,
    search_index: buildLegalTextSearchIndex(review_tree_with_completeness),
    completeness,
    tax_knowledge_proposals,
  };
}

async function loadSourceNotesForDocument(
  documentId: string,
  fallbackNotes: KnowledgeTrainerSourceNoteDto[],
): Promise<SourceNoteWithRun[]> {
  try {
    const noteRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_source_notes')
        .select(
          'id, structure_run_id, source_page, source_item_start, source_item_end, source_line_index, source_bbox, printed_marker, note_text, classification, origin_zone, review_status, inline_link_status, confidence, validation_warnings, sort_order',
        )
        .eq('document_id', documentId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    );
    const anchorRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_source_note_anchors')
        .select(
          'id, source_note_id, source_page, source_item_start, source_item_end, source_line_index, source_bbox, printed_marker, link_status, confidence',
        )
        .eq('document_id', documentId)
        .order('source_page', { ascending: true })
        .range(from, to),
    );
    const anchorsByNote = new Map<string, KnowledgeTrainerSourceNoteAnchorDto[]>();
    for (const row of anchorRows) {
      const noteId = row.source_note_id == null ? null : String(row.source_note_id);
      if (!noteId) continue;
      const list = anchorsByNote.get(noteId) ?? [];
      list.push(mapSourceNoteAnchor(row));
      anchorsByNote.set(noteId, list);
    }
    return noteRows.map((row) => ({
      id: String(row.id),
      structure_run_id: row.structure_run_id == null ? null : String(row.structure_run_id),
      source_page: Number(row.source_page),
      source_item_start: row.source_item_start == null ? null : Number(row.source_item_start),
      source_item_end: row.source_item_end == null ? null : Number(row.source_item_end),
      source_line_index: row.source_line_index == null ? null : Number(row.source_line_index),
      source_bbox: parseSourceBBox(row.source_bbox),
      printed_marker: row.printed_marker == null ? null : String(row.printed_marker),
      note_text: String(row.note_text ?? ''),
      classification: String(row.classification) as SourceNoteClassification,
      origin_zone: String(row.origin_zone) as SourceNoteOriginZone,
      review_status: String(row.review_status) as SourceNoteReviewStatus,
      inline_link_status: String(row.inline_link_status) as SourceNoteInlineLinkStatus,
      confidence: row.confidence == null ? null : Number(row.confidence),
      validation_warnings: Array.isArray(row.validation_warnings)
        ? row.validation_warnings.map((item) => String(item))
        : [],
      anchors: anchorsByNote.get(String(row.id)) ?? [],
    }));
  } catch (error) {
    if (
      isSupabaseMissingTableError(error as { message?: string; code?: string }) ||
      isSupabaseMissingColumnError(error as { message?: string; code?: string })
    ) {
      return fallbackNotes.map((note) => ({ ...note, structure_run_id: null }));
    }
    throw error;
  }
}
