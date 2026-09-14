import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { fetchAllPaged } from './knowledge-trainer-pagination.js';
import {
  detectStructureCandidatesFromLayout,
  parseStoredPageLayout,
} from './knowledge-trainer-layout.pure.js';
import { detectSourceNotesFromLayout } from './knowledge-trainer-source-notes.pure.js';
import {
  assignDraftIds,
  canActivateStructureRun,
  chunkInOrder,
  detectorVersionForRebuild,
  shouldSkipNonReplacePersist,
  validateStructureRunCandidates,
} from './knowledge-trainer-structure-run.pure.js';
import {
  detectStructureCandidates,
  encodeStructureAnalysis,
  sameParentIdentity,
  validateStructureCandidates,
  workerMustNotWriteCanonicalLaw,
} from './knowledge-trainer.pure.js';
import type { SourceNoteAnchorDraft, SourceNoteDraft, StructureDetectionAnalysis } from './knowledge-trainer.types.js';
import { randomUUID } from 'node:crypto';

const STRUCTURE_RUN_SCHEMA_HINT =
  'Knowledge Trainer structure-run schema is not applied. Migration 627 is required on DEV.';

function assertWorkerTableAllowed(table: string): void {
  if (workerMustNotWriteCanonicalLaw(table)) {
    throw new Error(`Knowledge Trainer worker cannot write canonical table ${table}`);
  }
}

async function structureRunSchemaAvailable(): Promise<boolean> {
  const probe = await supabaseAdmin.from('legal_ingestion_structure_runs').select('id').limit(1);
  if (probe.error && (isSupabaseMissingTableError(probe.error) || isSupabaseMissingColumnError(probe.error))) {
    return false;
  }
  if (probe.error) throw probe.error;
  return true;
}

async function sourceEvidenceSchemaAvailable(): Promise<boolean> {
  const probe = await supabaseAdmin.from('legal_ingestion_source_notes').select('id').limit(1);
  if (probe.error && (isSupabaseMissingTableError(probe.error) || isSupabaseMissingColumnError(probe.error))) {
    return false;
  }
  if (probe.error) throw probe.error;
  return true;
}

function withoutSourceSpanColumns<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const {
    source_page: _page,
    source_item_start: _start,
    source_item_end: _end,
    source_line_index: _line,
    source_bbox: _bbox,
    ...rest
  } = row;
  void _page;
  void _start;
  void _end;
  void _line;
  void _bbox;
  return rest;
}

async function persistSourceEvidenceForRun(input: {
  runId: string;
  job: { id: unknown; document_id: unknown; country_code: unknown; tax_source_id: unknown };
  createdBy: string | null;
  notes: SourceNoteDraft[];
  unresolvedAnchors: SourceNoteAnchorDraft[];
}): Promise<number> {
  assertWorkerTableAllowed('legal_ingestion_source_notes');
  const noteRows = input.notes.map((note, index) => ({
    id: randomUUID(),
    draft: note,
    sort_order: index,
  }));
  const inserts = noteRows.map((row) => ({
    id: row.id,
    structure_run_id: input.runId,
    job_id: input.job.id,
    document_id: input.job.document_id,
    country_code: input.job.country_code,
    tax_source_id: input.job.tax_source_id,
    source_page: row.draft.source_page,
    source_item_start: row.draft.source_item_start,
    source_item_end: row.draft.source_item_end,
    source_line_index: row.draft.source_line_index,
    source_bbox: row.draft.source_bbox,
    printed_marker: row.draft.printed_marker,
    note_text: row.draft.note_text,
    classification: row.draft.classification,
    origin_zone: row.draft.origin_zone,
    review_status: row.draft.review_status,
    inline_link_status: row.draft.inline_link_status,
    confidence: row.draft.confidence,
    validation_warnings: row.draft.validation_warnings,
    sort_order: row.sort_order,
    created_by: input.createdBy,
  }));
  for (const chunk of chunkInOrder(inserts)) {
    const inserted = await supabaseAdmin.from('legal_ingestion_source_notes').insert(chunk);
    if (inserted.error) throw inserted.error;
  }
  const anchors = [
    ...noteRows.flatMap((row) =>
      row.draft.anchors.map((anchor) => ({
        id: randomUUID(),
        structure_run_id: input.runId,
        source_note_id: row.id,
        job_id: input.job.id,
        document_id: input.job.document_id,
        country_code: input.job.country_code,
        tax_source_id: input.job.tax_source_id,
        source_page: anchor.source_page,
        source_item_start: anchor.source_item_start,
        source_item_end: anchor.source_item_end,
        source_line_index: anchor.source_line_index,
        source_bbox: anchor.source_bbox,
        printed_marker: anchor.printed_marker,
        link_status: anchor.link_status,
        confidence: anchor.confidence,
      })),
    ),
    ...input.unresolvedAnchors.map((anchor) => ({
      id: randomUUID(),
      structure_run_id: input.runId,
      source_note_id: null,
      job_id: input.job.id,
      document_id: input.job.document_id,
      country_code: input.job.country_code,
      tax_source_id: input.job.tax_source_id,
      source_page: anchor.source_page,
      source_item_start: anchor.source_item_start,
      source_item_end: anchor.source_item_end,
      source_line_index: anchor.source_line_index,
      source_bbox: anchor.source_bbox,
      printed_marker: anchor.printed_marker,
      link_status: 'unresolved' as const,
      confidence: anchor.confidence,
    })),
  ];
  if (anchors.length) {
    assertWorkerTableAllowed('legal_ingestion_source_note_anchors');
    for (const chunk of chunkInOrder(anchors)) {
      const inserted = await supabaseAdmin.from('legal_ingestion_source_note_anchors').insert(chunk);
      if (inserted.error) throw inserted.error;
    }
  }
  return noteRows.length;
}

