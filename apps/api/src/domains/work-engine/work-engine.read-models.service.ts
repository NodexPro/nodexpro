/**
 * Work Engine read models (Stage 2 foundation).
 * Source of truth: docs/work-engine-aggregates.md (future doc); for now follow the
 * "ready-to-render" rules from docs/work-engine-state-machine.md §8 and the boundary doc.
 *
 * UI consumes aggregates verbatim. UI never recomputes labels, counts, or allowed_actions.
 */

import { supabaseAdmin } from '../../db/client.js';
import { hasPermission } from '../rbac/rbac.service.js';
import type {
  AllowedAction,
  OverrideKind,
  SlaStatus,
  WorkItemRow,
  WorkState,
} from './work-engine.types.js';
import {
  OVERRIDE_KINDS,
  OVERRIDE_KINDS_REQUIRING_REASON,
  WORK_STATES,
} from './work-engine.types.js';
import {
  getAllowedTransitionsFrom,
  getReopenTargetStates,
  canPickUpFromUnassignedWorkState,
} from './work-engine.guards.js';
import {
  buildEscalationPriorStateTooltip,
  buildEscalationSourceOptions,
  canAcknowledgeEscalation,
  canEscalateWorkItem,
  canReassignEscalationOwner,
  canResolveEscalation,
  escalationSourceLabel,
  isEscalationAcknowledged,
  type EscalationPermissionContext,
} from './work-engine.escalation.logic.js';
import { loadEscalationOwnerOptions } from './work-engine.escalation.service.js';
import {
  knownEventTypes,
  MAPPING_REASON,
  PENDING_MAPPING_PROCESSING_OUTCOMES,
} from './work-engine.event-mapping.service.js';
import { batchOfficeUnreadForThreads } from '../docflow/docflow-read-models.service.js';
import {
  canStaffPickUpUnassigned,
  DEFAULT_SLA_POLICY,
  resolveWorkTypePoliciesBatch,
  type WorkTypeEnginePolicy,
  type WorkTypeWorkflowPolicy,
} from './work-engine.policy.service.js';
import {
  buildDueQueueCellText,
  buildQueueSlaPresentation,
  loadActiveSlaObligationsForItems,
} from './work-engine.sla.service.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';
import {
  buildReminderReviewBanner,
  loadReminderReviewCounts,
  loadReminderReviewPage,
  REMINDER_SNOOZE_PRESETS,
} from './work-engine.reminder-review.service.js';
import {
  canAccessReminderDraftDevTool,
  GENERATE_REMINDER_DRAFT_WORKFLOW_TYPE,
} from './work-engine.queue-dev-tools.js';

/**
 * Stage 3B: the set of `work_events.processing_outcome` values that signal a
 * pending-mapping outcome (the event was persisted but no work_item was
 * created). Includes the Stage 3A legacy umbrella string so historical rows
 * still count.
 */
const PENDING_MAPPING_OUTCOMES = PENDING_MAPPING_PROCESSING_OUTCOMES;

/** Viewer context for backend-owned queue buckets and ownership command strip. */
export type WorkEngineQueueViewerContext = {
  userId: string;
  permissions: readonly string[];
  roleCode: string;
};

/** Queue row chrome only — presentation metadata for inbox table (not command semantics). */
export type QueuePresentationGroup =
  | 'row_primary'
  | 'row_secondary'
  | 'row_overflow'
  | 'admin_overflow';

export type QueueWorkEngineCommandInteraction = 'immediate' | 'modal';

export type QueueOverflowMenuItem = {
  channel: 'ownership' | 'review' | 'semantic' | 'work_engine_command';
  command: string;
  label: string;
  enabled: boolean;
  reason: string | null;
  /** Present for `work_engine_command` — merged with row ids on the client before POST. */
  command_payload?: Record<string, unknown> | null;
  /** `modal` opens aggregate-provided form; `immediate` POSTs command as-is. */
  interaction?: QueueWorkEngineCommandInteraction;
  /** Key into `escalation_workspace.command_forms` when interaction is `modal`. */
  modal_form_key?: QueueEscalationCommandKind;
};

export type WorkEngineEscalationFormSelectField = {
  key: string;
  kind: 'select';
  label: string;
  required: boolean;
  options: Array<{ value: string; label: string }>;
};

export type WorkEngineEscalationFormTextareaField = {
  key: string;
  kind: 'textarea';
  label: string;
  required: boolean;
  placeholder?: string | null;
};

export type WorkEngineEscalationFormField =
  | WorkEngineEscalationFormSelectField
  | WorkEngineEscalationFormTextareaField;

export type WorkEngineEscalationCommandForm = {
  command: QueueEscalationCommandKind;
  title: string;
  submit_label: string;
  cancel_label: string;
  fields: WorkEngineEscalationFormField[];
};

export type WorkEngineEscalationWorkspace = {
  command_forms: Partial<Record<QueueEscalationCommandKind, WorkEngineEscalationCommandForm>>;
};

export type QueueOverflowMenuSection = {
  section_title: string | null;
  items: QueueOverflowMenuItem[];
};

export type QueueOverflowAdminBlock = {
  panel_title: string;
  submenu_trigger_label: string;
  items: QueueOverflowMenuItem[];
};

export type QueueOverflowMenuModel = {
  trigger_label: string;
  sections: QueueOverflowMenuSection[];
  admin: QueueOverflowAdminBlock | null;
};

