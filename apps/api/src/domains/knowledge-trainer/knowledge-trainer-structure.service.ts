import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  detectStructureCandidatesFromLayout,
  parseStoredPageLayout,
  stagingStructureIdsToReplace,
} from './knowledge-trainer-layout.pure.js';
import {
  detectStructureCandidates,
  encodeStructureAnalysis,
  sameParentIdentity,
  validateStructureCandidates,
  workerMustNotWriteCanonicalLaw,
} from './knowledge-trainer.pure.js';
import type { StructureDetectionAnalysis } from './knowledge-trainer.types.js';

function assertWorkerTableAllowed(table: string): void {
  if (workerMustNotWriteCanonicalLaw(table)) {
    throw new Error(`Knowledge Trainer worker cannot write canonical table ${table}`);
  }
}

export async function persistStructureCandidatesForJob(
  jobId: string,
  opts: { replaceStaging: boolean; useLayout?: boolean },
): Promise<{ analysis: StructureDetectionAnalysis; preserved_accepted: number } | null> {
  const { data: job, error: jobError } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select(
      'id, document_id, country_code, tax_source_id, status, structure_candidate_count, needs_ocr_page_count, failed_page_count, last_error',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) {
    if (isSupabaseMissingTableError(jobError)) return null;
    throw jobError;
  }
  if (!job) return null;

  const { data: existingCandidates, error: existingError } = await supabaseAdmin
    .from('legal_ingestion_candidates')
    .select('id, candidate_kind, candidate_status, accepted_tax_legal_node_id')
    .eq('job_id', jobId);
  if (existingError) throw existingError;

  const accepted = (existingCandidates ?? []).filter(
    (row) =>
      row.candidate_kind === 'structure' &&
      (row.candidate_status === 'accepted' || row.accepted_tax_legal_node_id),
  );
  if (!opts.replaceStaging && ((existingCandidates ?? []).length > 0 || Number(job.structure_candidate_count ?? 0) > 0)) {
    return null;
  }

  const stagingIds = stagingStructureIdsToReplace(
    (existingCandidates ?? []).map((row) => ({
      id: String(row.id),
      candidate_kind: String(row.candidate_kind),
      candidate_status: String(row.candidate_status),
      accepted_tax_legal_node_id: row.accepted_tax_legal_node_id == null ? null : String(row.accepted_tax_legal_node_id),
    })),
  );
  if (stagingIds.length) {
    assertWorkerTableAllowed('legal_ingestion_candidates');
    const chunkSize = 80;
    for (let offset = 0; offset < stagingIds.length; offset += chunkSize) {
      const chunk = stagingIds.slice(offset, offset + chunkSize);
      const { error: unlinkError } = await supabaseAdmin
        .from('legal_ingestion_candidates')
        .update({ parent_candidate_id: null })
        .in('id', chunk);
      if (unlinkError) throw unlinkError;
    }
    for (let offset = 0; offset < stagingIds.length; offset += chunkSize) {
      const chunk = stagingIds.slice(offset, offset + chunkSize);
      const { error: deleteError } = await supabaseAdmin.from('legal_ingestion_candidates').delete().in('id', chunk);
      if (deleteError) throw deleteError;
    }
  }

  const { data: pages, error: pageError } = await supabaseAdmin
    .from('legal_ingestion_pages')
    .select('page_no, page_text, status, page_text_items')
    .eq('job_id', jobId)
    .order('page_no', { ascending: true });
  if (pageError) throw pageError;

  const extractedPages = (pages ?? [])
    .filter((page) => page.status === 'extracted' && typeof page.page_text === 'string')
    .map((page) => ({
      page_no: Number(page.page_no),
      text: String(page.page_text),
      layout: parseStoredPageLayout(page.page_text_items),
    }));

  const { data: kinds, error: kindError } = await supabaseAdmin
    .from('tax_legal_node_kinds')
    .select('id, label')
    .eq('country_code', job.country_code)
    .order('sort_order', { ascending: true });
  if (kindError) throw kindError;

  let nodeQuery: { data: Array<Record<string, unknown>> | null; error: { message?: string; code?: string } | null } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id, tax_source_id, country_code, parent_node_id, node_number, normalized_machine_identifier, title, tax_legal_node_kind_id')
    .eq('tax_source_id', job.tax_source_id);
  if (nodeQuery.error && isSupabaseMissingColumnError(nodeQuery.error, 'normalized_machine_identifier')) {
    nodeQuery = await supabaseAdmin
      .from('tax_legal_nodes')
      .select('id, tax_source_id, country_code, parent_node_id, node_number, title, tax_legal_node_kind_id')
      .eq('tax_source_id', job.tax_source_id);
  }
  const { data: nodes, error: nodeError } = nodeQuery;
  if (nodeError) throw nodeError;

  const kindById = new Map((kinds ?? []).map((row) => [String(row.id), String(row.label)]));
  const existingNodes = (nodes ?? []).map((row) => ({
    id: String(row.id),
    tax_source_id: String(row.tax_source_id),
    country_code: String(row.country_code),
    kind_label: kindById.get(String(row.tax_legal_node_kind_id)) ?? '',
    node_number: row.node_number == null ? null : String(row.node_number),
    parent_node_id: row.parent_node_id == null ? null : String(row.parent_node_id),
    normalized_machine_identifier:
      row.normalized_machine_identifier == null ? null : String(row.normalized_machine_identifier),
    title: String(row.title ?? ''),
  }));

  const catalog = (kinds ?? []).map((row) => ({
    id: String(row.id),
    label: String(row.label),
  }));
  const detected = opts.useLayout
    ? detectStructureCandidatesFromLayout(extractedPages, catalog, {
        ocr_page_count: Number(job.needs_ocr_page_count ?? 0),
      })
    : detectStructureCandidates(
        extractedPages.map((page) => ({ page_no: page.page_no, text: page.text })),
        catalog,
        {
          ocr_page_count: Number(job.needs_ocr_page_count ?? 0),
        },
      );
  const drafts = validateStructureCandidates(detected.drafts, {
    country_code: String(job.country_code),
    tax_source_id: String(job.tax_source_id),
    existing_nodes: existingNodes,
  });

  const inserted: Array<{ id: string }> = [];
  for (const [index, draft] of drafts.entries()) {
    const parentId = draft.parent_index != null ? inserted[draft.parent_index]?.id ?? null : null;
    const parentDraft = draft.parent_index != null ? drafts[draft.parent_index] ?? null : null;
    const match = existingNodes.find((node) => {
      if (node.kind_label !== draft.kind_label) return false;
      const draftRoot = draft.parent_index == null;
      const nodeRoot = node.parent_node_id == null;
      if (draftRoot !== nodeRoot) return false;
      if (!draftRoot) {
        const parentNode = existingNodes.find((candidate) => candidate.id === node.parent_node_id) ?? null;
        if (parentDraft && parentNode && !sameParentIdentity(parentDraft, parentNode)) return false;
      }
      if (draft.normalized_machine_identifier && node.normalized_machine_identifier) {
        return draft.normalized_machine_identifier === node.normalized_machine_identifier;
      }
      return Boolean(node.node_number) && node.node_number === draft.node_number;
    });
    assertWorkerTableAllowed('legal_ingestion_candidates');
    const row = {
      job_id: job.id,
      document_id: job.document_id,
      country_code: job.country_code,
      tax_source_id: job.tax_source_id,
      candidate_kind: 'structure' as const,
      candidate_status: draft.candidate_status,
      kind_label: draft.kind_label,
      node_number: draft.node_number,
      source_display_identifier: draft.source_display_identifier ?? null,
      normalized_machine_identifier: draft.normalized_machine_identifier ?? null,
      identifier_base_number: draft.identifier_base_number ?? null,
      identifier_letter_suffix: draft.identifier_letter_suffix ?? null,
      identifier_nested_components: draft.identifier_nested_components ?? [],
      title: draft.title,
      parent_candidate_id: parentId,
      page_start: draft.page_start,
      page_end: draft.page_end,
      excerpt: draft.excerpt,
      confidence: draft.confidence,
      validation_warnings: draft.validation_warnings,
      matched_tax_legal_node_id: match?.id ?? null,
      sort_order: accepted.length + index,
    };
    let insertedRow = await supabaseAdmin.from('legal_ingestion_candidates').insert(row).select('id').single();
    if (insertedRow.error && isSupabaseMissingColumnError(insertedRow.error, 'source_display_identifier')) {
      const { source_display_identifier: _a, normalized_machine_identifier: _b, identifier_base_number: _c, identifier_letter_suffix: _d, identifier_nested_components: _e, ...legacy } = row;
      void _a;
      void _b;
      void _c;
      void _d;
      void _e;
      insertedRow = await supabaseAdmin.from('legal_ingestion_candidates').insert(legacy).select('id').single();
    }
    const { data, error } = insertedRow;
    if (error || !data) throw error ?? new Error('Failed to persist structure candidate');
    inserted.push({ id: String(data.id) });
  }

  const warningCount = drafts.reduce((sum, draft) => sum + draft.validation_warnings.length, 0);
  const needsReview =
    drafts.some((draft) => draft.candidate_status === 'needs_review') ||
    warningCount > 0 ||
    detected.analysis.ocr_gap_warning;
  const nextStatus =
    job.status === 'extraction_failed' || job.status === 'partially_extracted'
      ? job.status
      : needsReview || Number(job.needs_ocr_page_count ?? 0) > 0
        ? 'needs_review'
        : 'ready_for_review';

  assertWorkerTableAllowed('legal_ingestion_jobs');
  const { error: jobUpdateError } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .update({
      structure_candidate_count: drafts.length,
      warning_count: warningCount,
      status: nextStatus,
      last_error: job.status === 'extraction_failed' ? job.last_error : encodeStructureAnalysis(detected.analysis),
    })
    .eq('id', jobId);
  if (jobUpdateError) throw jobUpdateError;

  return { analysis: detected.analysis, preserved_accepted: accepted.length };
}