async function failBuildingRun(runId: string, reason: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('legal_ingestion_fail_structure_run', {
    p_run_id: runId,
    p_failure_reason: reason,
  });
  if (error) throw error;
}

export async function persistStructureCandidatesForJob(
  jobId: string,
  opts: { replaceStaging: boolean; useLayout?: boolean; createdBy?: string | null },
): Promise<{
  analysis: StructureDetectionAnalysis;
  preserved_accepted: number;
  structure_run_id: string | null;
  previous_active_run_id: string | null;
  source_note_count: number;
} | null> {
  const schemaApplied = await structureRunSchemaAvailable();
  if (!schemaApplied) {
    if (opts.replaceStaging) {
      throw new Error(STRUCTURE_RUN_SCHEMA_HINT);
    }
    return null;
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('legal_ingestion_jobs')
    .select(
      'id, document_id, country_code, tax_source_id, status, structure_candidate_count, needs_ocr_page_count, failed_page_count, last_error, active_structure_run_id',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) {
    if (isSupabaseMissingTableError(jobError)) return null;
    throw jobError;
  }
  if (!job) return null;

  const existingCandidates = await fetchAllPaged<{
    id: string;
    candidate_kind: string;
    candidate_status: string;
    accepted_tax_legal_node_id: string | null;
    structure_run_id: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from('legal_ingestion_candidates')
      .select('id, candidate_kind, candidate_status, accepted_tax_legal_node_id, structure_run_id')
      .eq('job_id', jobId)
      .order('sort_order', { ascending: true })
      .range(from, to),
  );

  if (
    shouldSkipNonReplacePersist({
      replace_staging: opts.replaceStaging,
      active_structure_run_id: job.active_structure_run_id == null ? null : String(job.active_structure_run_id),
      existing_candidate_count: existingCandidates.length,
    })
  ) {
    return null;
  }

  const previousActiveId = job.active_structure_run_id == null ? null : String(job.active_structure_run_id);
  const preservedAccepted = existingCandidates.filter(
    (row) =>
      row.candidate_kind === 'structure' &&
      (row.candidate_status === 'accepted' || row.accepted_tax_legal_node_id) &&
      (previousActiveId ? row.structure_run_id === previousActiveId : true),
  ).length;

  const { data: buildingExisting, error: buildingError } = await supabaseAdmin
    .from('legal_ingestion_structure_runs')
    .select('id')
    .eq('job_id', jobId)
    .eq('status', 'building')
    .maybeSingle();
  if (buildingError) throw buildingError;
  if (buildingExisting?.id) {
    await failBuildingRun(String(buildingExisting.id), 'replaced_by_new_rebuild');
  }

  const pages = await fetchAllPaged<{
    page_no: number;
    page_text: string | null;
    status: string;
    page_text_items: unknown;
  }>((from, to) =>
    supabaseAdmin
      .from('legal_ingestion_pages')
      .select('page_no, page_text, status, page_text_items')
      .eq('job_id', jobId)
      .order('page_no', { ascending: true })
      .range(from, to),
  );

  const extractedPages = pages
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

  const existingNodes = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from('tax_legal_nodes')
      .select(
        'id, tax_source_id, country_code, parent_node_id, node_number, normalized_machine_identifier, title, tax_legal_node_kind_id',
      )
      .eq('tax_source_id', job.tax_source_id)
      .order('id', { ascending: true })
      .range(from, to),
  ).catch(async (error: unknown) => {
    if (error && isSupabaseMissingColumnError(error as { message?: string; code?: string }, 'normalized_machine_identifier')) {
      return fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabaseAdmin
          .from('tax_legal_nodes')
          .select('id, tax_source_id, country_code, parent_node_id, node_number, title, tax_legal_node_kind_id')
          .eq('tax_source_id', job.tax_source_id)
          .order('id', { ascending: true })
          .range(from, to),
      );
    }
    throw error;
  });

  const kindById = new Map((kinds ?? []).map((row) => [String(row.id), String(row.label)]));
  const nodes = existingNodes.map((row) => ({
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
    existing_nodes: nodes,
  });
  const assigned = assignDraftIds(drafts);

  assertWorkerTableAllowed('legal_ingestion_structure_runs');
  const { data: createdRun, error: runError } = await supabaseAdmin
    .from('legal_ingestion_structure_runs')
    .insert({
      job_id: job.id,
      document_id: job.document_id,
      country_code: job.country_code,
      tax_source_id: job.tax_source_id,
      status: 'building',
      detector_version: detectorVersionForRebuild(Boolean(opts.useLayout)),
      layout_used: Boolean(opts.useLayout),
      expected_candidate_count: assigned.length,
      persisted_candidate_count: 0,
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single();
  if (runError || !createdRun) throw runError ?? new Error('Failed to create structure run');
  const runId = String(createdRun.id);

  try {
    assertWorkerTableAllowed('legal_ingestion_candidates');
    const rows = assigned.map((draft, index) => {
      const parentDraft = draft.parent_index != null ? drafts[draft.parent_index] ?? null : null;
      const match = nodes.find((node) => {
        if (node.kind_label !== draft.kind_label) return false;
        const draftRoot = draft.parent_index == null;
        const nodeRoot = node.parent_node_id == null;
        if (draftRoot !== nodeRoot) return false;
        if (!draftRoot) {
          const parentNode = nodes.find((candidate) => candidate.id === node.parent_node_id) ?? null;
          if (parentDraft && parentNode && !sameParentIdentity(parentDraft, parentNode)) return false;
        }
        if (draft.normalized_machine_identifier && node.normalized_machine_identifier) {
          return draft.normalized_machine_identifier === node.normalized_machine_identifier;
        }
        return Boolean(node.node_number) && node.node_number === draft.node_number;
      });
      return {
        id: draft.id,
        job_id: job.id,
        document_id: job.document_id,
        country_code: job.country_code,
        tax_source_id: job.tax_source_id,
        structure_run_id: runId,
        candidate_kind: 'structure' as const,
        candidate_status: draft.candidate_status,
        kind_label: draft.kind_label,
        node_number: draft.node_number,
        source_display_identifier: draft.source_display_identifier ?? null,
        normalized_machine_identifier: draft.normalized_machine_identifier ?? null,
        identifier_base_number: draft.identifier_base_number ?? null,
        identifier_letter_suffix: draft.identifier_letter_suffix ?? null,
        identifier_nested_components: draft.identifier_nested_components ?? [],
        printed_marker: draft.printed_marker ?? null,
        title: draft.title,
        parent_candidate_id: draft.parent_candidate_id,
        page_start: draft.page_start,
        page_end: draft.page_end,
        source_page: draft.source_page ?? draft.page_start,
        source_item_start: draft.source_item_start ?? null,
        source_item_end: draft.source_item_end ?? null,
        source_line_index: draft.source_line_index ?? null,
        source_bbox: draft.source_bbox ?? null,
        excerpt: draft.excerpt,
        confidence: draft.confidence,
        validation_warnings: draft.validation_warnings,
        matched_tax_legal_node_id: match?.id ?? null,
        sort_order: index,
      };
    });

    let persisted = 0;
    for (const chunk of chunkInOrder(rows)) {
      let inserted = await supabaseAdmin.from('legal_ingestion_candidates').insert(chunk);
      if (inserted.error && isSupabaseMissingColumnError(inserted.error, 'printed_marker')) {
        inserted = await supabaseAdmin.from('legal_ingestion_candidates').insert(
          chunk.map((row) => {
            const { printed_marker: _printed, ...withoutPrinted } = row;
            void _printed;
            return withoutPrinted;
          }),
        );
      }
      if (inserted.error && isSupabaseMissingColumnError(inserted.error, 'source_display_identifier')) {
        inserted = await supabaseAdmin.from('legal_ingestion_candidates').insert(
          chunk.map((row) => {
            const {
              source_display_identifier: _a,
              normalized_machine_identifier: _b,
              identifier_base_number: _c,
              identifier_letter_suffix: _d,
              identifier_nested_components: _e,
              ...legacy
            } = row;
            void _a;
            void _b;
            void _c;
            void _d;
            void _e;
            return legacy;
          }),
        );
      }
      if (inserted.error && isSupabaseMissingColumnError(inserted.error, 'source_page')) {
        inserted = await supabaseAdmin.from('legal_ingestion_candidates').insert(
          chunk.map((row) => withoutSourceSpanColumns(row as Record<string, unknown>)),
        );
      }
      if (inserted.error) throw inserted.error;
      persisted += chunk.length;
      const { error: progressError } = await supabaseAdmin
        .from('legal_ingestion_structure_runs')
        .update({ persisted_candidate_count: persisted })
        .eq('id', runId)
        .eq('status', 'building');
      if (progressError) throw progressError;
    }

    const persistedRows = await fetchAllPaged<{
      id: string;
      structure_run_id: string;
      parent_candidate_id: string | null;
      source_display_identifier: string | null;
      normalized_machine_identifier: string | null;
      identifier_base_number: string | null;
      identifier_nested_components: unknown;
    }>((from, to) =>
      supabaseAdmin
        .from('legal_ingestion_candidates')
        .select(
          'id, structure_run_id, parent_candidate_id, source_display_identifier, normalized_machine_identifier, identifier_base_number, identifier_nested_components',
        )
        .eq('structure_run_id', runId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    );
    const validation = validateStructureRunCandidates(
      persistedRows.map((row) => ({
        id: String(row.id),
        structure_run_id: String(row.structure_run_id),
        parent_candidate_id: row.parent_candidate_id == null ? null : String(row.parent_candidate_id),
        source_display_identifier: row.source_display_identifier,
        normalized_machine_identifier: row.normalized_machine_identifier,
        identifier_base_number: row.identifier_base_number,
        identifier_nested_components: Array.isArray(row.identifier_nested_components)
          ? row.identifier_nested_components.map((item) => String(item))
          : [],
      })),
      assigned.length,
      runId,
    );
    if (!canActivateStructureRun({ status: 'building', validation })) {
      throw new Error(
        `Structure run validation failed: persisted=${validation.persisted_count} expected=${validation.expected_count} orphans=${validation.orphan_parents} self=${validation.self_parents}`,
      );
    }

    const sourceNotes =
      opts.useLayout && (await sourceEvidenceSchemaAvailable())
        ? detectSourceNotesFromLayout(extractedPages)
        : { notes: [], unresolved_anchors: [] };
    let sourceNoteCount = 0;
    if (sourceNotes.notes.length || sourceNotes.unresolved_anchors.length) {
      sourceNoteCount = await persistSourceEvidenceForRun({
        runId,
        job,
        createdBy: opts.createdBy ?? null,
        notes: sourceNotes.notes,
        unresolvedAnchors: sourceNotes.unresolved_anchors,
      });
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
    const { error: cutoverError } = await supabaseAdmin.rpc('legal_ingestion_activate_structure_run', {
      p_job_id: jobId,
      p_run_id: runId,
      p_expected_count: assigned.length,
      p_warning_count: warningCount,
      p_job_status: nextStatus,
      p_last_error: job.status === 'extraction_failed' ? job.last_error : encodeStructureAnalysis(detected.analysis),
    });
    if (cutoverError) throw cutoverError;

    return {
      analysis: detected.analysis,
      preserved_accepted: preservedAccepted,
      structure_run_id: runId,
      previous_active_run_id: previousActiveId,
      source_note_count: sourceNoteCount,
    };
  } catch (error) {
    try {
      await failBuildingRun(runId, error instanceof Error ? error.message : 'structure_run_persist_failed');
    } catch {
      // Keep the original persist failure. The run stays building if fail RPC also fails.
    }
    throw error;
  }
}