export type QueueShellSecondaryAction = {
  channel: 'ownership' | 'review';
  command: string;
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type QueueOpenDetailAction = {
  kind: 'open_queue_item_detail';
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: 'row_primary';
};

export type QueueRowQueueShellModel = {
  open_detail: QueueOpenDetailAction;
  secondary_actions: QueueShellSecondaryAction[];
  overflow_menu: QueueOverflowMenuModel;
};

export type QueueOwnershipCommand = {
  command: 'pick_up_unassigned' | 'claim_work_item' | 'release_claim';
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

/** Stage 10 Phase 2 — review commands strip (same pattern as ownership_commands). */
export type QueueReviewCommandKind = 'request_review' | 'approve_work_item' | 'reject_work_item';

export type QueueReviewCommand = {
  command: QueueReviewCommandKind;
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

/** Stage 10 Phase 3C-1 — escalation commands (named work-engine commands). */
export type QueueEscalationCommandKind =
  | 'escalate_work_item'
  | 'acknowledge_escalation'
  | 'resolve_escalation'
  | 'reassign_escalation_owner';

export type QueueEscalationCommand = {
  command: QueueEscalationCommandKind;
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

type QueueOwnershipCommandDraft = Omit<QueueOwnershipCommand, 'presentation_group'>;
type QueueReviewCommandDraft = Omit<QueueReviewCommand, 'presentation_group'>;
type QueueEscalationCommandDraft = Omit<QueueEscalationCommand, 'presentation_group'>;

function queueRowChromeMode(row: Pick<WorkItemRow, 'work_state' | 'assigned_user_id'>): 'unassigned_pickup' | 'review_gate' | 'default' {
  const unassigned =
    row.assigned_user_id == null || String(row.assigned_user_id).trim() === '';
  if (unassigned && canPickUpFromUnassignedWorkState(row.work_state)) return 'unassigned_pickup';
  if (row.work_state === 'review_pending') return 'review_gate';
  return 'default';
}

function buildQueueRowChrome(args: {
  row: Pick<WorkItemRow, 'work_state' | 'assigned_user_id' | 'claimed_by_user_id' | 'id' | 'version'>;
  viewer: WorkEngineQueueViewerContext;
  ownershipDraft: QueueOwnershipCommandDraft[];
  reviewDraft: QueueReviewCommandDraft[];
  escalationDraft: QueueEscalationCommandDraft[];
  allowedRows: QueueAllowedAction[];
}): {
  ownership_commands: QueueOwnershipCommand[];
  review_commands: QueueReviewCommand[];
  escalation_commands: QueueEscalationCommand[];
  allowed_actions: QueueAllowedAction[];
  queue_shell: QueueRowQueueShellModel;
} {
  const { row, viewer, ownershipDraft, reviewDraft, escalationDraft, allowedRows } = args;
  const perms = [...viewer.permissions];
  const canAdmin =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.override) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.claimForce);

  const ownership: QueueOwnershipCommand[] = ownershipDraft.map((c) => ({
    ...c,
    presentation_group: 'row_overflow',
  }));
  const review: QueueReviewCommand[] = reviewDraft.map((c) => ({
    ...c,
    presentation_group: 'row_overflow',
  }));
  const escalation: QueueEscalationCommand[] = escalationDraft.map((c) => ({
    ...c,
    presentation_group: 'admin_overflow',
  }));
  const allowed: QueueAllowedAction[] = allowedRows.map((a) => ({ ...a }));

  const mode = queueRowChromeMode(row);
  const secondaries: QueueShellSecondaryAction[] = [];

  const pick = ownership.find((c) => c.command === 'pick_up_unassigned');
  const claim = ownership.find((c) => c.command === 'claim_work_item');
  const release = ownership.find((c) => c.command === 'release_claim');
  const reqRev = review.find((c) => c.command === 'request_review');
  const appr = review.find((c) => c.command === 'approve_work_item');
  const rej = review.find((c) => c.command === 'reject_work_item');

  if (mode === 'unassigned_pickup' && pick) {
    secondaries.push({
      channel: 'ownership',
      command: pick.command,
      label: pick.label,
      enabled: pick.enabled,
      reason: pick.reason,
    });
    pick.presentation_group = 'row_secondary';
  } else if (mode === 'review_gate') {
    if (appr) {
      secondaries.push({
        channel: 'review',
        command: appr.command,
        label: appr.label,
        enabled: appr.enabled,
        reason: appr.reason,
      });
      appr.presentation_group = 'row_secondary';
    }
    if (rej) {
      secondaries.push({
        channel: 'review',
        command: rej.command,
        label: rej.label,
        enabled: rej.enabled,
        reason: rej.reason,
      });
      rej.presentation_group = 'row_secondary';
    }
  } else {
    const held = row.claimed_by_user_id != null;
    if (held && release) {
      secondaries.push({
        channel: 'ownership',
        command: release.command,
        label: release.label,
        enabled: release.enabled,
        reason: release.reason,
      });
      release.presentation_group = 'row_secondary';
    } else if (claim) {
      secondaries.push({
        channel: 'ownership',
        command: claim.command,
        label: claim.label,
        enabled: claim.enabled,
        reason: claim.reason,
      });
      claim.presentation_group = 'row_secondary';
    }
  }

  const transfer = allowed.find((a) => a.command === 'transfer');
  const markWait = allowed.find((a) => a.command === 'mark_waiting_client');
  const assign = allowed.find((a) => a.command === 'assign');
  const changeState = allowed.find((a) => a.command === 'change_state');
  const setDl = allowed.find((a) => a.command === 'set_deadline');
  const applyOv = allowed.find((a) => a.command === 'apply_override');
  const arch = allowed.find((a) => a.command === 'archive');

  if (release && release.presentation_group !== 'row_secondary') {
    const isHolder = row.claimed_by_user_id === viewer.userId;
    if (row.claimed_by_user_id && !isHolder && release.enabled) {
      release.presentation_group = 'admin_overflow';
    } else {
      release.presentation_group = 'row_overflow';
    }
  }

  const mainItems: QueueOverflowMenuItem[] = [];

  const pushOwnership = (c: QueueOwnershipCommand | undefined) => {
    if (!c || c.presentation_group !== 'row_overflow') return;
    if (c.command === 'release_claim' && !row.claimed_by_user_id) return;
    mainItems.push({
      channel: 'ownership',
      command: c.command,
      label: c.label,
      enabled: c.enabled,
      reason: c.reason,
    });
  };
  const pushReview = (c: QueueReviewCommand | undefined) => {
    if (!c || c.presentation_group !== 'row_overflow') return;
    mainItems.push({
      channel: 'review',
      command: c.command,
      label: c.label,
      enabled: c.enabled,
      reason: c.reason,
    });
  };
  const pushSemantic = (a: QueueAllowedAction | undefined) => {
    if (!a || a.presentation_group !== 'row_overflow') return;
    mainItems.push({
      channel: 'semantic',
      command: a.command,
      label: a.label,
      enabled: a.enabled,
      reason: a.reason,
    });
  };

  if (mode === 'unassigned_pickup') {
    pushSemantic(assign);
    pushSemantic(setDl);
    pushSemantic(markWait);
    pushSemantic(changeState);
  } else if (mode === 'review_gate') {
    pushSemantic(setDl);
    pushSemantic(markWait);
    pushSemantic(changeState);
  } else {
    pushReview(reqRev);
    pushSemantic(transfer);
    pushSemantic(setDl);
    pushSemantic(markWait);
    pushSemantic(changeState);
  }

  const adminItems: QueueOverflowMenuItem[] = [];
  const pushAdminSemantic = (a: QueueAllowedAction | undefined) => {
    if (!a || a.presentation_group !== 'admin_overflow') return;
    adminItems.push({
      channel: 'semantic',
      command: a.command,
      label: a.label,
      enabled: a.enabled,
      reason: a.reason,
    });
  };
  pushAdminSemantic(applyOv);
  pushAdminSemantic(arch);
  if (release && release.presentation_group === 'admin_overflow') {
    adminItems.push({
      channel: 'ownership',
      command: release.command,
      label: release.label,
      enabled: release.enabled,
      reason: release.reason,
    });
  }

  const devToolAccess = canAccessReminderDraftDevTool(viewer);
  for (const esc of escalation) {
    const interaction = workEngineEscalationInteraction(esc.command);
    adminItems.push({
      channel: 'work_engine_command',
      command: esc.command,
      label: esc.label,
      enabled: esc.enabled,
      reason: esc.reason,
      interaction,
      modal_form_key: interaction === 'modal' ? esc.command : undefined,
      command_payload: {
        work_item_id: row.id,
        expected_version: row.version,
      },
    });
  }

  if (devToolAccess) {
    const archived = row.work_state === 'archived';
    adminItems.push({
      channel: 'work_engine_command',
      command: 'generate_reminder_candidate',
      label: 'Generate reminder draft',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
      command_payload: {
        work_item_id: row.id,
        expected_version: row.version,
        workflow_type: GENERATE_REMINDER_DRAFT_WORKFLOW_TYPE,
        resolve_step_from_active_policy: true,
      },
    });
  }

  const showAdmin = adminItems.length > 0;

  const queue_shell: QueueRowQueueShellModel = {
    open_detail: {
      kind: 'open_queue_item_detail',
      label: 'Open',
      enabled: true,
      reason: null,
      presentation_group: 'row_primary',
    },
    secondary_actions: secondaries,
    overflow_menu: {
      trigger_label: '⋯',
      sections: [{ section_title: null, items: mainItems }],
      admin: showAdmin
        ? {
            panel_title: 'Administrative actions',
            submenu_trigger_label: 'Administrative actions',
            items: adminItems,
          }
        : null,
    },
  };

  return {
    ownership_commands: ownership,
    review_commands: review,
    escalation_commands: escalation,
    allowed_actions: allowed,
    queue_shell,
  };
}

function computeOwnershipCommands(args: {
  row: Pick<
    WorkItemRow,
    'work_state' | 'assigned_user_id' | 'claimed_by_user_id' | 'work_type'
  >;
  viewer: WorkEngineQueueViewerContext;
  policy: WorkTypeWorkflowPolicy;
}): QueueOwnershipCommandDraft[] {
  const { row, viewer, policy } = args;
  const perms = [...viewer.permissions];
  const canPickupPerm =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.pickup) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);
  const canClaimPerm =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.claim) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);
  const canForceClaim =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.claimForce) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);

  const canPickUpPolicy = canStaffPickUpUnassigned(policy, viewer.roleCode);
  const out: QueueOwnershipCommandDraft[] = [];

  const pickOk =
    canPickUpFromUnassignedWorkState(row.work_state) &&
    row.assigned_user_id == null &&
    canPickupPerm &&
    canPickUpPolicy;
  out.push({
    command: 'pick_up_unassigned',
    label: 'Pick up',
    enabled: pickOk,
    reason: pickOk
      ? null
      : row.assigned_user_id
        ? 'Item already has an assignee'
        : !canPickUpFromUnassignedWorkState(row.work_state)
          ? 'Pick up is only allowed for new or office-waiting unassigned items'
          : !canPickupPerm
            ? 'Missing work_engine.pickup permission'
            : !canPickUpPolicy
              ? 'Disabled by work type policy for staff'
              : null,
  });

  const canClaimState = row.work_state === 'assigned';
  const isAssignee = row.assigned_user_id === viewer.userId;
  const claimOk =
    canClaimState && !row.claimed_by_user_id && isAssignee && canClaimPerm;
  out.push({
    command: 'claim_work_item',
    label: 'Start work',
    enabled: claimOk,
    reason: claimOk
      ? null
      : row.claimed_by_user_id
        ? 'An execution lock is already held'
        : !canClaimState
          ? 'Start work is only available in assigned state'
          : !isAssignee
            ? 'Only the assignee can start work on this item'
            : !canClaimPerm
              ? 'Missing work_engine.claim permission'
              : null,
  });

  const held = row.claimed_by_user_id != null;
  const isClaimHolder = row.claimed_by_user_id === viewer.userId;
  const releaseOk =
    held && ((isClaimHolder && canClaimPerm) || (!isClaimHolder && canForceClaim));
  const releaseLabel =
    held && row.claimed_by_user_id && row.claimed_by_user_id !== viewer.userId
      ? 'Force unlock'
      : 'Stop work';
  out.push({
    command: 'release_claim',
    label: releaseLabel,
    enabled: releaseOk,
    reason: releaseOk
      ? null
      : !held
        ? 'No lock is held'
        : isClaimHolder
          ? 'Missing work_engine.claim permission'
          : 'Missing work_engine.claim.force permission',
  });

  return out;
}

function reviewFlowStatusLabel(
  row: Pick<WorkItemRow, 'work_state' | 'assigned_user_id' | 'reviewer_user_id'>,
): string | null {
  if (row.work_state === 'review_pending') return 'In review';
  if (
    row.work_state === 'assigned' &&
    row.assigned_user_id &&
    row.reviewer_user_id &&
    row.reviewer_user_id !== row.assigned_user_id
  ) {
    return 'Review not started';
  }
  return null;
}

function computeReviewCommands(args: {
  row: Pick<WorkItemRow, 'work_state' | 'assigned_user_id' | 'reviewer_user_id' | 'work_type'>;
  viewer: WorkEngineQueueViewerContext;
  policy: WorkTypeWorkflowPolicy;
}): QueueReviewCommandDraft[] {
  const { row, viewer, policy } = args;
  const perms = [...viewer.permissions];
  const adminBypass = hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);

  const canRequestPerm =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.reviewRequest) || adminBypass;
  const canApprovePerm =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.reviewApprove) || adminBypass;
  const canRejectPerm =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.reviewReject) || adminBypass;
  const canBreakGlass =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.reviewBreakGlass) || adminBypass;

  const gateOff = policy.review_gate === 'none';
  const role = viewer.roleCode;
  const assigneeOkForRequest =
    role === 'admin' || role === 'owner' || row.assigned_user_id === viewer.userId;

  const reviewerSet =
    row.reviewer_user_id != null && String(row.reviewer_user_id).trim() !== '';
  const assigneeSet =
    row.assigned_user_id != null && String(row.assigned_user_id).trim() !== '';
  const noSelfReview =
    !assigneeSet || !reviewerSet || row.reviewer_user_id !== row.assigned_user_id;

  const requestOk =
    !gateOff &&
    row.work_state === 'assigned' &&
    assigneeSet &&
    reviewerSet &&
    noSelfReview &&
    canRequestPerm &&
    assigneeOkForRequest;

  const isReviewer = reviewerSet && row.reviewer_user_id === viewer.userId;
  const mayCompleteReview =
    assigneeSet &&
    row.assigned_user_id !== viewer.userId &&
    (isReviewer || canBreakGlass);

  const approveOk =
    !gateOff &&
    row.work_state === 'review_pending' &&
    canApprovePerm &&
    mayCompleteReview &&
    noSelfReview;

  const rejectOk =
    !gateOff &&
    row.work_state === 'review_pending' &&
    canRejectPerm &&
    mayCompleteReview &&
    noSelfReview;

  const out: QueueReviewCommandDraft[] = [];
  out.push({
    command: 'request_review',
    label: 'Request review',
    enabled: requestOk,
    reason: requestOk
      ? null
      : gateOff
        ? 'Review workflow is disabled for this work type'
        : row.work_state !== 'assigned'
          ? 'Request review is only available in assigned state'
          : !assigneeSet
            ? 'Work item has no assignee'
            : !reviewerSet
              ? 'Designated reviewer must be set before requesting review'
              : !noSelfReview
                ? 'Reviewer cannot match the assignee'
                : !canRequestPerm
                  ? 'Missing work_engine.review.request permission'
                  : !assigneeOkForRequest
                    ? 'Only the assignee may request review'
                    : null,
  });
  out.push({
    command: 'approve_work_item',
    label: 'Approve',
    enabled: approveOk,
    reason: approveOk
      ? null
      : gateOff
        ? 'Review workflow is disabled for this work type'
        : row.work_state !== 'review_pending'
          ? 'Approve is only available while review is pending'
          : !canApprovePerm
            ? 'Missing work_engine.review.approve permission'
            : !noSelfReview
              ? 'Reviewer cannot match the assignee'
              : !mayCompleteReview
                ? 'Only the reviewer or break-glass role may approve'
                : null,
  });
  out.push({
    command: 'reject_work_item',
    label: 'Reject',
    enabled: rejectOk,
    reason: rejectOk
      ? null
      : gateOff
        ? 'Review workflow is disabled for this work type'
        : row.work_state !== 'review_pending'
          ? 'Reject is only available while review is pending'
          : !canRejectPerm
            ? 'Missing work_engine.review.reject permission'
            : !noSelfReview
              ? 'Reviewer cannot match the assignee'
              : !mayCompleteReview
                ? 'Only the reviewer or break-glass role may reject'
                : null,
  });
  return out;
}

