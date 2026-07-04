import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const overrideServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-override.service.ts'),
  'utf8',
);
const setupModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const commandsServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.commands.service.ts'),
  'utf8',
);
const readModelSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.read-model.service.ts'),
  'utf8',
);

test('cycle override open path uses template snapshot not draft workspace', () => {
  const fnStart = overrideServiceSource.indexOf('async function buildCycleOverrideAggregate');
  const fnEnd = overrideServiceSource.indexOf('export async function openRecurringCycleOverrideForEdit', fnStart);
  const fnBlock = overrideServiceSource.slice(fnStart, fnEnd);
  const refreshBranchStart = fnBlock.indexOf('if (params.documentDetailsStep)');
  const elseBranchStart = fnBlock.indexOf('} else {', refreshBranchStart);
  const refreshBranch = fnBlock.slice(refreshBranchStart, elseBranchStart);
  const openBranch = fnBlock.slice(elseBranchStart, fnBlock.indexOf('if (params.includePreview)'));

  assert.ok(!refreshBranch.includes('ensureRetainerDocumentDraftWorkspace'));
  assert.ok(refreshBranch.includes('refreshFutureCycleProjectionStepTotals'));
  assert.ok(!openBranch.includes('ensureRetainerDocumentDraftWorkspace'));
  assert.ok(openBranch.includes('buildProjectionBaseStepFromTemplateSnapshot'));
  assert.ok(openBranch.includes('buildFutureCycleProjectionStep'));
});

test('cycle override totals refresh skips document type resolver', () => {
  assert.ok(overrideServiceSource.includes('totalsOnly'));
  assert.ok(overrideServiceSource.includes('buildRetainerDocumentTypeOptions'));
});

test('refresh_recurring_cycle_override_step command does not rebuild setup aggregate', () => {
  const refreshStart = commandsServiceSource.indexOf(
    "command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.refreshCycleOverride",
  );
  const refreshEnd = commandsServiceSource.indexOf(
    "command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.saveCycleOverride",
    refreshStart,
  );
  const refreshBlock = commandsServiceSource.slice(refreshStart, refreshEnd);
  assert.ok(refreshBlock.includes('refreshRecurringCycleOverrideStep'));
  assert.ok(!refreshBlock.includes('buildWorkEngineInvoiceRetainerSetupAggregate'));
  assert.ok(!refreshBlock.includes('work_engine_invoice_retainer_setup_aggregate'));
});

test('parent setup modal pauses preview and setup refresh while cycle override is open', () => {
  assert.ok(setupModalSource.includes('cycleOverrideOpenRef'));
  assert.ok(setupModalSource.includes('if (cycleOverrideOpenRef.current) return'));
  assert.ok(setupModalSource.includes('preview_income_recurring_document_profile_settings'));
  assert.ok(setupModalSource.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
  assert.ok(setupModalSource.includes('readOnly={isNextDocumentTab || cycleOverrideOpen}'));

  const previewStart = setupModalSource.indexOf('const runPreview = useCallback');
  const previewBlock = setupModalSource.slice(previewStart, previewStart + 500);
  assert.ok(previewBlock.includes('cycleOverrideOpenRef.current'));

  const refreshStart = setupModalSource.indexOf('const refreshSetupAggregate = useCallback');
  const refreshBlock = setupModalSource.slice(refreshStart, refreshStart + 300);
  assert.ok(refreshBlock.includes('cycleOverrideOpenRef.current'));

  const formChangeStart = setupModalSource.indexOf('const handleFormChange = useCallback');
  const formChangeBlock = setupModalSource.slice(formChangeStart, formChangeStart + 450);
  assert.ok(formChangeBlock.includes('cycleOverrideOpenRef.current'));
});

test('schedule_refresh setup aggregate skips template draft workspace', () => {
  assert.ok(readModelSource.includes("buildMode?: WorkEngineInvoiceRetainerSetupAggregateBuildMode"));
  assert.ok(readModelSource.includes("const skipDocumentDraftWorkspace = buildMode === 'schedule_refresh'"));
  assert.ok(readModelSource.includes('buildProjectionBaseStepFromTemplateSnapshot'));
  assert.ok(readModelSource.includes('if (!skipDocumentDraftWorkspace)'));
});

test('save and delete cycle override return schedule-refreshed setup aggregate', () => {
  assert.ok(overrideServiceSource.includes("buildMode: 'schedule_refresh'"));
  assert.ok(overrideServiceSource.includes("command: 'save_recurring_cycle_override'"));
  assert.ok(overrideServiceSource.includes("command: 'delete_recurring_cycle_override'"));
});
