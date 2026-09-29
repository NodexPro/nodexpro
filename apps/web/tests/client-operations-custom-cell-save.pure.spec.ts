import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeCustomCellSaveFailure,
  completeCustomCellSaveSuccess,
  customCellSaveKey,
  getCustomCellSlot,
  isCustomCellInFlight,
  listDirtyCustomCellKeys,
  parseCustomCellSaveKey,
  reconcileManualRowsWithDirtyDrafts,
  rememberCustomCellDraft,
  resolveCustomCellEditorDraft,
  shouldApplyCellSaveAggregate,
  tryStartCustomCellSave,
  type CustomCellSaveIdentity,
  type CustomCellSaveSlot,
} from '../src/lib/client-operations-custom-cell-save.pure.js';

const ORG = 'org-1';
const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';
const COL = 'col-1';
const PERIOD_09 = '2026-09';
const PERIOD_10 = '2026-10';

function identity(
  overrides: Partial<CustomCellSaveIdentity> = {},
): CustomCellSaveIdentity {
  return {
    organizationId: ORG,
    clientId: CLIENT_A,
    columnId: COL,
    operationalPeriodKey: PERIOD_09,
    ...overrides,
  };
}

/** Deterministic simulator: records sent values; never overlaps same-cell flights. */
async function runAutosaveScenario(opts: {
  steps: Array<
    | { type: 'type'; value: string; debounceMs?: number }
    | { type: 'blur' }
    | { type: 'enter' }
    | { type: 'advance'; ms: number }
    | { type: 'completeFlight'; serverValue?: string }
    | { type: 'failFlight' }
    | { type: 'navigate'; toPeriod: string }
  >;
  debounceMs?: number;
  initialServer?: string;
  otherCell?: CustomCellSaveIdentity;
}) {
  const debounceMs = opts.debounceMs ?? 500;
  const slots = new Map<string, CustomCellSaveSlot>();
  const sent: string[] = [];
  const sentPeriods: string[] = [];
  const concurrentSameCell = { max: 0, overlaps: 0 };
  const inFlightKeys = new Set<string>();
  let serverValue = opts.initialServer ?? '';
  let viewedPeriod = PERIOD_09;
  let localDraft = '';
  let editorDraftsAfterPaint: string[] = [];
  let appliedPeriods: string[] = [];
  let now = 0;
  let pendingTimer: { at: number; key: string } | null = null;
  let flight: {
    key: string;
    value: string;
    identity: CustomCellSaveIdentity;
    resolve: (serverValue: string) => void;
    reject: () => void;
  } | null = null;
  const id = identity();
  const key = customCellSaveKey(id);

  const kick = () => {
    const start = tryStartCustomCellSave(slots, id, serverValue);
    if (!start) return;
    if (inFlightKeys.has(start.key)) concurrentSameCell.overlaps += 1;
    inFlightKeys.add(start.key);
    concurrentSameCell.max = Math.max(concurrentSameCell.max, inFlightKeys.size);
    sent.push(start.value);
    sentPeriods.push(start.identity.operationalPeriodKey);
    flight = {
      key: start.key,
      value: start.value,
      identity: start.identity,
      resolve: () => {},
      reject: () => {},
    };
  };

  const complete = (nextServer: string, ok: boolean) => {
    if (!flight) return;
    const f = flight;
    flight = null;
    inFlightKeys.delete(f.key);
    if (!ok) {
      completeCustomCellSaveFailure(slots, f.key);
      localDraft = getCustomCellSlot(slots, f.key).latestDraft ?? localDraft;
      return;
    }
    serverValue = nextServer;
    const { startNext, applyAggregateRecommended } = completeCustomCellSaveSuccess(
      slots,
      f.key,
      f.value,
      nextServer,
    );
    const canApply = shouldApplyCellSaveAggregate({
      responsePeriodKey: f.identity.operationalPeriodKey,
      viewedPeriodKey: viewedPeriod,
    });
    if (canApply) {
      appliedPeriods.push(f.identity.operationalPeriodKey);
      localDraft = resolveCustomCellEditorDraft({
        stillEditing: true,
        localDraft,
        latestDraft: getCustomCellSlot(slots, f.key).latestDraft,
        serverCellValue: nextServer,
      });
      editorDraftsAfterPaint.push(localDraft);
      void applyAggregateRecommended;
    }
    if (startNext) {
      if (inFlightKeys.has(startNext.key)) concurrentSameCell.overlaps += 1;
      inFlightKeys.add(startNext.key);
      concurrentSameCell.max = Math.max(concurrentSameCell.max, inFlightKeys.size);
      sent.push(startNext.value);
      sentPeriods.push(startNext.identity.operationalPeriodKey);
      flight = {
        key: startNext.key,
        value: startNext.value,
        identity: startNext.identity,
        resolve: () => {},
        reject: () => {},
      };
    }
  };

  const type = (value: string) => {
    localDraft = value;
    rememberCustomCellDraft(slots, id, value);
    pendingTimer = { at: now + debounceMs, key };
  };

  const flushImmediate = () => {
    pendingTimer = null;
    kick();
  };

  for (const step of opts.steps) {
    if (step.type === 'type') {
      type(step.value);
    } else if (step.type === 'advance') {
      now += step.ms;
      if (pendingTimer && now >= pendingTimer.at) {
        pendingTimer = null;
        kick();
      }
    } else if (step.type === 'blur' || step.type === 'enter') {
      rememberCustomCellDraft(slots, id, localDraft);
      flushImmediate();
    } else if (step.type === 'completeFlight') {
      complete(step.serverValue ?? flight?.value ?? serverValue, true);
    } else if (step.type === 'failFlight') {
      complete(serverValue, false);
    } else if (step.type === 'navigate') {
      // Prefer await flush before period aggregate (already flushed by caller if needed).
      viewedPeriod = step.toPeriod;
    }
  }

  // Optional other-cell concurrent start check
  let otherCellStarted = false;
  if (opts.otherCell) {
    rememberCustomCellDraft(slots, opts.otherCell, 'other');
    const otherStart = tryStartCustomCellSave(slots, opts.otherCell, '');
    otherCellStarted = Boolean(otherStart);
    if (otherStart && isCustomCellInFlight(slots, key)) {
      // both can be in flight — different keys
      otherCellStarted = true;
    }
  }

  return {
    sent,
    sentPeriods,
    concurrentSameCell,
    serverValue,
    localDraft,
    editorDraftsAfterPaint,
    appliedPeriods,
    inFlight: isCustomCellInFlight(slots, key),
    slot: getCustomCellSlot(slots, key),
    otherCellStarted,
    key,
  };
}

