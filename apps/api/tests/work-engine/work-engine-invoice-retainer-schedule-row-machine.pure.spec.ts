import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_TYPE,
} from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';
import { resolveScheduleRowMachineState } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-machine.pure.js';

test('no work item yields empty machine descriptor', () => {
  const machine = resolveScheduleRowMachineState({ workItem: null });
  assert.equal(machine.machine_has_task, false);
  assert.equal(machine.machine_state, null);
  assert.equal(machine.machine_task_url, null);
});

test('done work item is not an active machine task', () => {
  const machine = resolveScheduleRowMachineState({
    workItem: {
      work_item_id: 'wi-done',
      work_type: RECURRING_WORK_TYPE,
      work_state: 'done',
      period_key: 'retainer:profile:p1:cycle:2026-07-23',
    },
  });
  assert.equal(machine.machine_has_task, false);
  assert.equal(machine.machine_task_id, null);
});

test('open review work item with generated draft exposes review tooltip without queue url', () => {
  const machine = resolveScheduleRowMachineState({
    workItem: {
      work_item_id: 'wi-1',
      work_type: RECURRING_WORK_TYPE,
      work_state: 'waiting_human',
      period_key: 'retainer:profile:p1:cycle:2026-07-23',
    },
    waitingReviewWithGeneratedDraft: true,
  });
  assert.equal(machine.machine_has_task, true);
  assert.equal(machine.machine_state, 'waiting_human');
  assert.equal(machine.machine_state_label, null);
  assert.equal(machine.machine_state_tone, 'warning');
  assert.equal(machine.machine_task_id, 'wi-1');
  assert.equal(machine.machine_task_url, null);
  assert.equal(machine.machine_task_title, 'ממתין לבדיקת משרד');
});

test('open review work item exposes machine task fields', () => {
  const machine = resolveScheduleRowMachineState({
    workItem: {
      work_item_id: 'wi-1',
      work_type: RECURRING_WORK_TYPE,
      work_state: 'waiting_human',
      period_key: 'retainer:profile:p1:cycle:2026-07-23',
    },
  });
  assert.equal(machine.machine_has_task, true);
  assert.equal(machine.machine_state, 'waiting_human');
  assert.equal(machine.machine_state_label, 'ממתין למשרד');
  assert.equal(machine.machine_state_tone, 'warning');
  assert.equal(machine.machine_task_id, 'wi-1');
  assert.match(machine.machine_task_url ?? '', /work_item_id=wi-1/);
  assert.equal(machine.machine_task_title, 'בדיקת חשבונית ריטיינר');
});

test('generation failed work item exposes machine task fields', () => {
  const machine = resolveScheduleRowMachineState({
    workItem: {
      work_item_id: 'wi-fail',
      work_type: RECURRING_FAILURE_WORK_TYPE,
      work_state: 'new',
      period_key: 'retainer:profile:p1:cycle:2026-08-22',
    },
  });
  assert.equal(machine.machine_has_task, true);
  assert.equal(machine.machine_state_tone, 'primary');
  assert.equal(machine.machine_task_title, 'כשל ביצירת מסמך ריטיינר');
});