function workEngineEscalationInteraction(
  command: QueueEscalationCommandKind,
): QueueWorkEngineCommandInteraction {
  return command === 'acknowledge_escalation' ? 'immediate' : 'modal';
}

export function buildEscalationWorkspace(ownerOptions: Array<{ value: string; label: string }>): WorkEngineEscalationWorkspace {
  const sourceOptions = buildEscalationSourceOptions().map((o) => ({
    value: o.value,
    label: o.label,
  }));

  return {
    command_forms: {
      escalate_work_item: {
        command: 'escalate_work_item',
        title: 'Escalate work item',
        submit_label: 'Escalate',
        cancel_label: 'Cancel',
        fields: [
          {
            key: 'escalation_owner_id',
            kind: 'select',
            label: 'Escalation owner',
            required: true,
            options: ownerOptions,
          },
          {
            key: 'escalation_source',
            kind: 'select',
            label: 'Escalation source',
            required: true,
            options: sourceOptions,
          },
          {
            key: 'escalation_reason',
            kind: 'textarea',
            label: 'Escalation reason',
            required: true,
            placeholder: 'Describe why this item is escalated',
          },
        ],
      },
      reassign_escalation_owner: {
        command: 'reassign_escalation_owner',
        title: 'Reassign escalation owner',
        submit_label: 'Reassign',
        cancel_label: 'Cancel',
        fields: [
          {
            key: 'escalation_owner_id',
            kind: 'select',
            label: 'Escalation owner',
            required: true,
            options: ownerOptions,
          },
        ],
      },
      resolve_escalation: {
        command: 'resolve_escalation',
        title: 'Resolve escalation',
        submit_label: 'Resolve',
        cancel_label: 'Cancel',
        fields: [
          {
            key: 'resolution_note',
            kind: 'textarea',
            label: 'Resolution note',
            required: false,
            placeholder: 'Optional note for the audit trail',
          },
        ],
      },
    },
  };
}

function escalationPermissionContext(viewer: WorkEngineQueueViewerContext): EscalationPermissionContext {
  return {
    userId: viewer.userId,
    roleCode: viewer.roleCode,
    permissions: [...viewer.permissions],
  };
}

/** Exported for command-side validation (must match queue aggregate rows). */
export function computeEscalationCommands(args: {
  row: Pick<
    WorkItemRow,
    | 'work_state'
    | 'escalation_owner_id'
    | 'escalation_acknowledged_at'
    | 'assigned_user_id'
  >;
  viewer: WorkEngineQueueViewerContext;
}): QueueEscalationCommandDraft[] {
  const ctx = escalationPermissionContext(args.viewer);
  const perms = ctx.permissions;
  const hasOverride =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.override) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);

  const escalateOk = canEscalateWorkItem(ctx, args.row, hasOverride);
  const acknowledgeOk = canAcknowledgeEscalation(ctx, args.row);
  const resolveOk = canResolveEscalation(ctx, args.row);
  const reassignOk = canReassignEscalationOwner(ctx, args.row);

  const out: QueueEscalationCommandDraft[] = [];

  out.push({
    command: 'escalate_work_item',
    label: 'Escalate',
    enabled: escalateOk,
    reason: escalateOk
      ? null
      : args.row.work_state === 'escalated'
        ? 'Work item is already escalated'
        : args.row.work_state === 'done' || args.row.work_state === 'archived'
          ? 'Cannot escalate a terminal work item'
          : !hasOverride && !canEscalateWorkItem(ctx, args.row, false)
            ? 'Only managers or override permission may escalate'
            : 'Escalation is not available from the current state',
  });

  out.push({
    command: 'acknowledge_escalation',
    label: 'Acknowledge escalation',
    enabled: acknowledgeOk,
    reason: acknowledgeOk
      ? null
      : args.row.work_state !== 'escalated'
        ? 'Only escalated work items can be acknowledged'
        : isEscalationAcknowledged(args.row)
          ? 'Escalation is already acknowledged'
          : 'Only escalation owner or managers may acknowledge',
  });

  out.push({
    command: 'resolve_escalation',
    label: 'Resolve escalation',
    enabled: resolveOk,
    reason: resolveOk
      ? null
      : args.row.work_state !== 'escalated'
        ? 'Only escalated work items can be resolved'
        : 'Only escalation owner or managers may resolve',
  });

  out.push({
    command: 'reassign_escalation_owner',
    label: 'Reassign escalation owner',
    enabled: reassignOk,
    reason: reassignOk
      ? null
      : args.row.work_state !== 'escalated'
        ? 'Only escalated work items can be reassigned'
        : 'Only managers may reassign escalation owner',
  });

  return out;
}

function workStateLabel(state: WorkState): string {
  switch (state) {
    case 'new':
      return 'New';
    case 'assigned':
      return 'Assigned';
    case 'waiting_human':
      return 'Waiting (Office)';
    case 'waiting_client':
      return 'Waiting Client';
    case 'client_replied':
      return 'Client Replied';
    case 'review_pending':
      return 'Review Pending';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'overdue':
      return 'Overdue';
    case 'escalated':
      return 'Escalated';
    case 'done':
      return 'Done';
    case 'archived':
      return 'Archived';
    default:
      return state;
  }
}

function slaStatusLabel(s: string): string {
  switch (s) {
    case 'none':
      return 'No SLA';
    case 'on_track':
      return 'On track';
    case 'due_soon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue';
    case 'breached':
      return 'Breached';
    default:
      return s;
  }
}

function workItemAllowedActions(state: WorkState): AllowedAction[] {
  const archived = state === 'archived';
  return [
    {
      command: 'assign_work_item',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'change_work_state',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'set_work_deadline',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'apply_work_override',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    { command: 'append_work_event', enabled: true, reason: null },
  ];
}

type CountsScanRow = { work_state: string };

export async function buildWorkEngineFoundationAggregate(params: {
  orgId: string;
}): Promise<Record<string, unknown>> {
  const { orgId } = params;

  // Counts: bounded scan; Stage 2 has no rule worker, so cardinality is small.
  const countsResp = await supabaseAdmin
    .from('work_items')
    .select('work_state')
    .eq('org_id', orgId)
    .limit(5000);
  if (countsResp.error) throw countsResp.error;
  const countsRows = (countsResp.data ?? []) as CountsScanRow[];

  const counts: Record<string, number> = {};
  for (const s of WORK_STATES) counts[s] = 0;
  let totalActive = 0;
  for (const r of countsRows) {
    const st = r.work_state as WorkState;
    counts[st] = (counts[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') totalActive += 1;
  }
  const totalLoaded = countsRows.length;

  const recentResp = await supabaseAdmin
    .from('work_items')
    .select(
      'id, client_id, module_key, work_type, period_key, work_state, owner_user_id, assigned_user_id, reviewer_user_id, escalation_owner_id, due_at, sla_status, override_active, version, created_at, updated_at',
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(25);
  if (recentResp.error) throw recentResp.error;
  const recentItems = (recentResp.data ?? []) as Array<
    Pick<
      WorkItemRow,
      | 'id'
      | 'client_id'
      | 'module_key'
      | 'work_type'
      | 'period_key'
      | 'work_state'
      | 'owner_user_id'
      | 'assigned_user_id'
      | 'reviewer_user_id'
      | 'escalation_owner_id'
      | 'due_at'
      | 'sla_status'
      | 'override_active'
      | 'version'
      | 'created_at'
      | 'updated_at'
    >
  >;

  // Stage 3B: pending_mapping totals + recent rows. Backend-owned: the UI
  // never recomputes counts and never inspects work_events directly.
  const pendingCountResp = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[]);
  if (pendingCountResp.error) throw pendingCountResp.error;
  const pendingMappingCount = pendingCountResp.count ?? 0;

  const pendingRecentResp = await supabaseAdmin
    .from('work_events')
    .select(
      'id, event_id, event_type, source_module, source_entity_type, source_entity_id, client_id, period_key, processing_outcome, received_at, occurred_at',
    )
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[])
    .order('received_at', { ascending: false })
    .limit(25);
  if (pendingRecentResp.error) throw pendingRecentResp.error;
  type PendingRow = {
    id: string;
    event_id: string;
    event_type: string;
    source_module: string;
    source_entity_type: string;
    source_entity_id: string;
    client_id: string | null;
    period_key: string | null;
    processing_outcome: string;
    received_at: string;
    occurred_at: string;
  };
  const pendingRecentRows = (pendingRecentResp.data ?? []) as PendingRow[];

  return {
    aggregate_key: 'work_engine_foundation_aggregate',
    org_id: orgId,
    generated_at: new Date().toISOString(),
    counts: {
      by_state: counts,
      total_active: totalActive,
      total_loaded: totalLoaded,
      pending_mapping: pendingMappingCount,
    },
    pending_mapping_count: pendingMappingCount,
    recent_items: recentItems.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      module_key: r.module_key,
      work_type: r.work_type,
      period_key: r.period_key,
      work_state: r.work_state,
      work_state_label: workStateLabel(r.work_state),
      sla_status: r.sla_status,
      sla_status_label: slaStatusLabel(r.sla_status),
      due_at: r.due_at,
      owner_user_id: r.owner_user_id,
      assigned_user_id: r.assigned_user_id,
      reviewer_user_id: r.reviewer_user_id,
      escalation_owner_id: r.escalation_owner_id,
      override_active: r.override_active,
      version: r.version,
      created_at: r.created_at,
      updated_at: r.updated_at,
      allowed_actions: workItemAllowedActions(r.work_state),
    })),
    recent_pending_mappings: pendingRecentRows.map((p) => ({
      id: p.id,
      event_id: p.event_id,
      event_type: p.event_type,
      source_module: p.source_module,
      source_entity_type: p.source_entity_type,
      source_entity_id: p.source_entity_id,
      client_id: p.client_id,
      period_key: p.period_key,
      pending_reason: p.processing_outcome,
      pending_reason_label: pendingReasonLabel(p.processing_outcome),
      received_at: p.received_at,
      occurred_at: p.occurred_at,
    })),
    backend_owned_state_catalog: WORK_STATES.map((s) => ({
      value: s,
      label: workStateLabel(s),
      terminal: s === 'done' || s === 'archived',
    })),
    backend_owned_event_mapping_catalog: {
      // Static allowlist surfaced to the UI for read-only rendering (e.g.
      // "known event types"). UI must not extend or override this list.
      known_event_types: knownEventTypes(),
      pending_reasons: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },
  };
}

