/**
 * P4.3 — pure helpers / constants for queue summary + filter catalog.
 * No DB imports (safe for unit tests without SUPABASE_* env).
 */

import { WORK_STATES } from './work-engine.types.js';

/** Thin page size for filter-catalog dimension discovery (not a global truth cap). */
export const WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE = 1000;

/** Safety valve so a runaway loop cannot hang forever (~10M rows). */
export const WORK_ENGINE_FILTER_CATALOG_MAX_PAGES = 10_000;

/** Pure: fold state-count map the same way the old Node scan did. */
export function foldWorkItemStateCountsFromRows(
  rows: Array<{ work_state: string }>,
): { by_state: Record<string, number>; total_active: number } {
  const by_state: Record<string, number> = {};
  for (const s of WORK_STATES) by_state[s] = 0;
  let total_active = 0;
  for (const r of rows) {
    const st = r.work_state;
    by_state[st] = (by_state[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') total_active += 1;
  }
  return { by_state, total_active };
}