test('1-3: coalesces abc/abcd while ab in flight → sequence [ab, abcd]', async () => {
  const result = await runAutosaveScenario({
    initialServer: '',
    steps: [
      { type: 'type', value: 'a' },
      { type: 'advance', ms: 100 },
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 }, // debounce fires → save "ab"
      { type: 'type', value: 'abc' },
      { type: 'type', value: 'abcd' },
      // only "ab" in flight; no parallel abc/abcd
      { type: 'completeFlight', serverValue: 'ab' }, // then one next save abcd
      { type: 'completeFlight', serverValue: 'abcd' },
    ],
  });
  assert.deepEqual(result.sent, ['ab', 'abcd']);
  assert.equal(result.concurrentSameCell.overlaps, 0);
  assert.equal(result.serverValue, 'abcd');
  assert.equal(result.inFlight, false);
});

test('4: returned ab aggregate cannot replace visible abcd draft', async () => {
  const result = await runAutosaveScenario({
    initialServer: '',
    steps: [
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 },
      { type: 'type', value: 'abcd' },
      { type: 'completeFlight', serverValue: 'ab' },
    ],
  });
  assert.equal(result.editorDraftsAfterPaint[0], 'abcd');
  assert.equal(result.localDraft, 'abcd');
  assert.deepEqual(result.sent, ['ab', 'abcd']); // coalesced next started
});

