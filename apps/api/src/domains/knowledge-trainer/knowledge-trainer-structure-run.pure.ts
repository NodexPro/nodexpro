import { randomUUID } from 'node:crypto';
import type { StructureCandidateDraft } from './knowledge-trainer.types.js';

export const STRUCTURE_RUN_STATUSES = ['building', 'ready', 'failed', 'superseded', 'cancelled'] as const;
export type StructureRunStatus = (typeof STRUCTURE_RUN_STATUSES)[number];

export const STRUCTURE_RUN_PAGE_SIZE = 500;
export const STRUCTURE_CANDIDATE_INSERT_CHUNK = 200;
export const DETECTOR_VERSION_LAYOUT = 'knowledge-trainer.layout.v4-nested';
export const DETECTOR_VERSION_TEXT = 'knowledge-trainer.text.v1';
export const DETECTOR_VERSION_LEGACY_BACKFILL = 'legacy-pre-627';

export type StructureRunCandidateRow = {
  id: string;
  structure_run_id: string;
  parent_candidate_id: string | null;
  source_display_identifier?: string | null;
  normalized_machine_identifier?: string | null;
  identifier_base_number?: string | null;
  identifier_nested_components?: string[] | null;
};

export type StructureRunValidation = {
  ok: boolean;
  persisted_count: number;
  expected_count: number;
  orphan_parents: number;
  self_parents: number;
  cross_run_parents: number;
  missing_identifiers: number;
};

export type AssignedStructureDraft = StructureCandidateDraft & {
  id: string;
  parent_candidate_id: string | null;
};

export function detectorVersionForRebuild(useLayout: boolean): string {
  return useLayout ? DETECTOR_VERSION_LAYOUT : DETECTOR_VERSION_TEXT;
}

export function classifyLegacyJobCandidates(input: {
  persisted_count: number;
  job_reported_count: number;
}): 'ready' | 'failed' {
  if (input.persisted_count > 0 && input.persisted_count === input.job_reported_count) return 'ready';
  return 'failed';
}

export function shouldSkipNonReplacePersist(input: {
  replace_staging: boolean;
  active_structure_run_id: string | null;
  existing_candidate_count: number;
}): boolean {
  if (input.replace_staging) return false;
  return Boolean(input.active_structure_run_id) || input.existing_candidate_count > 0;
}

export function ownerVisibleCandidates<T extends { structure_run_id?: string | null }>(
  rows: T[],
  activeReadyRunId: string | null,
): T[] {
  if (!activeReadyRunId) return [];
  return rows.filter((row) => row.structure_run_id === activeReadyRunId);
}

export function structureRunStatusLabel(input: {
  schema_applied: boolean;
  active_run_id: string | null;
  building_run_id: string | null;
}): string {
  if (!input.schema_applied) return 'Structure-run schema is not applied.';
  if (input.building_run_id && input.active_run_id) {
    return 'Rebuild in progress. Previous complete run remains visible.';
  }
  if (input.building_run_id) return 'Rebuild in progress. No complete run is active yet.';
  if (input.active_run_id) return 'Active complete run.';
  return 'No complete structure run.';
}

export function jobCountAfterPersistPhase(input: {
  phase: 'building' | 'validated' | 'failed' | 'activated';
  previous_count: number;
  new_count: number;
}): number {
  return input.phase === 'activated' ? input.new_count : input.previous_count;
}

export function paginationRanges(
  total: number,
  pageSize: number = STRUCTURE_RUN_PAGE_SIZE,
): Array<{ from: number; to: number }> {
  if (total <= 0) return [];
  const size = Math.max(1, pageSize);
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = 0; from < total; from += size) {
    ranges.push({ from, to: Math.min(from + size - 1, total - 1) });
  }
  return ranges;
}

export function chunkInOrder<T>(rows: T[], size: number = STRUCTURE_CANDIDATE_INSERT_CHUNK): T[][] {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    chunks.push(rows.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function assignDraftIds(drafts: StructureCandidateDraft[]): AssignedStructureDraft[] {
  const ids = drafts.map(() => randomUUID());
  return drafts.map((draft, index) => {
    const parentId =
      draft.parent_index == null ? null : ids[draft.parent_index] ?? null;
    return {
      ...draft,
      id: ids[index] ?? randomUUID(),
      parent_candidate_id: parentId,
    };
  });
}

export function validateStructureRunCandidates(
  rows: StructureRunCandidateRow[],
  expectedCount: number,
  runId: string,
): StructureRunValidation {
  const ids = new Set(rows.map((row) => row.id));
  let orphanParents = 0;
  let selfParents = 0;
  let crossRunParents = 0;
  let missingIdentifiers = 0;
  for (const row of rows) {
    if (row.structure_run_id !== runId) {
      crossRunParents += 1;
      continue;
    }
    if (row.parent_candidate_id) {
      if (row.parent_candidate_id === row.id) selfParents += 1;
      if (!ids.has(row.parent_candidate_id)) orphanParents += 1;
    }
    const nestedOk = Array.isArray(row.identifier_nested_components);
    if (row.source_display_identifier) {
      if (!row.normalized_machine_identifier || !row.identifier_base_number || !nestedOk) {
        missingIdentifiers += 1;
      }
    }
  }
  return {
    ok:
      rows.length === expectedCount &&
      orphanParents === 0 &&
      selfParents === 0 &&
      crossRunParents === 0 &&
      missingIdentifiers === 0,
    persisted_count: rows.length,
    expected_count: expectedCount,
    orphan_parents: orphanParents,
    self_parents: selfParents,
    cross_run_parents: crossRunParents,
    missing_identifiers: missingIdentifiers,
  };
}

export function canActivateStructureRun(input: {
  status: string;
  validation: StructureRunValidation;
}): boolean {
  return input.status === 'building' && input.validation.ok;
}

export function mixedGeneration(rows: Array<{ structure_run_id?: string | null }>): boolean {
  const ids = new Set(rows.map((row) => row.structure_run_id ?? ''));
  return ids.size > 1;
}
