import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignDraftIds,
  canActivateStructureRun,
  chunkInOrder,
  classifyLegacyJobCandidates,
  detectorVersionForRebuild,
  jobCountAfterPersistPhase,
  mixedGeneration,
  ownerVisibleCandidates,
  paginationRanges,
  shouldSkipNonReplacePersist,
  structureRunStatusLabel,
  validateStructureRunCandidates,
  STRUCTURE_CANDIDATE_INSERT_CHUNK,
  STRUCTURE_RUN_PAGE_SIZE,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-structure-run.pure.js';
import type { StructureCandidateDraft } from '../../src/domains/knowledge-trainer/knowledge-trainer.types.js';
import { fetchAllPaged } from '../../src/domains/knowledge-trainer/knowledge-trainer-pagination.js';

function draft(partial: Partial<StructureCandidateDraft> & { parent_index: number | null }): StructureCandidateDraft {
  return {
    candidate_kind: 'structure',
    candidate_status: 'needs_review',
    kind_label: 'סעיף',
    node_number: '1',
    source_display_identifier: '1',
    normalized_machine_identifier: '1',
    identifier_base_number: '1',
    identifier_letter_suffix: null,
    identifier_nested_components: [],
    title: 't',
    page_start: 1,
    page_end: 1,
    excerpt: 'x',
    confidence: 0.9,
    validation_warnings: [],
    ...partial,
  };
}

function row(id: string, runId: string, parent: string | null = null) {
  return {
    id,
    structure_run_id: runId,
    parent_candidate_id: parent,
    source_display_identifier: '2(1)',
    normalized_machine_identifier: '2(1)',
    identifier_base_number: '2',
    identifier_nested_components: ['1'],
  };
}

test('1-2) active 397 stay visible while a building run exists', () => {
  const active = Array.from({ length: 397 }, (_, i) => ({ id: `a${i}`, structure_run_id: 'ready-run' }));
  const building = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, structure_run_id: 'building-run' }));
  const visible = ownerVisibleCandidates([...active, ...building], 'ready-run');
  assert.equal(visible.length, 397);
  assert.equal(visible.every((item) => item.structure_run_id === 'ready-run'), true);
  assert.equal(structureRunStatusLabel({ schema_applied: true, active_run_id: 'ready-run', building_run_id: 'building-run' }),
    'Rebuild in progress. Previous complete run remains visible.');
});

test('3-6) kill/fail at 100 or 2147 never activates the incomplete run', () => {
  const building100 = Array.from({ length: 100 }, (_, i) => row(`b${i}`, 'building-run'));
  const building2147 = Array.from({ length: 2147 }, (_, i) => row(`c${i}`, 'building-run'));
  const failed100 = validateStructureRunCandidates(building100, 2499, 'building-run');
  const failed2147 = validateStructureRunCandidates(building2147, 2499, 'building-run');
  assert.equal(failed100.ok, false);
  assert.equal(failed2147.ok, false);
  assert.equal(canActivateStructureRun({ status: 'building', validation: failed100 }), false);
  assert.equal(canActivateStructureRun({ status: 'failed', validation: validateStructureRunCandidates(building2147, 2147, 'building-run') }), false);
  assert.equal(ownerVisibleCandidates(building2147, 'ready-run').length, 0);
  assert.equal(ownerVisibleCandidates(building2147, null).length, 0);
});

