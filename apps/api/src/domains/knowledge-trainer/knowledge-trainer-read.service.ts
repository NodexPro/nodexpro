import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { jobStatusLabel, trainerInputOptions } from './knowledge-trainer.pure.js';
import type {
  KnowledgeTrainerCandidateDto,
  KnowledgeTrainerDocumentSummaryDto,
  KnowledgeTrainerSliceDto,
  LegalIngestionJobStatus,
  LegalIngestionPageStatus,
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
    .select('id, tax_source_id, original_filename, input_type, provenance_type, created_at')
    .eq('country_code', countryCode)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    if (isSupabaseMissingTableError(error)) return emptyKnowledgeTrainerSlice(false);
    throw error;
  }

  const documentIds = (documents ?? []).map((row) => String(row.id));
  const { data: jobs } = documentIds.length
    ? await supabaseAdmin
        .from('legal_ingestion_jobs')
        .select(
          'id, document_id, status, page_count, extracted_page_count, needs_ocr_page_count, failed_page_count, structure_candidate_count, created_at',
        )
        .in('document_id', documentIds)
        .order('created_at', { ascending: false })
    : { data: [] as Array<Record<string, unknown>> };

  const jobRows = jobs ?? [];
  const latestJobByDocument = new Map<string, (typeof jobRows)[number]>();
  for (const job of jobRows) {
    const documentId = String(job.document_id);
    if (!latestJobByDocument.has(documentId)) latestJobByDocument.set(documentId, job);
  }

  const summaries: KnowledgeTrainerDocumentSummaryDto[] = (documents ?? []).map((row) => {
    const job = latestJobByDocument.get(String(row.id));
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
      structure_candidate_count: Number(job?.structure_candidate_count ?? 0),
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
    const { data: pages } = await supabaseAdmin
      .from('legal_ingestion_pages')
      .select('page_no, status, page_text')
      .eq('job_id', selectedJob.id)
      .order('page_no', { ascending: true });
    const { data: candidates } = await supabaseAdmin
      .from('legal_ingestion_candidates')
      .select(
        'id, candidate_kind, candidate_status, kind_label, node_number, title, parent_candidate_id, parent_tax_legal_node_id, page_start, page_end, excerpt, confidence, validation_warnings, matched_tax_legal_node_id, accepted_tax_legal_node_id, sort_order',
      )
      .eq('job_id', selectedJob.id)
      .order('sort_order', { ascending: true });

    const pageNo = opts?.page_no && opts.page_no > 0 ? opts.page_no : pages?.[0] ? Number(pages[0].page_no) : null;
    const selectedPage = pages?.find((page) => Number(page.page_no) === pageNo) ?? null;
    selected = {
      id: selectedSummary.id,
      original_filename: selectedSummary.original_filename,
      job_status: selectedSummary.job_status,
      job_status_label: selectedSummary.job_status_label,
      page_count: selectedSummary.page_count,
      extracted_page_count: selectedSummary.extracted_page_count,
      needs_ocr_page_count: selectedSummary.needs_ocr_page_count,
      failed_page_count: selectedSummary.failed_page_count,
      structure_candidate_count: selectedSummary.structure_candidate_count,
      pages: (pages ?? []).map((page) => ({
        page_no: Number(page.page_no),
        status: String(page.status) as LegalIngestionPageStatus,
        has_text: Boolean(page.page_text),
      })),
      selected_page: selectedPage
        ? {
            page_no: Number(selectedPage.page_no),
            text: typeof selectedPage.page_text === 'string' ? selectedPage.page_text : null,
            status: String(selectedPage.status) as LegalIngestionPageStatus,
          }
        : null,
      candidates: (candidates ?? []).map((row): KnowledgeTrainerCandidateDto => {
        const warnings = Array.isArray(row.validation_warnings)
          ? row.validation_warnings.map((item) => String(item))
          : [];
        return {
          id: String(row.id),
          candidate_kind: row.candidate_kind as KnowledgeTrainerCandidateDto['candidate_kind'],
          candidate_status: row.candidate_status as KnowledgeTrainerCandidateDto['candidate_status'],
          kind_label: row.kind_label == null ? null : String(row.kind_label),
          node_number: row.node_number == null ? null : String(row.node_number),
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
      }),
      can_open_original: true,
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
      action('update_legal_extraction_candidate', true, {
        legal_ingestion_candidate_id: 'uuid',
        kind_label: 'optional string',
        node_number: 'optional string',
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