function pendingReasonLabel(reason: string): string {
  switch (reason) {
    case MAPPING_REASON.UNKNOWN_EVENT_MAPPING:
      return 'Unknown event type';
    case MAPPING_REASON.MISSING_PERIOD_KEY:
      return 'Missing period_key';
    case 'accepted_pending_mapping':
      return 'Pending mapping (legacy)';
    default:
      return reason;
  }
}

// ============================================================================
// Stage 11A — accountant workspace tabs (aggregate-owned shell)
// ============================================================================

export type WorkspaceTabBadgeVariant = 'neutral' | 'warning' | 'urgent' | null;

export type AccountantWorkspaceTabModel = {
  key: string;
  label: string;
  subtitle: string;
  icon_key: string;
  route: string;
  active: boolean;
  badge_count: number | null;
  badge_variant: WorkspaceTabBadgeVariant;
  enabled: boolean;
  disabled_reason: string | null;
};

/** Routes that exist in the web app today (Stage 11A — backend registry only). */
const ACCOUNTANT_WORKSPACE_REGISTERED_ROUTES = new Set<string>([
  '/work-engine/queue',
  '/m/client-operations',
  '/documents',
]);

type WorkspaceTabSeed = {
  key: string;
  label: string;
  subtitle: string;
  icon_key: string;
  route: string;
  badge_count?: number | null;
  badge_variant?: WorkspaceTabBadgeVariant;
};

const ACCOUNTANT_WORKSPACE_TAB_SEEDS: WorkspaceTabSeed[] = [
  {
    key: 'work_engine',
    label: 'Work Engine',
    subtitle: 'Command Center',
    icon_key: 'work_engine',
    route: '/work-engine/queue',
    badge_count: null,
    badge_variant: null,
  },
  {
    key: 'clients',
    label: 'Clients',
    subtitle: 'Client Operations',
    icon_key: 'clients',
    route: '/m/client-operations',
    badge_count: null,
    badge_variant: null,
  },
  {
    key: 'invoices',
    label: 'Invoices',
    subtitle: 'Sales & Billing',
    icon_key: 'invoices',
    route: '/m/invoices',
    badge_count: 0,
    badge_variant: 'neutral',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    subtitle: 'Salary & Benefits',
    icon_key: 'payroll',
    route: '/m/payroll',
    badge_count: 0,
    badge_variant: 'neutral',
  },
  {
    key: 'vat',
    label: 'VAT',
    subtitle: 'Tax Reporting',
    icon_key: 'vat',
    route: '/m/vat',
    badge_count: 0,
    badge_variant: 'neutral',
  },
  {
    key: 'documents',
    label: 'Documents',
    subtitle: 'Files & Requests',
    icon_key: 'documents',
    route: '/documents',
    badge_count: null,
    badge_variant: null,
  },
  {
    key: 'bank',
    label: 'Bank',
    subtitle: 'Reconciliation',
    icon_key: 'bank',
    route: '/m/bank',
    badge_count: 0,
    badge_variant: 'neutral',
  },
  {
    key: 'reports',
    label: 'Reports',
    subtitle: 'Analytics',
    icon_key: 'reports',
    route: '/m/reports',
    badge_count: 0,
    badge_variant: 'neutral',
  },
];

function buildAccountantWorkspaceTabs(activeKey: string): AccountantWorkspaceTabModel[] {
  return ACCOUNTANT_WORKSPACE_TAB_SEEDS.map((seed) => {
    const routeRegistered = ACCOUNTANT_WORKSPACE_REGISTERED_ROUTES.has(seed.route);
    const enabled = routeRegistered;
    return {
      key: seed.key,
      label: seed.label,
      subtitle: seed.subtitle,
      icon_key: seed.icon_key,
      route: seed.route,
      active: seed.key === activeKey,
      badge_count: seed.badge_count ?? null,
      badge_variant: seed.badge_variant ?? null,
      enabled,
      disabled_reason: enabled ? null : 'Coming soon',
    };
  });
}

// ============================================================================
// Stage 3D — work_engine_queue_aggregate
// ============================================================================

const QUEUE_DEFAULT_LIMIT = 50;
const QUEUE_MAX_LIMIT = 200;

export type WorkEngineQueueFilters = {
  state?: string | null;
  module_key?: string | null;
  assigned_user_id?: string | null;
  reviewer_user_id?: string | null;
  client_id?: string | null;
  period_key?: string | null;
  /** Backend-owned bucket: assigned_to_me | unassigned | claimed_by_me | review_for_me | reminder_review */
  queue_bucket?: string | null;
  limit?: number | null;
  offset?: number | null;
};

/**
 * Coerce `payload.aggregate_filters` (or any nested object) into
 * `WorkEngineQueueFilters` for Stage 3E command responses.
 */
export function coerceWorkEngineQueueFilters(v: unknown): WorkEngineQueueFilters {
  const o =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const str = (k: string): string | null => {
    const x = o[k];
    return typeof x === 'string' ? x : null;
  };
  const num = (k: string): number | null => {
    const x = o[k];
    if (x === undefined || x === null) return null;
    const n = typeof x === 'number' ? x : Number(String(x).trim());
    return Number.isFinite(n) ? n : null;
  };
  return {
    state: str('state'),
    module_key: str('module_key'),
    assigned_user_id: str('assigned_user_id'),
    reviewer_user_id: str('reviewer_user_id'),
    client_id: str('client_id'),
    period_key: str('period_key'),
    queue_bucket: str('queue_bucket'),
    limit: num('limit'),
    offset: num('offset'),
  };
}

/**
 * Humanize a snake_case / kebab-case key into a Title Case label. Used as the
 * fallback when no explicit label is known. Backend-owned; UI never humanizes.
 */