test('7-11) full 2500-row run keeps identifiers, parents, and no orphans', () => {
  const drafts = Array.from({ length: 2500 }, (_, i) =>
    draft({
      parent_index: i === 0 ? null : 0,
      node_number: String(i),
      source_display_identifier: i === 1 ? '2(1)' : String(i),
      normalized_machine_identifier: i === 1 ? '2(1)' : String(i),
      identifier_base_number: i === 1 ? '2' : String(i),
      identifier_nested_components: i === 1 ? ['1'] : [],
    }),
  );
  const assigned = assignDraftIds(drafts);
  assert.equal(assigned.length, 2500);
  assert.equal(new Set(assigned.map((item) => item.id)).size, 2500);
  assert.equal(assigned[0]?.parent_candidate_id, null);
  assert.equal(assigned[1]?.parent_candidate_id, assigned[0]?.id);
  assert.equal(assigned[1]?.source_display_identifier, '2(1)');
  const chunks = chunkInOrder(assigned, STRUCTURE_CANDIDATE_INSERT_CHUNK);
  assert.equal(chunks.length, 13);
  assert.equal(chunks[0]?.length, 200);
  assert.equal(chunks.at(-1)?.length, 100);
  const validation = validateStructureRunCandidates(
    assigned.map((item) => ({
      id: item.id,
      structure_run_id: 'new-run',
      parent_candidate_id: item.parent_candidate_id,
      source_display_identifier: item.source_display_identifier,
      normalized_machine_identifier: item.normalized_machine_identifier,
      identifier_base_number: item.identifier_base_number,
      identifier_nested_components: item.identifier_nested_components,
    })),
    2500,
    'new-run',
  );
  assert.equal(validation.ok, true);
  assert.equal(validation.orphan_parents, 0);
  assert.equal(validation.self_parents, 0);
});

test('8) >1000 candidates are paged without truncation', () => {
  const ranges = paginationRanges(2147, STRUCTURE_RUN_PAGE_SIZE);
  assert.equal(ranges.length, 5);
  assert.deepEqual(ranges[0], { from: 0, to: 499 });
  assert.deepEqual(ranges.at(-1), { from: 2000, to: 2146 });
  assert.equal(ranges.reduce((sum, range) => sum + (range.to - range.from + 1), 0), 2147);
});

test('12-14) job count changes only at atomic cutover and previous run is superseded conceptually', () => {
  assert.equal(jobCountAfterPersistPhase({ phase: 'building', previous_count: 397, new_count: 2499 }), 397);
  assert.equal(jobCountAfterPersistPhase({ phase: 'validated', previous_count: 397, new_count: 2499 }), 397);
  assert.equal(jobCountAfterPersistPhase({ phase: 'failed', previous_count: 397, new_count: 2147 }), 397);
  assert.equal(jobCountAfterPersistPhase({ phase: 'activated', previous_count: 397, new_count: 2499 }), 2499);
});

test('15-18) retry does not mix generations into the owner view', () => {
  const oldReady = [{ id: '1', structure_run_id: 'run-a' }];
  const failed = [{ id: '2', structure_run_id: 'run-b' }];
  const nextBuilding = [{ id: '3', structure_run_id: 'run-c' }];
  const visible = ownerVisibleCandidates([...oldReady, ...failed, ...nextBuilding], 'run-a');
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, '1');
  assert.equal(mixedGeneration(visible), false);
  assert.equal(mixedGeneration([...oldReady, ...failed]), true);
  assert.equal(shouldSkipNonReplacePersist({
    replace_staging: false,
    active_structure_run_id: 'run-a',
    existing_candidate_count: 397,
  }), true);
  assert.equal(shouldSkipNonReplacePersist({
    replace_staging: true,
    active_structure_run_id: 'run-a',
    existing_candidate_count: 397,
  }), false);
});

test('legacy 2147 vs 397 is classified failed and not ready', () => {
  assert.equal(classifyLegacyJobCandidates({ persisted_count: 2147, job_reported_count: 397 }), 'failed');
  assert.equal(classifyLegacyJobCandidates({ persisted_count: 397, job_reported_count: 397 }), 'ready');
  assert.equal(detectorVersionForRebuild(true), 'knowledge-trainer.layout.v4-nested');
});

test('19) fetchAllPaged keeps going past the first 1000 rows', async () => {
  const pages = [
    Array.from({ length: 500 }, (_, i) => i),
    Array.from({ length: 500 }, (_, i) => i + 500),
    Array.from({ length: 500 }, (_, i) => i + 1000),
    Array.from({ length: 147 }, (_, i) => i + 1500),
  ];
  let calls = 0;
  const rows = await fetchAllPaged<number>(async (from, to) => {
    const page = pages[calls] ?? [];
    calls += 1;
    assert.equal(to - from + 1, 500);
    return { data: page, error: null };
  }, 500);
  assert.equal(rows.length, 1647);
  assert.equal(calls, 4);
});
