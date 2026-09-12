import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  extractStructureCandidatesFromPages,
  summarizeJobProgress,
  validateStructureCandidates,
  workerMustNotWriteCanonicalLaw,
} from './knowledge-trainer.pure.js';
import { countPdfPages, extractEmbeddedPdfPageText } from './knowledge-trainer-pdf.service.js';
import { downloadOwnerLegalMaterial } from './knowledge-trainer-storage.service.js';
import { WORKER_FORBIDDEN_CANONICAL_TABLES } from './knowledge-trainer.types.js';

const LEASE_SECONDS = 120;

type IngestionPageRow = {
  id: string;
  job_id: string;
  document_id: string;
  country_code: string;
  page_no: number;
  status: string;
  attempt_count: number;
};

type IngestionJobRow = {
  id: string;
  document_id: string;
  country_code: string;
  tax_source_id: string;
  status: string;
  page_count: number;
};

function assertWorkerTableAllowed(table: string): void {
  if (workerMustNotWriteCanonicalLaw(table)) {
    throw new Error(`Knowledge Trainer worker cannot write canonical table ${table}`);
  }
}

async function trainerUpdate(table: string, values: Record<string, unknown>, eq: { column: string; value: string }) {
  assertWorkerTableAllowed(table);
  const { error } = await supabaseAdmin.from(table).update(values).eq(eq.column, eq.value);
  if (error) throw error;
}

async function trainerInsert(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  assertWorkerTableAllowed(table);
  const { error } = await supabaseAdmin.from(table).insert(rows);
  if (error) throw error;
}

export async function prepareQueuedIngestionJobs(limit = 2): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('id, document_id, country_code, tax_source_id, status, page_count')
    .or('status.eq.queued,and(status.eq.extracting,page_count.eq.0)')
    .limit(limit);
  if (error) {
    if (isSupabaseMissingTableError(error)) return 0;
    throw error;
  }
  let prepared = 0;
  for (const job of (data ?? []) as IngestionJobRow[]) {
    const claimed = await supabaseAdmin
      .from('legal_ingestion_jobs')
      .update({ status: 'extracting', started_at: new Date().toISOString(), last_error: null })
      .eq('id', job.id)
      .in('status', ['queued', 'extracting'])
      .select('id')
      .maybeSingle();
    if (claimed.error || !claimed.data) continue;

    const { data: document, error: docError } = await supabaseAdmin
      .from('legal_ingestion_documents')
      .select('id, storage_bucket, storage_key, input_type')
      .eq('id', job.document_id)
      .maybeSingle();
    if (docError || !document?.storage_key) {
      await trainerUpdate(
        'legal_ingestion_jobs',
        { status: 'extraction_failed', last_error: 'Document storage is missing', finished_at: new Date().toISOString() },
        { column: 'id', value: job.id },
      );
      continue;
    }
    if (document.input_type !== 'pdf') {
      await trainerUpdate(
        'legal_ingestion_jobs',
        { status: 'extraction_failed', last_error: 'V1 worker extracts selectable-text PDF only', finished_at: new Date().toISOString() },
        { column: 'id', value: job.id },
      );
      continue;
    }

    const bytes = await downloadOwnerLegalMaterial(String(document.storage_bucket), String(document.storage_key));
    const pageCount = await countPdfPages(bytes);
    if (pageCount < 1) {
      await trainerUpdate(
        'legal_ingestion_jobs',
        { status: 'extraction_failed', last_error: 'PDF has no pages', finished_at: new Date().toISOString() },
        { column: 'id', value: job.id },
      );
      continue;
    }

    const { data: existingPages } = await supabaseAdmin
      .from('legal_ingestion_pages')
      .select('page_no')
      .eq('job_id', job.id);
    const have = new Set((existingPages ?? []).map((row) => Number(row.page_no)));
    const missing = Array.from({ length: pageCount }, (_, index) => index + 1).filter((pageNo) => !have.has(pageNo));
    if (missing.length) {
      await trainerInsert(
        'legal_ingestion_pages',
        missing.map((pageNo) => ({
          job_id: job.id,
          document_id: job.document_id,
          country_code: job.country_code,
          page_no: pageNo,
          status: 'pending',
          extraction_method: 'embedded_text',
        })),
      );
    }
    await trainerUpdate(
      'legal_ingestion_jobs',
      { page_count: pageCount, status: 'extracting' },
      { column: 'id', value: job.id },
    );
    prepared += 1;
  }
  return prepared;
}

