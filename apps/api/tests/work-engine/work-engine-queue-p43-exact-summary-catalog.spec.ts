/**
 * P4.3 — Work Engine queue exact summary / filter-catalog aggregations.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WORK_ENGINE_FILTER_CATALOG_MAX_PAGES,
  WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE,
  foldWorkItemStateCountsFromRows,
} from '../../src/domains/work-engine/work-engine-queue-summary-catalog.pure.js';
import { WORK_STATES } from '../../src/domains/work-engine/work-engine.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const readModelSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.read-models.service.ts'),
  'utf8',
);
const exactSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-queue-summary-catalog.exact.ts'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-queue-summary-catalog.pure.ts'),
  'utf8',
);
const reminderSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.reminder-review.service.ts'),
  'utf8',
);
const feQueueSource = readFileSync(
  join(dir, '../../../web/src/pages/WorkEngineQueue.tsx'),
  'utf8',
);

test('1 — summary truth is not capped at 5000 rows (exact head counts)', () => {
  assert.match(exactSource, /count: 'exact',\s*head: true/);
  assert.match(exactSource, /loadWorkItemCountsByStateExact/);
  assert.match(readModelSource, /loadWorkItemCountsByStateExact/);
  // Queue + foundation no longer scan work_state with .limit(5000)
  assert.doesNotMatch(
    readModelSource,
    /\.select\('work_state'\)[\s\S]{0,120}\.limit\(5000\)/,
  );
});

test('2 — filter catalogs are not derived from a capped 5000-row sample', () => {
  assert.match(exactSource, /loadWorkItemFilterCatalogDimensionsExact/);
  assert.match(readModelSource, /loadWorkItemFilterCatalogDimensionsExact/);
  assert.doesNotMatch(
    readModelSource,
    /\.select\('module_key, assigned_user_id, reviewer_user_id, period_key'\)[\s\S]{0,120}\.limit\(5000\)/,
  );
  assert.equal(WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE, 1000);
  assert.ok(WORK_ENGINE_FILTER_CATALOG_MAX_PAGES * WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE > 5000);
  // Catalog loader pages with .range — not a single .limit(5000)
  assert.match(exactSource, /\.range\(from,\s*to\)/);
  assert.doesNotMatch(exactSource, /\.limit\(5000\)/);
  assert.match(pureSource, /WORK_ENGINE_FILTER_CATALOG_PAGE_SIZE/);
});

test('3 — simulated >5000 rows: fold semantics match prior Node active definition', () => {
  const rows = [
    ...Array.from({ length: 3000 }, () => ({ work_state: 'assigned' })),
    ...Array.from({ length: 2500 }, () => ({ work_state: 'waiting_client' })),
    ...Array.from({ length: 100 }, () => ({ work_state: 'done' })),
  ];
  assert.ok(rows.length > 5000);
  const folded = foldWorkItemStateCountsFromRows(rows);
  assert.equal(folded.by_state.assigned, 3000);
  assert.equal(folded.by_state.waiting_client, 2500);
  assert.equal(folded.by_state.done, 100);
  assert.equal(folded.total_active, 5500);
  // Exact loader covers every WORK_STATES key
  for (const s of WORK_STATES) {
    assert.match(exactSource, new RegExp(`'${s}'|WORK_STATES`));
  }
});

test('4 — queue row pagination path remains range-based with exact total_matching', () => {
  assert.match(readModelSource, /\.range\(f\.offset,\s*f\.offset \+ f\.limit - 1\)/);
  assert.match(readModelSource, /\{ count: 'exact' \}/);
  assert.match(readModelSource, /total_matching: totalMatching/);
  // Row query must not use the old summary .limit(5000) pattern
  const pageSection = readModelSource.slice(
    readModelSource.indexOf('// ---- 3. Page query'),
    readModelSource.indexOf('// ---- 4. Batch-fetch'),
  );
  assert.doesNotMatch(pageSection, /\.limit\(5000\)/);
});

test('5 — org/tenant isolation remains on summary + catalog + page queries', () => {
  assert.match(exactSource, /\.eq\('org_id',\s*orgId\)/);
  assert.match(readModelSource, /\.eq\('org_id',\s*orgId\)/);
});

test('6 — summary card semantics keys preserved on queue aggregate', () => {
  assert.match(readModelSource, /total_active:\s*totalActive/);
  assert.match(readModelSource, /waiting_client:\s*counts\.waiting_client/);
  assert.match(readModelSource, /waiting_human:\s*counts\.waiting_human/);
  assert.match(readModelSource, /overdue:\s*counts\.overdue/);
  assert.match(readModelSource, /escalated:\s*counts\.escalated/);
  assert.match(
    readModelSource,
    /review_pending:\s*\n?\s*\(counts\.review_pending \?\? 0\) \+ reminderReviewSummary\.pending_count/,
  );
});

test('7 — filter catalog dimensions still modules/assignees/reviewers/period_keys from work_items', () => {
  assert.match(readModelSource, /modules: Array\.from\(distinctModules\)/);
  assert.match(readModelSource, /assignees: Array\.from\(distinctAssignees\)/);
  assert.match(readModelSource, /reviewers: Array\.from\(distinctReviewers\)/);
  assert.match(readModelSource, /period_keys: Array\.from\(distinctPeriods\)/);
  assert.match(exactSource, /module_key, assigned_user_id, reviewer_user_id, period_key/);
});

test('8 — frontend receives ready-to-render truth; no FE count/catalog inference', () => {
  assert.doesNotMatch(feQueueSource, /summary_cards\.[a-z_]+\s*\+/);
  assert.doesNotMatch(feQueueSource, /new Set\(.*module/);
  assert.doesNotMatch(feQueueSource, /\.filter\(.*work_state.*\)\.length/);
  assert.match(feQueueSource, /summary_cards/);
});

test('9 — reminder review summary counts no longer silently truncate at 5000', () => {
  const fnStart = reminderSource.indexOf('export async function loadReminderReviewCounts');
  const fnEnd = reminderSource.indexOf('export async function editReminderCandidate', fnStart);
  const fnBody = reminderSource.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnBody, /\.limit\(5000\)/);
  assert.match(fnBody, /\.range\(from,\s*to\)/);
});
