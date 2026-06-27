/**
 * Retainer schedule row — Work Engine machine awareness (read-model only).
 */

import {
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_TYPE,
} from './work-engine-invoice-retainer.pure.js';
import {
  buildScheduleRowWorkItemHref,
  type ScheduleRowWorkItemRef,
} from './work-engine-invoice-retainer-schedule-row-status.pure.js';

export type ScheduleRowMachineStateTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'muted';

export type ScheduleRowMachineDescriptor = {
  machine_state: string | null;
  machine_state_label: string | null;
  machine_state_tone: ScheduleRowMachineStateTone | null;
  machine_has_task: boolean;
  machine_task_id: string | null;
  machine_task_url: string | null;
  machine_task_title: string | null;
};

const ACTIVE_MACHINE_WORK_STATES = new Set([
  'new',
  'assigned',
  'waiting_human',
  'waiting_client',
  'client_replied',
  'review_pending',
  'overdue',
  'escalated',
]);

const WORK_STATE_LABELS_HE: Record<string, string> = {
  new: 'חדש',
  assigned: 'משויך',
  waiting_human: 'ממתין למשרד',
  waiting_client: 'ממתין ללקוח',
  client_replied: 'תגובת לקוח',
  review_pending: 'ממתין לאישור',
  approved: 'אושר',
  rejected: 'נדחה',
  overdue: 'באיחור',
  escalated: 'הסלמה',
  done: 'הושלם',
  archived: 'בארכיון',
};

const WORK_TYPE_LABELS_HE: Record<string, string> = {
  [RECURRING_WORK_TYPE]: 'בדיקת חשבונית ריטיינר',
  [RECURRING_FAILURE_WORK_TYPE]: 'כשל ביצירת מסמך ריטיינר',
};

const EMPTY_MACHINE_DESCRIPTOR: ScheduleRowMachineDescriptor = {
  machine_state: null,
  machine_state_label: null,
  machine_state_tone: null,
  machine_has_task: false,
  machine_task_id: null,
  machine_task_url: null,
  machine_task_title: null,
};

function workStateLabelHe(workState: string): string {
  return WORK_STATE_LABELS_HE[workState] ?? workState;
}

function workTypeTitleHe(workType: string): string {
  return WORK_TYPE_LABELS_HE[workType] ?? workType;
}

export function resolveScheduleRowMachineTone(workState: string): ScheduleRowMachineStateTone {
  if (workState === 'new' || workState === 'assigned') return 'primary';
  if (workState === 'approved') return 'success';
  if (
    workState === 'waiting_human' ||
    workState === 'waiting_client' ||
    workState === 'client_replied' ||
    workState === 'review_pending'
  ) {
    return 'warning';
  }
  if (workState === 'rejected' || workState === 'overdue' || workState === 'escalated') {
    return 'danger';
  }
  if (workState === 'done' || workState === 'archived') return 'muted';
  return 'neutral';
}

export function isActiveMachineWorkItem(workItem: ScheduleRowWorkItemRef | null | undefined): boolean {
  if (!workItem) return false;
  return ACTIVE_MACHINE_WORK_STATES.has(workItem.work_state);
}

export function resolveScheduleRowMachineState(params: {
  workItem: ScheduleRowWorkItemRef | null;
  waitingReviewWithGeneratedDraft?: boolean;
}): ScheduleRowMachineDescriptor {
  const workItem = params.workItem;
  if (!workItem || !isActiveMachineWorkItem(workItem)) {
    return EMPTY_MACHINE_DESCRIPTOR;
  }

  const waitingReviewDraft =
    params.waitingReviewWithGeneratedDraft === true &&
    workItem.work_type === RECURRING_WORK_TYPE;

  return {
    machine_state: workItem.work_state,
    machine_state_label: waitingReviewDraft
      ? null
      : workStateLabelHe(workItem.work_state),
    machine_state_tone: resolveScheduleRowMachineTone(workItem.work_state),
    machine_has_task: true,
    machine_task_id: workItem.work_item_id,
    machine_task_url: waitingReviewDraft
      ? null
      : buildScheduleRowWorkItemHref(workItem.work_item_id),
    machine_task_title: waitingReviewDraft
      ? 'ממתין לבדיקת משרד'
      : workTypeTitleHe(workItem.work_type),
  };
}
