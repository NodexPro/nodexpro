/**
 * P4.3 — exact Work Engine queue summary counts + filter-catalog dimensions.
 * Database-owned counts (head/exact); catalog via uncapped thin-column scan
 * (no silent 5000 sample truncation). Preserves existing org + semantics.
 */

import { supabaseAdmin } from '../../db/client.js';
import { WORK_STATES, type WorkState } from './work-engine.types.js';
import {
  WORK_ENGINE_FILTER_CATALOG_MAX_PAGES,
  WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE,
} from './work-engine-queue-summary-catalog.pure.js';

export type WorkItemCountsByState = {
  by_state: Record<WorkState, number>;
  total_active: number;
  total_all: number;
};

export type WorkItemFilterCatalogDimensions = {
  modules: string[];
  assignees: string[];
  reviewers: string[];
  period_keys: string[];
};

/**
 * Exact per-state counts for one org (no row hydration).
 * total_active = all states except done/archived (matches prior Node semantics).
 */
export async function loadWorkItemCountsByStateExact(
  orgId: string,
): Promise<WorkItemCountsByState> {
  const by_state = {} as Record<WorkState, number>;
  for (const s of WORK_STATES) by_state[s] = 0;

  const stateResults = await Promise.all(
    WORK_STATES.map(async (state) => {
      const resp = await supabaseAdmin
        .from('work_items')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('work_state', state);
      if (resp.error) throw resp.error;
      return { state, count: resp.count ?? 0 };
    }),
  );

  let total_all = 0;
  let total_active = 0;
  for (const { state, count } of stateResults) {
    by_state[state] = count;
    total_all += count;
    if (state !== 'done' && state !== 'archived') total_active += count;
  }

  return { by_state, total_active, total_all };
}

type CatalogScanRow = {
  module_key: string | null;
  assigned_user_id: string | null;
  reviewer_user_id: string | null;
  period_key: string | null;
};

/**
 * Distinct filter dimensions for one org from ALL matching work_items
 * (thin columns only, paged until exhausted — not capped at 5000).
 */
export async function loadWorkItemFilterCatalogDimensionsExact(
  orgId: string,
): Promise<WorkItemFilterCatalogDimensions> {
  const distinctModules = new Set<string>();
  const distinctAssignees = new Set<string>();
  const distinctReviewers = new Set<string>();
  const distinctPeriods = new Set<string>();

  for (let page = 0; page < WORK_ENGINE_FILTER_CATALOG_MAX_PAGES; page += 1) {
    const from = page * WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE;
    const to = from + WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE - 1;
    const resp = await supabaseAdmin
      .from('work_items')
      .select('module_key, assigned_user_id, reviewer_user_id, period_key')
      .eq('org_id', orgId)
      .order('id', { ascending: true })
      .range(from, to);
    if (resp.error) throw resp.error;
    const rows = (resp.data ?? []) as CatalogScanRow[];
    if (rows.length === 0) break;

    for (const r of rows) {
      if (r.module_key) distinctModules.add(r.module_key);
      if (r.assigned_user_id) distinctAssignees.add(r.assigned_user_id);
      if (r.reviewer_user_id) distinctReviewers.add(r.reviewer_user_id);
      if (r.period_key) distinctPeriods.add(r.period_key);
    }

    if (rows.length < WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE) break;
  }

  return {
    modules: Array.from(distinctModules),
    assignees: Array.from(distinctAssignees),
    reviewers: Array.from(distinctReviewers),
    period_keys: Array.from(distinctPeriods),
  };
}