test('5: same-cell requests never overlap', async () => {
  const result = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 },
      { type: 'type', value: 'abc' },
      { type: 'type', value: 'abcd' },
      { type: 'blur' }, // must not start parallel
      { type: 'completeFlight', serverValue: 'ab' },
      { type: 'completeFlight', serverValue: 'abcd' },
    ],
  });
  assert.equal(result.concurrentSameCell.overlaps, 0);
  assert.ok(result.concurrentSameCell.max <= 1);
});

test('6: different cells CAN save independently', () => {
  const slots = new Map<string, CustomCellSaveSlot>();
  const a = identity({ clientId: CLIENT_A });
  const b = identity({ clientId: CLIENT_B });
  rememberCustomCellDraft(slots, a, 'aa');
  rememberCustomCellDraft(slots, b, 'bb');
  const startA = tryStartCustomCellSave(slots, a, '');
  const startB = tryStartCustomCellSave(slots, b, '');
  assert.ok(startA);
  assert.ok(startB);
  assert.notEqual(startA!.key, startB!.key);
  assert.equal(isCustomCellInFlight(slots, startA!.key), true);
  assert.equal(isCustomCellInFlight(slots, startB!.key), true);
});

test('7-8: blur/Enter during in-flight queues latest, no parallel write', async () => {
  for (const flush of ['blur', 'enter'] as const) {
    const result = await runAutosaveScenario({
      steps: [
        { type: 'type', value: 'ab' },
        { type: 'advance', ms: 500 },
        { type: 'type', value: 'abcd' },
        { type: flush },
        { type: 'completeFlight', serverValue: 'ab' },
        { type: 'completeFlight', serverValue: 'abcd' },
      ],
    });
    assert.deepEqual(result.sent, ['ab', 'abcd'], flush);
    assert.equal(result.concurrentSameCell.overlaps, 0, flush);
  }
});

test('9-10: 2026-09 dirty + navigate 2026-10 — no wrong-period paint; write keeps 2026-09', async () => {
  const result = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 },
      { type: 'navigate', toPeriod: PERIOD_10 },
      { type: 'completeFlight', serverValue: 'ab' },
    ],
  });
  assert.deepEqual(result.sentPeriods, [PERIOD_09]);
  assert.deepEqual(result.appliedPeriods, []); // must not paint 2026-09 into 2026-10 view
  assert.equal(shouldApplyCellSaveAggregate({
    responsePeriodKey: PERIOD_09,
    viewedPeriodKey: PERIOD_10,
  }), false);
});

test('11: save failure preserves latest local draft', async () => {
  const result = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'abcd' },
      { type: 'advance', ms: 500 },
      { type: 'failFlight' },
    ],
  });
  assert.equal(result.localDraft, 'abcd');
  assert.equal(result.slot.latestDraft, 'abcd');
  assert.equal(result.inFlight, false);
  assert.deepEqual(result.sent, ['abcd']); // no infinite retry
});

test('12: no command on every keystroke; 500ms debounce remains', async () => {
  const result = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'a' },
      { type: 'advance', ms: 100 },
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 100 },
      { type: 'type', value: 'abc' },
      { type: 'advance', ms: 499 }, // still under debounce from last type
    ],
  });
  assert.deepEqual(result.sent, []);
  const after = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'a' },
      { type: 'advance', ms: 100 },
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 },
    ],
  });
  assert.deepEqual(after.sent, ['ab']);
});

test('cell identity includes org, client, column, period', () => {
  const k1 = customCellSaveKey(identity());
  const k2 = customCellSaveKey(identity({ operationalPeriodKey: PERIOD_10 }));
  assert.notEqual(k1, k2);
  assert.match(k1, new RegExp(`^${ORG}:${CLIENT_A}:${COL}:${PERIOD_09}$`));
});

