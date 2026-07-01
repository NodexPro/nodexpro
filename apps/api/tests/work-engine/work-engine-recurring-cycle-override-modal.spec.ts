import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const overrideModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineRecurringCycleOverrideModal.tsx'),
  'utf8',
);

test('future override modal renders context sidebar and backend refresh/preview wiring', () => {
  assert.ok(overrideModalSource.includes('CycleOverrideContextSidebar'));
  assert.ok(overrideModalSource.includes('aggregate.context_panel'));
  assert.ok(overrideModalSource.includes('nx-we-retainer-setup__body'));
  assert.ok(overrideModalSource.includes('nx-we-retainer-setup__sidebar'));
  assert.ok(overrideModalSource.includes('refresh_recurring_cycle_override_step'));
  assert.ok(overrideModalSource.includes('preview_recurring_cycle_override'));
  assert.ok(overrideModalSource.includes('onProjectionStepChange={handleProjectionStepChange}'));
  assert.ok(overrideModalSource.includes('nx-we-retainer-preview-overlay--stacked'));
  assert.ok(overrideModalSource.includes('WorkEngineRecurringCycleOverrideSaveDialog'));
});
