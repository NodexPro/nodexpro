/**
 * Retainer schedule row lifecycle status — read-model only (no writes).
 */

import {
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_TYPE,
} from './work-engine-invoice-retainer.pure.js';

export type ScheduleRowCycleRef = {
  status: 'pending' | 'draft_created' | 'issued' | 'cancelled' | 'failed';
  generated_draft_id: string | null;
  generated_document_id: string | null;
};

export type ScheduleRowWorkItemRef = {
  work_item_id: string;
  work_type: string;
  work_state: string;
  period_key: string;
};

export type ScheduleRowStatusKey =
  | 'issued'
  | 'waiting_review'
  | 'failed'
  | 'skipped'
  | 'scheduled';

export type ScheduleRowStatusTone = 'success' | 'neutral' | 'warning' | 'danger' | 'muted';

export type ScheduleRowIconKey = 'check' | 'review' | 'alert' | 'pause' | 'calendar';

export type ScheduleRowStatusDescriptor = {
  status_key: ScheduleRowStatusKey;
  status_label: string;
  status_tone: ScheduleRowStatusTone;
  icon_key: ScheduleRowIconKey;
  icon_display: string;
  work_state_label: string | null;
  has_open_task: boolean;
  work_item_href: string | null;
};

const OPEN_WORK_ITEM_STATES = new Set([
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

export function scheduleRowIconDisplay(iconKey: ScheduleRowIconKey): string {
  if (iconKey === 'check') return '✓';
  if (iconKey === 'review') return '📝';
  if (iconKey === 'alert') return '⚠';
  if (iconKey === 'pause') return '⏸';
  return '📅';
}

export function buildScheduleRowWorkItemHref(workItemId: string): string {
  return `/work-engine/queue?work_item_id=${encodeURIComponent(workItemId)}`;
}

function workStateLabelHe(workState: string): string {
  return WORK_STATE_LABELS_HE[workState] ?? workState;
}

function isOpenWorkItem(workItem: ScheduleRowWorkItemRef | null | undefined): boolean {
  if (!workItem) return false;
  return OPEN_WORK_ITEM_STATES.has(workItem.work_state);
}

function isWaitingReviewCycle(cycle: ScheduleRowCycleRef): boolean {
  if (cycle.generated_document_id) return false;
  if (cycle.status === 'failed' || cycle.status === 'cancelled') return false;
  if (cycle.generated_draft_id) return true;
  return cycle.status === 'draft_created';
}

export function resolveScheduleRowStatus(params: {
  cycle: ScheduleRowCycleRef | null;
  workItem: ScheduleRowWorkItemRef | null;
}): ScheduleRowStatusDescriptor {
  const cycle = params.cycle;
  const workItem = params.workItem;

  if (cycle?.generated_document_id || cycle?.status === 'issued') {
    return {
      status_key: 'issued',
      status_label: 'אושר',
      status_tone: 'success',
      icon_key: 'check',
      icon_display: scheduleRowIconDisplay('check'),
      work_state_label: null,
      has_open_task: false,
      work_item_href: null,
    };
  }

  if (cycle?.status === 'cancelled') {
    return {
      status_key: 'skipped',
      status_label: 'דולג',
      status_tone: 'muted',
      icon_key: 'pause',
      icon_display: scheduleRowIconDisplay('pause'),
      work_state_label: null,
      has_open_task: false,
      work_item_href: null,
    };
  }

  if (cycle?.status === 'failed' || workItem?.work_type === RECURRING_FAILURE_WORK_TYPE) {
    const openTask = isOpenWorkItem(workItem);
    return {
      status_key: 'failed',
      status_label: 'נכשל',
      status_tone: 'danger',
      icon_key: 'alert',
      icon_display: scheduleRowIconDisplay('alert'),
      work_state_label: openTask && workItem ? workStateLabelHe(workItem.work_state) : null,
      has_open_task: openTask,
      work_item_href:
        openTask && workItem ? buildScheduleRowWorkItemHref(workItem.work_item_id) : null,
    };
  }

  if (cycle && isWaitingReviewCycle(cycle)) {
    const reviewWorkItem =
      workItem?.work_type === RECURRING_WORK_TYPE ? workItem : workItem ?? null;
    const openTask = isOpenWorkItem(reviewWorkItem);
    return {
      status_key: 'waiting_review',
      status_label: 'ממתין לבדיקה',
      status_tone: 'warning',
      icon_key: 'review',
      icon_display: scheduleRowIconDisplay('review'),
      work_state_label: openTask && reviewWorkItem ? workStateLabelHe(reviewWorkItem.work_state) : null,
      has_open_task: openTask,
      work_item_href:
        openTask && reviewWorkItem
          ? buildScheduleRowWorkItemHref(reviewWorkItem.work_item_id)
          : null,
    };
  }

  return {
    status_key: 'scheduled',
    status_label: 'מתוכנן',
    status_tone: 'neutral',
    icon_key: 'calendar',
    icon_display: scheduleRowIconDisplay('calendar'),
    work_state_label: null,
    has_open_task: false,
    work_item_href: null,
  };
}