export async function claimAndProcessOnePage(workerId: string): Promise<boolean> {
  if (!workerId.trim()) throw new Error('worker id is required');
  const { data, error } = await supabaseAdmin.rpc('legal_ingestion_claim_page', {
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    if (isSupabaseMissingTableError(error) || String(error.message ?? '').includes('legal_ingestion_claim_page')) {
      return false;
    }
    throw error;
  }
  const page = (Array.isArray(data) ? data[0] : data) as IngestionPageRow | null;
  if (!page?.id) return false;

  try {
    const { data: document, error: docError } = await supabaseAdmin
      .from('legal_ingestion_documents')
      .select('storage_bucket, storage_key')
      .eq('id', page.document_id)
      .maybeSingle();
    if (docError || !document?.storage_key) throw new Error('Document storage is missing');
    const bytes = await downloadOwnerLegalMaterial(String(document.storage_bucket), String(document.storage_key));
    const extracted = await extractEmbeddedPdfPageText(bytes, page.page_no);
    await trainerUpdate(
      'legal_ingestion_pages',
      {
        status: extracted.status,
        extraction_method: extracted.extraction_method,
        page_text: extracted.text,
        last_error: extracted.status === 'needs_ocr' ? 'Page has no usable embedded text' : null,
        lease_owner: null,
        lease_expires_at: null,
        processed_at: new Date().toISOString(),
      },
      { column: 'id', value: page.id },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 240) : 'Page extraction failed';
    await trainerUpdate(
      'legal_ingestion_pages',
      {
        status: 'failed',
        last_error: message,
        lease_owner: null,
        lease_expires_at: null,
        processed_at: new Date().toISOString(),
      },
      { column: 'id', value: page.id },
    );
  }

  await refreshJobProgressAndMaybeFinalize(page.job_id);
  return true;
}

async function refreshJobProgressAndMaybeFinalize(jobId: string): Promise<void> {
  const { data: pages, error } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('status, page_no, page_text')
    .eq('job_id', jobId)
    .order('page_no', { ascending: true });
  if (error || !pages) return;
  const progress = summarizeJobProgress(pages);
  await trainerUpdate(
    'legal_ingestion_jobs',
    {
      extracted_page_count: progress.extracted_page_count,
      needs_ocr_page_count: progress.needs_ocr_page_count,
      failed_page_count: progress.failed_page_count,
      status: progress.job_status,
      finished_at: progress.job_status === 'extracting' ? null : new Date().toISOString(),
    },
    { column: 'id', value: jobId },
  );
  if (progress.job_status === 'extracting') return;
  await finalizeStructureCandidates(jobId);
}

async function finalizeStructureCandidates(jobId: string): Promise<void> {
  const { data: jobState } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('structure_candidate_count')
    .eq('id', jobId)
    .maybeSingle();
  if (Number(jobState?.structure_candidate_count ?? 0) > 0) return;

  const { data: existing } = await supabaseAdmin
    .from('legal_ingestion_candidates')
    .select('id')
    .eq('job_id', jobId)
    .limit(1);
  if (existing?.length) {
    assertWorkerTableAllowed('legal_ingestion_candidates');
    await supabaseAdmin
      .from('legal_ingestion_candidates')
      .update({ parent_candidate_id: null })
      .eq('job_id', jobId);
    await supabaseAdmin.from('legal_ingestion_candidates').delete().eq('job_id', jobId);
  }

  const { data: job } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('id, document_id, country_code, tax_source_id')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return;

  const { data: pages } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('page_no, page_text, status')
    .eq('job_id', jobId)
    .order('page_no', { ascending: true });

  const { data: kinds } = await supabaseAdmin
    .from('tax_legal_node_kinds')
    .select('id, label')
    .eq('country_code', job.country_code)
    .order('sort_order', { ascending: true });

  const { data: nodes } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id, tax_source_id, country_code, node_number, title, tax_legal_node_kind_id')
    .eq('tax_source_id', job.tax_source_id);

  const kindById = new Map((kinds ?? []).map((row) => [String(row.id), String(row.label)]));
  const existingNodes = (nodes ?? []).map((row) => ({
    id: String(row.id),
    tax_source_id: String(row.tax_source_id),
    country_code: String(row.country_code),
    kind_label: kindById.get(String(row.tax_legal_node_kind_id)) ?? '',
    node_number: row.node_number == null ? null : String(row.node_number),
    title: String(row.title ?? ''),
  }));

  const extractedPages = (pages ?? [])
    .filter((page) => page.status === 'extracted' && typeof page.page_text === 'string')
    .map((page) => ({ page_no: Number(page.page_no), text: String(page.page_text) }));

  const drafts = validateStructureCandidates(
    extractStructureCandidatesFromPages(
      extractedPages,
      (kinds ?? []).map((row) => ({ id: String(row.id), label: String(row.label) })),
    ),
    {
      country_code: String(job.country_code),
      tax_source_id: String(job.tax_source_id),
      existing_nodes: existingNodes,
    },
  );

  if (drafts.length) {
    const inserted: Array<{ id: string }> = [];
    for (const [index, draft] of drafts.entries()) {
      const parentId = draft.parent_index != null ? inserted[draft.parent_index]?.id ?? null : null;
      const match = existingNodes.find(
        (node) =>
          node.kind_label === draft.kind_label &&
          node.node_number &&
          node.node_number === draft.node_number,
      );
      const { data, error } = await supabaseAdmin
        .from('legal_ingestion_candidates')
        .insert({
          job_id: job.id,
          document_id: job.document_id,
          country_code: job.country_code,
          tax_source_id: job.tax_source_id,
          candidate_kind: 'structure',
          candidate_status: draft.candidate_status,
          kind_label: draft.kind_label,
          node_number: draft.node_number,
          title: draft.title,
          parent_candidate_id: parentId,
          page_start: draft.page_start,
          page_end: draft.page_end,
          excerpt: draft.excerpt,
          confidence: draft.confidence,
          validation_warnings: draft.validation_warnings,
          matched_tax_legal_node_id: match?.id ?? null,
          sort_order: index,
        })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Failed to persist structure candidate');
      inserted.push({ id: String(data.id) });
    }
  }

  const warningCount = drafts.reduce((sum, draft) => sum + draft.validation_warnings.length, 0);
  const needsReview = drafts.some((draft) => draft.candidate_status === 'needs_review') || warningCount > 0;
  const { data: jobNow } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select('status, needs_ocr_page_count, failed_page_count')
    .eq('id', jobId)
    .maybeSingle();
  const nextStatus =
    jobNow?.status === 'extraction_failed' || jobNow?.status === 'partially_extracted'
      ? jobNow.status
      : needsReview || Number(jobNow?.needs_ocr_page_count ?? 0) > 0
        ? 'needs_review'
        : 'ready_for_review';
  await trainerUpdate(
    'legal_ingestion_jobs',
    {
      structure_candidate_count: drafts.length,
      warning_count: warningCount,
      status: nextStatus,
    },
    { column: 'id', value: jobId },
  );
}

export async function runKnowledgeTrainerWorkerTick(workerId: string): Promise<{ prepared: number; processed: boolean }> {
  for (const table of WORKER_FORBIDDEN_CANONICAL_TABLES) {
    if (workerMustNotWriteCanonicalLaw(table) !== true) {
      throw new Error('Worker isolation invariant failed');
    }
  }
  const prepared = await prepareQueuedIngestionJobs();
  const processed = await claimAndProcessOnePage(workerId);
  return { prepared, processed };
}
