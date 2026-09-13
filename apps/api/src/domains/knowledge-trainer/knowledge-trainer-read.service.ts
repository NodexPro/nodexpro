import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { summarizeLayoutReadiness } from './knowledge-trainer-layout.pure.js';
import { fetchAllPaged } from './knowledge-trainer-pagination.js';
import { attachStructureReviewModel, describeStoredLayoutEvidence } from './knowledge-trainer-review.pure.js';
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
  KnowledgeTrainerSliceDto,
  LegalIngestionJobStatus,
  LegalIngestionPageStatus,
  StructureRunReadDto,
} from './knowledge-trainer.types.js';

export type KnowledgeTrainerReadOpts = {
  document_id?: string | null;
  page_no?: number | null;
  tax_source_id?: string | null;
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
      'id, candidate_kind, candidate_status, kind_label, node_number, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_letter_suffix, identifier_nested_components, printed_marker, title, parent_candidate_id, parent_tax_legal_node_id, page_start, page_end, excerpt, confidence, validation_warnings, matched_tax_legal_node_id, accepted_tax_legal_node_id, sort_order, structure_run_id';
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
          excerpt: row.excerpt == null ? null : String(row.excerpt),
          confidence: row.confidence == null ? null : Number(row.confidence),
          validation_warnings: warnings,
          matched_tax_legal_node_id: row.matched_tax_legal_node_id == null ? null : String(row.matched_tax_legal_node_id),
          accepted_tax_legal_node_id: row.accepted_tax_legal_node_id == null ? null : String(row.accepted_tax_legal_node_id),
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
      can_open_original: Boolean(storageKey),
      original_file_access: originalFileAccess,
      structure_analysis: structureAnalysis,
      can_rebuild_structure: canExtract,
      review_summary: reviewed.review_summary,
      review_filters: reviewed.review_filters,
      structure_tree: reviewed.structure_tree,
      ocr_page_numbers: ocrPageNumbers,
      structure_run: structureRun,
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
    ],
  };
}
