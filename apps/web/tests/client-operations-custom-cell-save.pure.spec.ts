import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeCustomCellSaveFailure,
  completeCustomCellSaveSuccess,
  customCellSaveKey,
  getCustomCellSlot,
  isCustomCellInFlight,
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
const PERIOD_09 = '09.26';
const PERIOD_10 = '10.26';

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

test('9-10: 09.26 dirty + navigate 10.26 — no wrong-period paint; write keeps 09.26', async () => {
  const result = await runAutosaveScenario({
    steps: [
      { type: 'type', value: 'ab' },
      { type: 'advance', ms: 500 },
      { type: 'navigate', toPeriod: PERIOD_10 },
      { type: 'completeFlight', serverValue: 'ab' },
    ],
  });
  assert.deepEqual(result.sentPeriods, ['09.26']);
  assert.deepEqual(result.appliedPeriods, []); // must not paint 09.26 into 10.26 view
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