function humanizeKey(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function moduleLabel(key: string): string {
  switch (key) {
    case 'payroll':
      return 'Payroll';
    case 'vat':
      return 'VAT';
    case 'annual_report':
      return 'Annual Report';
    case 'income_tax':
      return 'Income Tax';
    case 'national_insurance':
      return 'National Insurance';
    case 'client_obligations':
      return 'Client Obligations';
    case 'docflow':
      return 'DocFlow';
    case 'work_engine':
      return 'Work Engine';
    default:
      return humanizeKey(key);
  }
}

function workTypeLabel(key: string): string {
  switch (key) {
    case 'payroll_document_collection':
      return 'Payroll Documents';
    case 'vat_document_collection':
      return 'VAT Documents';
    case 'annual_report_document_collection':
      return 'Annual Report Documents';
    case 'docflow_thread_followup':
      return 'Conversation';
    default:
      return humanizeKey(key);
  }
}

/**
 * Queue-level allowed_actions. These are SEMANTIC actions a UI can offer
 * (assign / change_state / set_deadline / apply_override / archive) and are
 * NOT the same vocabulary as low-level command names (`assign_work_item`
 * etc.). The mapping action → command lives in the routes/commands layer.
 *
 * `done` is a terminal state for normal transitions; the only path out is
 * `archive` (or `apply_override` for reopen). `archived` is fully terminal.
 */
export type QueueAllowedActionCommand =
  | 'assign'
  | 'transfer'
  | 'mark_waiting_client'
  | 'change_state'
  | 'set_deadline'
  | 'apply_override'
  | 'archive';

export type QueueAllowedAction = {
  command: QueueAllowedActionCommand;
  /** Ready-to-render button / menu label (backend-owned). */
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

/**
 * Backend-owned per-row state catalog. Stage 4 architecture fix: the queue UI
 * must not select target transitions from the global state catalog — it must
 * consume this row-scoped list. The values are projected directly from the
 * `change_work_state` state-machine matrix in `work-engine.guards.ts` so this
 * is provably the same truth the command enforces on POST.
 */
export type QueueRowAllowedTransition = {
  value: WorkState;
  label: string;
  terminal: boolean;
};

function rowAllowedTransitions(currentState: WorkState): QueueRowAllowedTransition[] {
  return getAllowedTransitionsFrom(currentState).map((value) => ({
    value,
    label: workStateLabel(value),
    terminal: value === 'done' || value === 'archived',
  }));
}

/**
 * Backend-owned per-row override-kind catalog. Only the kinds that
 * `apply_work_override` will accept for the row's current state appear here.
 * The frontend must not enumerate `OVERRIDE_KINDS` — it consumes this list.
 *
 *   - `reopen`              → only when current_state === 'done'.
 *     Includes `requires_to_state=true` + `allowed_to_states` projected from
 *     `REOPEN_TARGET_STATES` so the UI never invents reopen targets.
 *   - `archive_non_done`    → only when current_state is neither 'done' nor 'archived'.
 *   - `state`               → only when at least one normal transition exists
 *     (otherwise `apply_work_override` with kind='state' has no legal target).
 *   - `deadline`, `escalation_cancel`, `reminder_cancel` → any non-archived state.
 *   - `assignment` is intentionally excluded (use assign / transfer / pickup commands).
 *
 * Any change to the underlying override rules must be made here in tandem with
 * the matching guard logic in `work-engine.commands.service.ts`.
 */
export type QueueRowAllowedOverrideKind = {
  value: OverrideKind;
  label: string;
  requires_reason: boolean;
  requires_to_state: boolean;
  allowed_to_states?: QueueRowAllowedTransition[];
};

function overrideKindLabel(kind: OverrideKind): string {
  switch (kind) {
    case 'deadline':
      return 'Deadline';
    case 'assignment':
      return 'Assignment';
    case 'state':
      return 'State';
    case 'escalation_cancel':
      return 'Cancel escalation';
    case 'reminder_cancel':
      return 'Cancel reminder';
    case 'reopen':
      return 'Reopen';
    case 'archive_non_done':
      return 'Archive non-done';
    default:
      return humanizeKey(kind);
  }
}

function rowAllowedOverrideKinds(currentState: WorkState): QueueRowAllowedOverrideKind[] {
  const archived = currentState === 'archived';
  const done = currentState === 'done';
  const transitions = rowAllowedTransitions(currentState);
  const out: QueueRowAllowedOverrideKind[] = [];
  for (const kind of OVERRIDE_KINDS) {
    if (archived) continue; // no override is valid on archived rows
    const requiresReason = OVERRIDE_KINDS_REQUIRING_REASON.has(kind);
    if (kind === 'reopen') {
      if (!done) continue;
      out.push({
        value: kind,
        label: overrideKindLabel(kind),
        requires_reason: requiresReason,
        requires_to_state: true,
        allowed_to_states: getReopenTargetStates().map((value) => ({
          value,
          label: workStateLabel(value),
          terminal: value === 'done' || value === 'archived',
        })),
      });
      continue;
    }
    if (kind === 'archive_non_done') {
      if (done) continue; // already terminal; use change_state → archived instead
      out.push({
        value: kind,
        label: overrideKindLabel(kind),
        requires_reason: requiresReason,
        requires_to_state: false,
      });
      continue;
    }
    if (kind === 'state') {
      if (done) continue; // reopen handles done → active
      if (transitions.length === 0) continue;
      out.push({
        value: kind,
        label: overrideKindLabel(kind),
        requires_reason: requiresReason,
        requires_to_state: true,
        allowed_to_states: transitions,
      });
      continue;
    }
    if (kind === 'assignment') continue;
    if (kind === 'escalation_cancel') continue;
    if (done) continue; // deadline/reminder_cancel not meaningful on done
    out.push({
      value: kind,
      label: overrideKindLabel(kind),
      requires_reason: requiresReason,
      requires_to_state: false,
    });
  }
  return out;
}

/** Row fields required so "Assign" is only offered when there is no assignee (first assign). */
export type QueueActionRowContext = Pick<WorkItemRow, 'work_state' | 'assigned_user_id'>;

/** Exported for Stage 3E command-side validation (must match queue aggregate rows). */
export function queueAllowedActions(row: QueueActionRowContext): QueueAllowedAction[] {
  const state = row.work_state;
  const unassigned =
    row.assigned_user_id == null || String(row.assigned_user_id).trim() === '';
  const archived = state === 'archived';
  const done = state === 'done';
  const transitions = getAllowedTransitionsFrom(state as WorkState);
  const canMarkWaiting = !archived && transitions.includes('waiting_client');
  const transferBlockedStates: ReadonlySet<string> = new Set([
    'new',
    'review_pending',
    'done',
    'archived',
  ]);
  const transferEnabled =
    !archived && !unassigned && !transferBlockedStates.has(state);

  return [
    {
      command: 'assign',
      label: 'Assign',
      enabled: !archived && !done && state !== 'review_pending' && unassigned,
      presentation_group: 'row_overflow',
      reason: archived
        ? 'Work item is archived'
        : done
          ? 'Work item is done'
          : state === 'review_pending'
            ? 'Reassignment is blocked while in review'
            : !unassigned
              ? 'Use Reassign to change assignee'
              : null,
    },
    {
      command: 'transfer',
      label: 'Reassign',
      enabled: transferEnabled,
      presentation_group: 'row_overflow',
      reason: archived
        ? 'Work item is archived'
        : unassigned
          ? 'Assign first — Reassign is for items that already have an assignee'
          : transferBlockedStates.has(state)
            ? 'Reassign is not available in this state'
            : null,
    },
    {
      command: 'mark_waiting_client',
      label: 'Mark waiting for client',
      enabled: canMarkWaiting,
      presentation_group: 'row_overflow',
      reason: archived
        ? 'Work item is archived'
        : !canMarkWaiting
          ? 'This transition is not available from the current state'
          : null,
    },
    {
      command: 'change_state',
      label: 'Update status',
      enabled: !archived,
      presentation_group: 'row_overflow',
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'set_deadline',
      label: 'Set deadline',
      enabled: !archived && !done,
      presentation_group: 'row_overflow',
      reason: archived
        ? 'Work item is archived'
        : done
          ? 'Work item is done'
          : null,
    },
    {
      command: 'apply_override',
      label: 'Override',
      enabled: !archived,
      presentation_group: 'admin_overflow',
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'archive',
      label: 'Archive',
      enabled: done,
      presentation_group: 'admin_overflow',
      reason: done
        ? null
        : archived
          ? 'Work item is already archived'
          : 'Archive is available when the item is done',
    },
  ];
}

function overrideSummary(row: {
  override_active: boolean;
  override_summary_json: Record<string, unknown> | null;
}): string | null {
  if (!row.override_active) return null;
  const j = row.override_summary_json;
  if (j && typeof j === 'object') {
    const s = (j as { summary?: unknown }).summary;
    if (typeof s === 'string' && s.trim()) return s;
    const kind = (j as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind.trim()) return `Override: ${kind}`;
  }
  return 'Override active';
}

function isDocflowConversationQueueItem(r: {
  module_key: string | null;
  work_type: string;
  source_entity_type: string;
}): boolean {
  return (
    r.module_key === 'docflow' &&
    r.work_type === 'docflow_thread_followup' &&
    r.source_entity_type === 'client_message_thread'
  );
}

function formatQueueUtcTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** Compact Lock column cell (table); full holder/time lives in tooltip / detail. */
function buildClaimedQueueCell(claimedByUserId: string | null): string | null {
  if (!claimedByUserId) return null;
  return '✓';
}

function buildClaimedQueueCellTitle(
  claimedByUserId: string | null,
  claimedByUserName: string | null,
  claimedAt: string | null,
): string | null {
  if (!claimedByUserId) return null;
  const who = claimedByUserName ?? claimedByUserId;
  if (!claimedAt) return who;
  const ts = formatQueueUtcTimestamp(claimedAt);
  return ts ? `${who} · ${ts}` : who;
}

type QueueCellKey =
  | 'client'
  | 'module'
  | 'work_type'
  | 'state'
  | 'assignee'
  | 'last_activity'
  | 'unread'
  | 'period_key'
  | 'reviewer'
  | 'review_status'
  | 'due'
  | 'claimed';

export type QueueTableColumnModel = {
  key: string;
  label: string;
  empty_display: 'dash' | 'blank';
  kind: 'data' | 'actions';
  /** Backend layout intent (% of table width); UI applies verbatim. */
  width_percent?: number;
};

export type QueueDetailSection =
  | {
      kind: 'kv_block';
      title: string;
      rows: Array<{ label: string; value: string | null }>;
    }
  | { kind: 'static_paragraph'; title: string; body: string }
  | { kind: 'open_path'; label: string; path: string };

export type QueueRowDetailPanel = {
  title: string;
  subtitle: string | null;
  sections: QueueDetailSection[];
};

/** Legacy keys must never appear in queue_table.columns or queue_cells. */
const QUEUE_TABLE_EXCLUDED_COLUMN_KEYS = new Set<string>(['due_at', 'sla']);

const QUEUE_TABLE_CELL_KEYS: readonly QueueCellKey[] = [
  'client',
  'module',
  'work_type',
  'state',
  'assignee',
  'last_activity',
  'unread',
  'due',
  'claimed',
  'period_key',
  'reviewer',
  'review_status',
];

const BASE_QUEUE_COLUMN_KEYS: QueueCellKey[] = [
  'client',
  'module',
  'work_type',
  'state',
  'assignee',
  'last_activity',
  'unread',
  'due',
  'claimed',
];

const OPTIONAL_QUEUE_COLUMN_KEYS: QueueCellKey[] = ['period_key', 'reviewer', 'review_status'];

function sanitizeQueueCells(cells: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of QUEUE_TABLE_CELL_KEYS) {
    out[key] = cells[key] ?? null;
  }
  return out;
}

const QUEUE_COLUMN_DEFS: Record<
  QueueCellKey,
  { label: string; empty_display: 'dash' | 'blank' }
> = {
  client: { label: 'Client', empty_display: 'dash' },
  module: { label: 'Module', empty_display: 'dash' },
  work_type: { label: 'Work type', empty_display: 'dash' },
  state: { label: 'State', empty_display: 'dash' },
  assignee: { label: 'Assignee', empty_display: 'dash' },
  last_activity: { label: 'Last activity', empty_display: 'dash' },
  unread: { label: 'Unread', empty_display: 'dash' },
  due: { label: 'Due', empty_display: 'dash' },
  period_key: { label: 'Period', empty_display: 'dash' },
  reviewer: { label: 'Reviewer', empty_display: 'dash' },
  review_status: { label: 'Review', empty_display: 'dash' },
  claimed: { label: 'Lock', empty_display: 'dash' },
};

/** Queue column width intent (client ~20% narrower than legacy 12% baseline). */
const QUEUE_COLUMN_WIDTH_PERCENT: Partial<Record<string, number>> = {
  client: 9.6,
  module: 8,
  work_type: 8,
  state: 7.5,
  assignee: 8,
  last_activity: 9,
  unread: 4,
  period_key: 5,
  reviewer: 7,
  review_status: 6,
};

function queueColumnModel(
  key: string,
  def: { label: string; empty_display: 'dash' | 'blank' },
  kind: 'data' | 'actions',
): QueueTableColumnModel {
  const width = QUEUE_COLUMN_WIDTH_PERCENT[key];
  return {
    key,
    label: def.label,
    empty_display: def.empty_display,
    kind,
    ...(width != null ? { width_percent: width } : {}),
  };
}

function queueColumnHasAnyValue(
  rows: Array<{ queue_cells: Record<string, string | null> }>,
  key: string,
): boolean {
  return rows.some((r) => {
    const v = r.queue_cells[key];
    return v != null && String(v).trim() !== '';
  });
}

function computeQueueTableModel(
  rows: Array<{ queue_cells: Record<string, string | null> }>,
): { columns: QueueTableColumnModel[] } {
  const columns: QueueTableColumnModel[] = [];
  for (const key of BASE_QUEUE_COLUMN_KEYS) {
    if (QUEUE_TABLE_EXCLUDED_COLUMN_KEYS.has(key)) continue;
    const def = QUEUE_COLUMN_DEFS[key];
    columns.push(queueColumnModel(key, def, 'data'));
  }
  for (const key of OPTIONAL_QUEUE_COLUMN_KEYS) {
    if (QUEUE_TABLE_EXCLUDED_COLUMN_KEYS.has(key)) continue;
    if (queueColumnHasAnyValue(rows, key)) {
      const def = QUEUE_COLUMN_DEFS[key];
      columns.push(queueColumnModel(key, def, 'data'));
    }
  }
  columns.push(
    queueColumnModel('actions', { label: 'Actions', empty_display: 'blank' }, 'actions'),
  );
  return {
    columns: columns.filter((c) => !QUEUE_TABLE_EXCLUDED_COLUMN_KEYS.has(c.key)),
  };
}

function buildCommandModalSubjectLine(params: {
  work_type_label: string;
  module_label: string;
  period_key: string;
  version: number;
  hide_period_in_subject: boolean;
}): string {
  const parts = [params.work_type_label, params.module_label];
  if (!params.hide_period_in_subject) parts.push(`period ${params.period_key}`);
  parts.push(`v${params.version}`);
  return parts.join(' · ');
}

function buildQueueRowDetailPanel(params: {
  client_name: string | null;
  client_id: string | null;
  module_label: string;
  work_type_label: string;
  work_state_label: string;
  review_flow_status_label: string | null;
  assigned_user_name: string | null;
  reviewer_user_name: string | null;
  claimed_by_user_name: string | null;
  claimed_at: string | null;
  due_at: string | null;
  sla_status_label: string;
  primary_due_at_label: string | null;
  override_summary: string | null;
  period_key: string;
  hide_period_in_subject: boolean;
  docflow_messenger_path: string | null;
}): QueueRowDetailPanel {
  const title =
    params.client_name?.trim() ||
    (params.client_id ? `Client ${params.client_id}` : 'Work item');
  const subtitle = `${params.work_type_label} · ${params.module_label}`;

  const kvRows: Array<{ label: string; value: string | null }> = [
    { label: 'State', value: params.work_state_label },
    { label: 'Review status', value: params.review_flow_status_label },
    { label: 'Assignee', value: params.assigned_user_name },
    { label: 'Reviewer', value: params.reviewer_user_name },
    {
      label: 'Lock',
      value:
        params.claimed_by_user_name && params.claimed_at
          ? `${params.claimed_by_user_name} · ${formatQueueUtcTimestamp(params.claimed_at)}`
          : null,
    },
    {
      label: 'SLA due',
      value: params.primary_due_at_label ?? (params.due_at ? formatQueueUtcTimestamp(params.due_at) : null),
    },
    { label: 'Due status', value: params.sla_status_label },
  ];
  if (!params.hide_period_in_subject) {
    kvRows.splice(1, 0, { label: 'Period', value: params.period_key });
  }
  if (params.override_summary) {
    kvRows.push({ label: 'Override', value: params.override_summary });
  }

  const sections: QueueDetailSection[] = [
    { kind: 'kv_block', title: 'Summary', rows: kvRows },
  ];
  if (params.docflow_messenger_path) {
    sections.push({
      kind: 'open_path',
      label: 'Open conversation in messenger',
      path: params.docflow_messenger_path,
    });
  }
  sections.push({
    kind: 'static_paragraph',
    title: 'Audit trail',
    body:
      'Work history and command audit for this item are not shown in this preview yet. ' +
      'All writes continue to be validated and recorded on the server.',
  });
  sections.push({
    kind: 'static_paragraph',
    title: 'Related DocFlow conversation',
    body: params.docflow_messenger_path
      ? 'Use the link above to open the live thread in the office messenger. Messaging truth remains in DocFlow.'
      : 'No linked DocFlow conversation is projected for this work item.',
  });

  return { title, subtitle, sections };
}

/** Parse queue filter input (HTTP query or command `aggregate_filters`). */
export function parseWorkEngineQueueFilters(raw: WorkEngineQueueFilters): {
  state: WorkState | null;
  module_key: string | null;
  assigned_user_id: string | null;
  reviewer_user_id: string | null;
  client_id: string | null;
  period_key: string | null;
  queue_bucket: 'assigned_to_me' | 'unassigned' | 'claimed_by_me' | 'review_for_me' | null;
  limit: number;
  offset: number;
} {
  const stateRaw = raw.state ? String(raw.state).trim() : '';
  const state =
    stateRaw && (WORK_STATES as readonly string[]).includes(stateRaw)
      ? (stateRaw as WorkState)
      : null;

  const moduleKey = raw.module_key ? String(raw.module_key).trim() : '';
  const assignedUserId = raw.assigned_user_id
    ? String(raw.assigned_user_id).trim()
    : '';
  const reviewerUserId = raw.reviewer_user_id
    ? String(raw.reviewer_user_id).trim()
    : '';
  const clientId = raw.client_id ? String(raw.client_id).trim() : '';
  const periodKey = raw.period_key ? String(raw.period_key).trim() : '';
  const bucketRaw = raw.queue_bucket ? String(raw.queue_bucket).trim() : '';
  const queue_bucket =
    bucketRaw === 'assigned_to_me' ||
    bucketRaw === 'unassigned' ||
    bucketRaw === 'claimed_by_me' ||
    bucketRaw === 'review_for_me'
      ? bucketRaw
      : null;

  let limit = Number(raw.limit ?? QUEUE_DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = QUEUE_DEFAULT_LIMIT;
  if (limit > QUEUE_MAX_LIMIT) limit = QUEUE_MAX_LIMIT;
  limit = Math.floor(limit);

  let offset = Number(raw.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  return {
    state,
    module_key: moduleKey || null,
    assigned_user_id: assignedUserId || null,
    reviewer_user_id: reviewerUserId || null,
    client_id: clientId || null,
    period_key: periodKey || null,
    queue_bucket,
    limit,
    offset,
  };
}

type QueueWorkItemRow = Pick<
  WorkItemRow,
  | 'id'
  | 'client_id'
  | 'module_key'
  | 'work_type'
  | 'period_key'
  | 'work_state'
  | 'assigned_user_id'
  | 'reviewer_user_id'
  | 'escalation_owner_id'
  | 'escalation_reason'
  | 'escalation_source'
  | 'escalation_prior_work_state'
  | 'escalation_acknowledged_at'
  | 'escalation_acknowledged_by_user_id'
  | 'claimed_by_user_id'
  | 'claimed_at'
  | 'due_at'
  | 'sla_status'
  | 'override_active'
  | 'override_summary_json'
  | 'version'
  | 'updated_at'
  | 'source_module'
  | 'source_entity_type'
  | 'source_entity_id'
>;

/**
 * Build the Stage 3D queue aggregate.
 *
 * Returns ready-to-render rows, summary cards, filter options (with labels),
 * pagination info, allowed_actions per row, and the pending-mapping section.
 * The UI consumes this verbatim. No re-derivation in the frontend.
 */
const REMINDER_REVIEW_QUEUE_TABLE: { columns: QueueTableColumnModel[] } = {
  columns: [
    { key: 'client', label: 'Client', empty_display: 'dash', kind: 'data' },
    { key: 'workflow', label: 'Workflow', empty_display: 'dash', kind: 'data' },
    { key: 'period', label: 'Period', empty_display: 'dash', kind: 'data' },
    { key: 'channel', label: 'Channel', empty_display: 'dash', kind: 'data' },
    { key: 'status', label: 'Status', empty_display: 'dash', kind: 'data' },
    { key: 'actions', label: 'Actions', empty_display: 'blank', kind: 'actions' },
  ],
};

export async function buildWorkEngineQueueAggregate(params: {
  orgId: string;
  filters?: WorkEngineQueueFilters;
  viewer?: WorkEngineQueueViewerContext | null;
}): Promise<Record<string, unknown>> {
  const { orgId, viewer } = params;
  const f = parseWorkEngineQueueFilters(params.filters ?? {});
  const viewerId = viewer?.userId ?? null;

  const reminderReviewSummary = await loadReminderReviewCounts(orgId);
  const reminderBanner = buildReminderReviewBanner(reminderReviewSummary);

  // ---- 1. Counts for summary cards (bounded scan).
  const countsResp = await supabaseAdmin
    .from('work_items')
    .select('work_state')
    .eq('org_id', orgId)
    .limit(5000);
  if (countsResp.error) throw countsResp.error;
  const countsRows = (countsResp.data ?? []) as Array<{ work_state: string }>;
  const counts: Record<string, number> = {};
  for (const s of WORK_STATES) counts[s] = 0;
  let totalActive = 0;
  for (const r of countsRows) {
    const st = r.work_state as WorkState;
    counts[st] = (counts[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') totalActive += 1;
  }

  // Pending-mapping counts (work_events with no work_item_id).
  const pendingCountResp = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[]);
  if (pendingCountResp.error) throw pendingCountResp.error;
  const pendingMappingCount = pendingCountResp.count ?? 0;

  let bucketAssignedToMe = 0;
  let bucketUnassigned = 0;
  let bucketClaimedByMe = 0;
  let bucketReviewForMe = 0;
  if (viewerId) {
    const a = await supabaseAdmin
      .from('work_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('assigned_user_id', viewerId)
      .not('work_state', 'eq', 'done')
      .not('work_state', 'eq', 'archived');
    const u = await supabaseAdmin
      .from('work_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('assigned_user_id', null)
      .not('work_state', 'eq', 'done')
      .not('work_state', 'eq', 'archived');
    const c = await supabaseAdmin
      .from('work_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('claimed_by_user_id', viewerId);
    const rfm = await supabaseAdmin
      .from('work_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('work_state', 'review_pending')
      .eq('reviewer_user_id', viewerId);
    if (a.error) throw a.error;
    if (u.error) throw u.error;
    if (c.error) throw c.error;
    if (rfm.error) throw rfm.error;
    bucketAssignedToMe = a.count ?? 0;
    bucketUnassigned = u.count ?? 0;
    bucketClaimedByMe = c.count ?? 0;
    bucketReviewForMe = rfm.count ?? 0;
  }

  // ---- 2. Filter option catalogs (backend-owned).
  // Distinct values for module / assignee / reviewer / period_key come from
  // the work_items table for this org — they reflect actual data so the UI
  // never invents filter options.
  const distinctResp = await supabaseAdmin
    .from('work_items')
    .select('module_key, assigned_user_id, reviewer_user_id, period_key')
    .eq('org_id', orgId)
    .limit(5000);
  if (distinctResp.error) throw distinctResp.error;
  const distinctRows = (distinctResp.data ?? []) as Array<{
    module_key: string | null;
    assigned_user_id: string | null;
    reviewer_user_id: string | null;
    period_key: string | null;
  }>;
  const distinctModules = new Set<string>();
  const distinctAssignees = new Set<string>();
  const distinctReviewers = new Set<string>();
  const distinctPeriods = new Set<string>();
  for (const r of distinctRows) {
    if (r.module_key) distinctModules.add(r.module_key);
    if (r.assigned_user_id) distinctAssignees.add(r.assigned_user_id);
    if (r.reviewer_user_id) distinctReviewers.add(r.reviewer_user_id);
    if (r.period_key) distinctPeriods.add(r.period_key);
  }

  // ---- 3. Page query: apply filters, order by updated_at desc, paginate.
  let q = supabaseAdmin
    .from('work_items')
    .select(
      'id, client_id, module_key, work_type, period_key, work_state, assigned_user_id, reviewer_user_id, escalation_owner_id, escalation_reason, escalation_source, escalation_prior_work_state, escalation_acknowledged_at, escalation_acknowledged_by_user_id, claimed_by_user_id, claimed_at, due_at, sla_status, override_active, override_summary_json, version, updated_at, source_module, source_entity_type, source_entity_id',
      { count: 'exact' },
    )
    .eq('org_id', orgId);
  if (f.queue_bucket === 'assigned_to_me' && viewerId) {
    q = q
      .eq('assigned_user_id', viewerId)
      .not('work_state', 'eq', 'done')
      .not('work_state', 'eq', 'archived');
  } else if (f.queue_bucket === 'unassigned') {
    q = q
      .is('assigned_user_id', null)
      .not('work_state', 'eq', 'done')
      .not('work_state', 'eq', 'archived');
  } else if (f.queue_bucket === 'claimed_by_me' && viewerId) {
    q = q.eq('claimed_by_user_id', viewerId);
  } else if (f.queue_bucket === 'review_for_me' && viewerId) {
    q = q.eq('work_state', 'review_pending').eq('reviewer_user_id', viewerId);
  }
  if (f.state) q = q.eq('work_state', f.state);
  if (f.module_key) q = q.eq('module_key', f.module_key);
  if (
    f.queue_bucket !== 'assigned_to_me' &&
    f.queue_bucket !== 'unassigned' &&
    f.queue_bucket !== 'review_for_me' &&
    f.assigned_user_id
  ) {
    q = q.eq('assigned_user_id', f.assigned_user_id);
  }
  if (f.reviewer_user_id) q = q.eq('reviewer_user_id', f.reviewer_user_id);
  if (f.client_id) q = q.eq('client_id', f.client_id);
  if (f.period_key) q = q.eq('period_key', f.period_key);
  const pageResp = await q
    .order('updated_at', { ascending: false })
    .range(f.offset, f.offset + f.limit - 1);
  if (pageResp.error) throw pageResp.error;
  const rowsRaw = (pageResp.data ?? []) as QueueWorkItemRow[];
  const totalMatching = pageResp.count ?? rowsRaw.length;

  const policyByType = await resolveWorkTypePoliciesBatch(
    orgId,
    rowsRaw.map((r) => r.work_type),
  );
  const obligationsByItem = await loadActiveSlaObligationsForItems(
    orgId,
    rowsRaw.map((r) => r.id),
  );

  // ---- 4. Batch-fetch display names for client + users referenced by the page.
  const clientIds = Array.from(
    new Set(rowsRaw.map((r) => r.client_id).filter((v): v is string => !!v)),
  );
  const userIdsSet = new Set<string>();
  for (const r of rowsRaw) {
    if (r.assigned_user_id) userIdsSet.add(r.assigned_user_id);
    if (r.reviewer_user_id) userIdsSet.add(r.reviewer_user_id);
    if (r.claimed_by_user_id) userIdsSet.add(r.claimed_by_user_id);
    if (r.escalation_owner_id) userIdsSet.add(r.escalation_owner_id);
  }
  // Also include distinct assignee/reviewer ids so the filter dropdowns show
  // a name, not a UUID.
  for (const id of distinctAssignees) userIdsSet.add(id);
  for (const id of distinctReviewers) userIdsSet.add(id);
  const userIds = Array.from(userIdsSet);

  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const cResp = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', clientIds);
    if (cResp.error) throw cResp.error;
    for (const c of (cResp.data ?? []) as Array<{
      id: string;
      display_name: string | null;
    }>) {
      clientNameById.set(c.id, c.display_name ?? c.id);
    }
  }
  const userNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const uResp = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds);
    if (uResp.error) throw uResp.error;
    for (const u of (uResp.data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      userNameById.set(u.id, u.full_name?.trim() || u.email?.trim() || u.id);
    }
  }

  // ---- 4b. DocFlow thread activity + office-unread (queue read-model projection only).
  const docflowUnreadPairs: Array<{ clientId: string; threadId: string }> = [];
  const docflowThreadIdsForActivity = new Set<string>();
  for (const r of rowsRaw) {
    if (isDocflowConversationQueueItem(r) && r.client_id && r.source_entity_id) {
      docflowUnreadPairs.push({ clientId: r.client_id, threadId: r.source_entity_id });
      docflowThreadIdsForActivity.add(r.source_entity_id);
    }
  }
  const officeUnreadByThread =
    docflowUnreadPairs.length > 0
      ? await batchOfficeUnreadForThreads(orgId, docflowUnreadPairs)
      : new Map<string, number>();
  const threadUpdatedAtById = new Map<string, string>();
  if (docflowThreadIdsForActivity.size > 0) {
    const tIds = Array.from(docflowThreadIdsForActivity);
    const thrResp = await supabaseAdmin
      .from('client_message_threads')
      .select('id, updated_at')
      .eq('org_id', orgId)
      .in('id', tIds);
    if (thrResp.error) throw thrResp.error;
    for (const t of thrResp.data ?? []) {
      const id = String((t as { id?: string }).id ?? '');
      if (id) threadUpdatedAtById.set(id, String((t as { updated_at?: string }).updated_at ?? ''));
    }
  }

  // ---- 5. Recent pending-mapping rows for the pending section.
  const pendingRecentResp = await supabaseAdmin
    .from('work_events')
    .select(
      'id, event_id, event_type, source_module, source_entity_type, source_entity_id, client_id, period_key, processing_outcome, received_at, occurred_at',
    )
    .eq('org_id', orgId)
    .is('work_item_id', null)
    .in('processing_outcome', PENDING_MAPPING_OUTCOMES as unknown as string[])
    .order('received_at', { ascending: false })
    .limit(25);
  if (pendingRecentResp.error) throw pendingRecentResp.error;
  type PendingRow = {
    id: string;
    event_id: string;
    event_type: string;
    source_module: string;
    source_entity_type: string;
    source_entity_id: string;
    client_id: string | null;
    period_key: string | null;
    processing_outcome: string;
    received_at: string;
    occurred_at: string;
  };
  const pendingRecentRows = (pendingRecentResp.data ?? []) as PendingRow[];

  // Hydrate client names for pending rows too (may include clients not in
  // the page set).
  const pendingClientIds = Array.from(
    new Set(
      pendingRecentRows
        .map((p) => p.client_id)
        .filter((v): v is string => !!v),
    ),
  ).filter((id) => !clientNameById.has(id));
  if (pendingClientIds.length > 0) {
    const cResp = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', pendingClientIds);
    if (cResp.error) throw cResp.error;
    for (const c of (cResp.data ?? []) as Array<{
      id: string;
      display_name: string | null;
    }>) {
      clientNameById.set(c.id, c.display_name ?? c.id);
    }
  }

  // ---- 6. Compose row models (ready-to-render; includes queue_table drivers).
  const rows = rowsRaw.map((r) => {
    const isConv = isDocflowConversationQueueItem(r);
    const clientName = r.client_id ? (clientNameById.get(r.client_id) ?? null) : null;
    const module_label = moduleLabel(r.module_key);
    const work_type_label = workTypeLabel(r.work_type);
    const work_state_label = workStateLabel(r.work_state);
    const assigned_user_name = r.assigned_user_id
      ? (userNameById.get(r.assigned_user_id) ?? null)
      : null;
    const reviewer_user_name = r.reviewer_user_id
      ? (userNameById.get(r.reviewer_user_id) ?? null)
      : null;
    const claimed_by_user_name = r.claimed_by_user_id
      ? (userNameById.get(r.claimed_by_user_id) ?? null)
      : null;
    const claimed_cell = buildClaimedQueueCell(r.claimed_by_user_id);
    const claimed_cell_title = buildClaimedQueueCellTitle(
      r.claimed_by_user_id,
      claimed_by_user_name,
      r.claimed_at,
    );
    const ov = overrideSummary({
      override_active: r.override_active,
      override_summary_json: r.override_summary_json,
    });
    const escalation_owner_name = r.escalation_owner_id
      ? (userNameById.get(r.escalation_owner_id) ?? null)
      : null;
    const stateCell = ov ? `${work_state_label} · ${ov}` : work_state_label;
    const stateCellTitleParts: string[] = [];
    if (r.work_state === 'escalated' && r.escalation_prior_work_state) {
      const priorTooltip = buildEscalationPriorStateTooltip(
        r.escalation_prior_work_state as WorkState,
      );
      if (priorTooltip) stateCellTitleParts.push(priorTooltip);
    }
    const threadId = isConv ? String(r.source_entity_id ?? '') : '';
    const lastActivityIso =
      isConv && threadId && threadUpdatedAtById.has(threadId)
        ? (threadUpdatedAtById.get(threadId) ?? r.updated_at)
        : r.updated_at;
    const last_activity_cell = formatQueueUtcTimestamp(lastActivityIso);
    const unread_cell =
      isConv && threadId ? String(officeUnreadByThread.get(threadId) ?? 0) : null;
    const period_cell = isConv ? null : r.period_key;
    const reviewer_cell = isConv ? null : reviewer_user_name;
    const review_flow_status_label = reviewFlowStatusLabel(r);
    const review_status_cell = isConv ? null : review_flow_status_label;
    const slaStatusLabelText = slaStatusLabel(r.sla_status);
    const messengerPath =
      isConv && r.client_id && threadId
        ? `/m/docflow/messenger?client_id=${encodeURIComponent(r.client_id)}&thread_id=${encodeURIComponent(threadId)}`
        : null;
    const hidePeriodInSubject = isConv;

    const policyRow: WorkTypeEnginePolicy = policyByType.get(r.work_type) ?? {
      allow_staff_pickup_unassigned: true,
      review_gate: 'allowed',
      ...DEFAULT_SLA_POLICY,
    };
    const itemObligations = obligationsByItem.get(r.id) ?? [];
    const slaPresentation = buildQueueSlaPresentation(
      itemObligations,
      r.sla_status as SlaStatus,
      r.due_at,
      policyRow,
    );
    const primaryDueIso =
      itemObligations.find((o) => o.status === 'active' && o.kind === 'response')?.due_at ??
      itemObligations.find((o) => o.status === 'active' && o.kind === 'review')?.due_at ??
      itemObligations.find((o) => o.status === 'active')?.due_at ??
      r.due_at;
    const due_column_cell = buildDueQueueCellText(
      r.sla_status as SlaStatus,
      slaStatusLabelText,
      primaryDueIso,
    );

    const queue_cells = sanitizeQueueCells({
      client: clientName,
      module: module_label,
      work_type: work_type_label,
      state: stateCell,
      assignee: assigned_user_name,
      last_activity: last_activity_cell,
      unread: unread_cell,
      due: due_column_cell,
      period_key: period_cell,
      reviewer: reviewer_cell,
      review_status: review_status_cell,
      claimed: claimed_cell,
    });
    const queue_cell_titles: Record<string, string | null> = {
      claimed: claimed_cell_title,
      due: slaPresentation.primary_due_at_label,
      state: stateCellTitleParts.length > 0 ? stateCellTitleParts.join(' · ') : null,
    };
    const ownershipDraft =
      viewer != null
        ? computeOwnershipCommands({
            row: r,
            viewer,
            policy: policyRow,
          })
        : [];
    const reviewDraft =
      viewer != null ? computeReviewCommands({ row: r, viewer, policy: policyRow }) : [];
    const escalationDraft =
      viewer != null ? computeEscalationCommands({ row: r, viewer }) : [];
    const allowedBase = queueAllowedActions({
      work_state: r.work_state,
      assigned_user_id: r.assigned_user_id,
    });
    const chrome =
      viewer != null
        ? buildQueueRowChrome({
            row: r,
            viewer,
            ownershipDraft,
            reviewDraft,
            escalationDraft,
            allowedRows: allowedBase,
          })
        : {
            ownership_commands: [] as QueueOwnershipCommand[],
            review_commands: [] as QueueReviewCommand[],
            escalation_commands: [] as QueueEscalationCommand[],
            allowed_actions: allowedBase,
            queue_shell: {
              open_detail: {
                kind: 'open_queue_item_detail',
                label: 'Open',
                enabled: true,
                reason: null,
                presentation_group: 'row_primary',
              },
              secondary_actions: [],
              overflow_menu: {
                trigger_label: '⋯',
                sections: [{ section_title: null, items: [] }],
                admin: null,
              },
            },
          };
    const { ownership_commands, review_commands, escalation_commands, allowed_actions, queue_shell } =
      chrome;
    const escalation_acknowledged_label = isEscalationAcknowledged(r)
      ? 'Acknowledged'
      : r.work_state === 'escalated'
        ? 'Pending acknowledgment'
        : null;
    return {
      work_item_id: r.id,
      client_id: r.client_id,
      client_name: clientName,
      module_key: r.module_key,
      module_label,
      work_type: r.work_type,
      work_type_label,
      period_key: r.period_key,
      work_state: r.work_state,
      work_state_label,
      assigned_user_id: r.assigned_user_id,
      assigned_user_name,
      reviewer_user_id: r.reviewer_user_id,
      reviewer_user_name,
      claimed_by_user_id: r.claimed_by_user_id,
      claimed_at: r.claimed_at,
      claimed_by_user_name,
      ownership_commands,
      review_flow_status_label,
      review_commands,
      escalation_commands,
      escalation_owner_id: r.escalation_owner_id,
      escalation_owner_name,
      escalation_reason: r.escalation_reason,
      escalation_source: r.escalation_source,
      escalation_source_label: r.escalation_source
        ? escalationSourceLabel(r.escalation_source)
        : null,
      escalation_prior_work_state: r.escalation_prior_work_state,
      escalation_acknowledged_at: r.escalation_acknowledged_at,
      escalation_acknowledged_label,
      due_at: r.due_at,
      sla_status: r.sla_status,
      sla_status_label: slaStatusLabel(r.sla_status),
      sla_badges: slaPresentation.sla_badges,
      primary_due_at_label: slaPresentation.primary_due_at_label,
      override_active: r.override_active,
      override_summary: ov,
      allowed_actions,
      allowed_transitions: rowAllowedTransitions(r.work_state),
      allowed_override_kinds: rowAllowedOverrideKinds(r.work_state),
      version: r.version,
      updated_at: r.updated_at,
      queue_cells,
      queue_cell_titles,
      queue_shell,
      command_modal_subject_line: buildCommandModalSubjectLine({
        work_type_label,
        module_label,
        period_key: r.period_key,
        version: r.version,
        hide_period_in_subject: hidePeriodInSubject,
      }),
      detail_panel: buildQueueRowDetailPanel({
        client_name: clientName,
        client_id: r.client_id,
        module_label,
        work_type_label,
        work_state_label,
        review_flow_status_label,
        assigned_user_name,
        reviewer_user_name,
        claimed_by_user_name,
        claimed_at: r.claimed_at,
        due_at: r.due_at,
        sla_status_label: slaStatusLabel(r.sla_status),
        primary_due_at_label: slaPresentation.primary_due_at_label,
        override_summary: ov,
        period_key: r.period_key,
        hide_period_in_subject: hidePeriodInSubject,
        docflow_messenger_path: messengerPath,
      }),
    };
  });

  const queue_table = computeQueueTableModel(rows);

  const reminderReviewPage =
    reminderReviewSummary.pending_count > 0
      ? await loadReminderReviewPage({
          orgId,
          offset: 0,
          limit: Math.min(reminderReviewSummary.pending_count, QUEUE_MAX_LIMIT),
          viewer,
        })
      : { rows: [], total: 0 };

  const escalationOwnerOptions = await loadEscalationOwnerOptions(orgId);
  const escalation_workspace = buildEscalationWorkspace(escalationOwnerOptions);

  // ---- 7. Compose response.
  return {
    aggregate_key: 'work_engine_queue_aggregate',
    org_id: orgId,
    generated_at: new Date().toISOString(),
    queue_view_mode: 'work_items',
    workspace_tabs: buildAccountantWorkspaceTabs('work_engine'),
    reminder_review_summary: reminderReviewSummary,
    banner: reminderBanner,
    snooze_presets: REMINDER_SNOOZE_PRESETS.map((p) => ({
      preset_key: p.preset_key,
      label: p.label,
    })),
    escalation_workspace,

    summary_cards: {
      total_active: totalActive,
      assigned_to_me: bucketAssignedToMe,
      unassigned: bucketUnassigned,
      claimed_by_me: bucketClaimedByMe,
      review_for_me: bucketReviewForMe,
      waiting_client: counts.waiting_client ?? 0,
      waiting_human: counts.waiting_human ?? 0,
      review_pending:
        (counts.review_pending ?? 0) + reminderReviewSummary.pending_count,
      overdue: counts.overdue ?? 0,
      escalated: counts.escalated ?? 0,
      pending_mapping: pendingMappingCount,
      pending_reminders: reminderReviewSummary.pending_count,
    },

    filters: {
      states: WORK_STATES.map((s) => ({
        value: s,
        label: workStateLabel(s),
        terminal: s === 'done' || s === 'archived',
      })),
      modules: Array.from(distinctModules)
        .sort()
        .map((m) => ({ value: m, label: moduleLabel(m) })),
      assignees: Array.from(distinctAssignees)
        .sort()
        .map((id) => ({
          value: id,
          label: userNameById.get(id) ?? id,
        })),
      reviewers: Array.from(distinctReviewers)
        .sort()
        .map((id) => ({
          value: id,
          label: userNameById.get(id) ?? id,
        })),
      period_keys: Array.from(distinctPeriods)
        .sort()
        .reverse() // newest periods first
        .map((p) => ({ value: p, label: p })),
      queue_buckets: [
        { value: '', label: 'All (respect filters below)' },
        { value: 'assigned_to_me', label: 'Assigned to me' },
        { value: 'unassigned', label: 'Unassigned' },
        { value: 'claimed_by_me', label: 'Claimed by me' },
        { value: 'review_for_me', label: 'Review for me' },
      ],
      pending_mapping_reasons: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },

    applied_filters: {
      state: f.state,
      module_key: f.module_key,
      assigned_user_id: f.assigned_user_id,
      reviewer_user_id: f.reviewer_user_id,
      client_id: f.client_id,
      period_key: f.period_key,
      queue_bucket: f.queue_bucket,
    },

    pagination: {
      limit: f.limit,
      offset: f.offset,
      total_matching: totalMatching,
      returned: rows.length,
    },

    queue_table,

    rows,

    reminder_review_table: REMINDER_REVIEW_QUEUE_TABLE,
    reminder_review_rows: reminderReviewPage.rows,
    reminder_review_pagination: {
      limit: Math.min(reminderReviewSummary.pending_count, QUEUE_MAX_LIMIT),
      offset: 0,
      total_matching: reminderReviewPage.total,
      returned: reminderReviewPage.rows.length,
    },

    pending_mapping_section: {
      pending_mapping_count: pendingMappingCount,
      recent_pending_mappings: pendingRecentRows.map((p) => ({
        id: p.id,
        event_id: p.event_id,
        event_type: p.event_type,
        source_module: p.source_module,
        source_module_label: moduleLabel(p.source_module),
        source_entity_type: p.source_entity_type,
        source_entity_id: p.source_entity_id,
        client_id: p.client_id,
        client_name: p.client_id
          ? (clientNameById.get(p.client_id) ?? null)
          : null,
        period_key: p.period_key,
        pending_reason: p.processing_outcome,
        pending_reason_label: pendingReasonLabel(p.processing_outcome),
        received_at: p.received_at,
        occurred_at: p.occurred_at,
      })),
      reason_catalog: [
        { value: MAPPING_REASON.UNKNOWN_EVENT_MAPPING, label: 'Unknown event type' },
        { value: MAPPING_REASON.MISSING_PERIOD_KEY, label: 'Missing period_key' },
        { value: 'accepted_pending_mapping', label: 'Pending mapping (legacy)' },
      ],
    },
  };
}