test('manual:01 row_key survives parseCustomCellSaveKey (colon in clientId)', () => {
  const id = identity({ clientId: 'manual:01', columnId: 'client_name' });
  const key = customCellSaveKey(id);
  const parsed = parseCustomCellSaveKey(key);
  assert.ok(parsed);
  assert.equal(parsed!.clientId, 'manual:01');
  assert.equal(parsed!.columnId, 'client_name');
  assert.equal(parsed!.operationalPeriodKey, PERIOD_09);
  assert.equal(parsed!.organizationId, ORG);
});

test('manual immediate: A in flight → type BC → next save ABC; no overlap; no debounce', () => {
  const slots = new Map<string, CustomCellSaveSlot>();
  const id = identity({ clientId: 'manual:03', columnId: 'notes' });
  const sent: string[] = [];
  let server = '';

  rememberCustomCellDraft(slots, id, 'A');
  const startA = tryStartCustomCellSave(slots, id, server);
  assert.ok(startA);
  sent.push(startA!.value);
  assert.equal(startA!.value, 'A');

  rememberCustomCellDraft(slots, id, 'AB');
  rememberCustomCellDraft(slots, id, 'ABC');
  assert.equal(tryStartCustomCellSave(slots, id, server), null); // single-flight

  server = 'A';
  const done = completeCustomCellSaveSuccess(slots, startA!.key, 'A', server);
  assert.equal(done.applyAggregateRecommended, false);
  assert.ok(done.startNext);
  assert.equal(done.startNext!.value, 'ABC');
  assert.equal(done.startNext!.identity.clientId, 'manual:03');
  sent.push(done.startNext!.value);

  server = 'ABC';
  const done2 = completeCustomCellSaveSuccess(slots, done.startNext!.key, 'ABC', server);
  assert.equal(done2.applyAggregateRecommended, true);
  assert.equal(done2.startNext, null);
  assert.deepEqual(sent, ['A', 'ABC']);
  assert.equal(isCustomCellInFlight(slots, startA!.key), false);
});

test('empty draft is dirty (sparse delete) and listed for period flush', () => {
  const slots = new Map<string, CustomCellSaveSlot>();
  const id = identity({ clientId: 'manual:01' });
  rememberCustomCellDraft(slots, id, '');
  assert.deepEqual(listDirtyCustomCellKeys(slots), [customCellSaveKey(id)]);
  const start = tryStartCustomCellSave(slots, id, 'old');
  assert.ok(start);
  assert.equal(start!.value, '');
});

test('reconcileManualRowsWithDirtyDrafts overlays latest draft; ignores other period', () => {
  const slots = new Map<string, CustomCellSaveSlot>();
  const id = identity({ clientId: 'manual:01', columnId: 'client_name' });
  rememberCustomCellDraft(slots, id, 'ABC');
  const rows = [
    {
      row_key: 'manual:01',
      cells: { client_name: 'A', notes: '' },
    },
    {
      row_key: 'manual:02',
      cells: { client_name: '', notes: '' },
    },
  ];
  const reconciled = reconcileManualRowsWithDirtyDrafts({
    manualRows: rows,
    slots,
    organizationId: ORG,
    viewedPeriodKey: PERIOD_09,
  });
  assert.equal(reconciled[0]!.cells.client_name, 'ABC');
  assert.equal(reconciled[1]!.cells.client_name, '');
  const otherPeriod = reconcileManualRowsWithDirtyDrafts({
    manualRows: rows,
    slots,
    organizationId: ORG,
    viewedPeriodKey: PERIOD_10,
  });
  assert.equal(otherPeriod[0]!.cells.client_name, 'A');
});

test('resolveCustomCellEditorDraft prefers newer local over stale server', () => {
  assert.equal(
    resolveCustomCellEditorDraft({
      stillEditing: true,
      localDraft: 'ABC',
      latestDraft: 'ABC',
      serverCellValue: 'A',
    }),
    'ABC',
  );
});
