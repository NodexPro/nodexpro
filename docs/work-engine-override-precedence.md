# Work Engine — Override Precedence (Stage 1)

Status: Design contract only. No code, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Defines what happens when a human explicitly overrides a Work Engine automation decision: how the override is recorded, how subsequent automation respects it, and what audit guarantees are mandatory.

Principle:

> Human override wins. Automation respects the latest authorized override. Audit is never sacrificed for convenience.

## 2. Scope — what counts as an override

The following human actions are classified as **overrides**:

1. **Deadline extension / change** — `set_work_deadline` issued by a human user with a `due_at` that differs from the value last set by automation.
2. **Manual assignment** — `assign_work_item` / `reassign_work_item` when issued by a human user, regardless of who the previous assignee was.
3. **Manual state change** — `change_work_state` (or its specialized variants `mark_work_waiting_client`, `mark_work_client_replied`, etc.) issued by a human user where the target state would not have been reached by automation given current inputs.
4. **Escalation cancel** — `cancel_escalation` reverting an `escalated` row to its prior functional state.
5. **Reminder cancel** — `cancel_pending_reminder` suppressing a queued reminder intent.
6. **Reopen** — `reopen_work_item` reactivating a `done` row.
7. **Archive of a non-`done` row** — archiving directly from `new` / `overdue` / `escalated` / etc. (allowed only via override).

Actions NOT classified as overrides:

- Routine `assign_work_item` immediately after `create_work_item` when the system did not yet propose an assignee.
- `set_work_deadline` issued by automation/rule (e.g. recomputed by Country Pack rule on ruleset activation).
- State changes driven by accepted events that match the per-event-type policy (Section 5 of dedup policy).

## 3. Override metadata (mandatory)

Every override-classified action produces a `work_transition` row with:

| Field | Requirement | Notes |
| --- | --- | --- |
| `kind` | `'override'` | Distinguishes from `'command'`/`'automation'`/`'system_correction'`. |
| `actor_type` | `'user'` | Override is always a human action. |
| `actor_user_id` | required | Must be a valid Core user with permission. |
| `command` | required | The command name. |
| `reason_code` | optional | Short machine code if applicable. |
| `reason_text` | **required for** cases (1) `set_work_deadline`, (4) `cancel_escalation`, (5) `cancel_pending_reminder`. Strongly recommended for all other overrides. | Free-form, length-bounded. |
| `payload_snapshot` | required | MUST include `previous_value` and `new_value` for the field(s) changed. For deadline override: `previous_due_at`, `new_due_at`. For assignment: `previous_assigned_user_id`, `new_assigned_user_id`. For escalation cancel: `previous_escalation_owner_id`, `prior_work_state` (the state that escalation was applied to). For reminder cancel: `cancelled_reminder_id`, `intent_type`. |
| `created_at` | server-set | Authoritative time of override. |

The application also stamps the override on the `work_items` row:

- `version` += 1 (as for any command).
- `updated_at` = override time.
- For deadline overrides, `due_at` becomes the new value, and aggregate downstream MUST recompute `sla_status` from the new value at the next read or rule worker pass.

## 4. Provenance: original automation is never erased

Override transitions are added; prior automation transitions are not modified, not deleted, not flagged. Reconstructing the history of a row from `work_transitions` MUST always produce a complete, ordered narrative including the automation actions that preceded the override.

This implies:

- No "soft-delete" of automation rows on override.
- No backdating of override `created_at`.
- No silent merging of two overrides into one row.

If multiple override fields are changed in a single command (e.g. `change_work_state` AND `set_work_deadline` in one operation), implementation SHOULD produce one transition per state-relevant change (a deadline change without a state change is a single non-state transition where `from_state == to_state`).

## 5. Subsequent automation behavior

After an override, automated logic MUST respect it. Concretely:

### 5.1 Deadline extension

- Rule worker MUST NOT revert `due_at` to a previously rule-derived value purely because a Country Pack rule says so.
- Rule worker MAY recompute `due_at` only on one of:
  - A new emitting event explicitly authorizes recomputation (e.g. `obligation_status_changed` with a flag indicating deadline reset).
  - A new ruleset activation that retracts the previous rule and a Work Engine policy entry explicitly classifies the new ruleset event as `recompute_deadlines = true` for affected work types.
  - An explicit subsequent human override.
- Recomputation that overrides a prior human override MUST itself be classified as `kind = 'override'` if performed by a human, or as `kind = 'system_correction'` with an authorizing rule id if performed by automation.

### 5.2 Manual assignment

- Auto-assignment rules MUST NOT reassign a manually-assigned work item unless:
  - The current assignee was deactivated (Core membership status changed); OR
  - A reviewer/manager issues a subsequent override; OR
  - The work item enters `archived` (terminal).
- `escalation` MAY change `escalation_owner_id` per rule even when `assigned_user_id` was manually overridden, because they are different fields.

### 5.3 Manual state change

- Automation MUST treat the new state as the authoritative starting point for next decisions.
- If automation logic would have advanced the state to the same value, it is a no-op.
- If automation logic would have moved to a different state, that move is suppressed for the current cycle and re-evaluated on the next inbound event.

### 5.4 Escalation cancel

- `cancel_escalation` MUST set `work_state` back to the `prior_work_state` captured in the escalation transition's `payload_snapshot`.
- `escalation_owner_id` is cleared (set null) unless the policy explicitly preserves it as a notification preference.
- The escalation rule that originally fired MUST NOT re-fire within the same `period_key` cycle for the same item unless a new authorizing event arrives (e.g. a new `overdue` detection after a fresh deadline extension that already expired again).
- Suppression is implemented by checking the latest override transition on the item, NOT by adding a global flag.

### 5.5 Reminder cancel

- `cancel_pending_reminder` marks the `work_notification` as `delivery_status = 'cancelled'` with `created_by_transition_id` linking the cancellation transition.
- Future identical reminder intents (same `dedup_key` bucket) MUST NOT be regenerated within the same bucket.
- A new bucket (e.g. next day's reminder cycle) MAY produce a fresh notification intent unless a longer-lived "do not remind" policy is recorded (out of scope for Stage 1).

### 5.6 Reopen

- See state machine doc (Section 6 of `work-engine-state-machine.md`).
- Reopen is subject to dedup uniqueness; reject if it would create two active rows for the same dedup key.

### 5.7 Direct archive

- Direct archive from a non-`done` state requires `reason_text`.
- Aggregate MUST surface "archived by override" status for office visibility (`override_active = true` on the latest transition).

## 6. Aggregate exposure

Aggregates MUST expose, per work item:

- `override_active` — boolean. True iff the latest `work_transition` has `kind = 'override'` and has not been superseded by a subsequent `kind = 'automation'` or `'command'` transition that changed the same field.
- `override_summary` — small object with the most recent override metadata: `field`, `previous_value`, `new_value`, `overridden_by_user_label`, `overridden_at`, `reason_text` (or null).
- `due_at_source` — enum: `automation`, `override`, `none`. Lets UI explain why the current `due_at` is what it is.

UI MUST render these values verbatim and MUST NOT recompute them.

## 7. Permissions (conceptual; bound at RBAC layer)

Overrides require permissions stronger than routine actions for these specific cases:

| Override | Required permission level (conceptual) |
| --- | --- |
| `set_work_deadline` (extending past statutory deadline) | manager / owner |
| `set_work_deadline` (within statutory window) | assignee / reviewer / manager / owner |
| `reassign_work_item` | any user with `assign_work` |
| `change_work_state` to any active state | assignee or above |
| `cancel_escalation` | manager / owner |
| `cancel_pending_reminder` | assignee or above |
| `reopen_work_item` | owner / manager |
| Direct archive of non-`done` row | owner / manager |

Exact permission codes are bound during the RBAC implementation phase; this document records intent only.

## 8. Forbidden

- Backdating overrides.
- Silent overrides (overrides without `kind = 'override'` and without `payload_snapshot`).
- Automation that "corrects" a human override without an authorizing rule id and a `system_correction` transition.
- UI deciding which command counts as override.
- Storing override reasons on the `work_items` row (they belong on `work_transitions`).
- Skipping `reason_text` for deadline / escalation cancel / reminder cancel.

## 9. Hard rules summary

- Override is a `work_transition` with `kind = 'override'`.
- Override metadata is mandatory; reason text mandatory for deadline / escalation cancel / reminder cancel.
- Audit and provenance are append-only and complete.
- Subsequent automation respects the latest authorized override.
- Aggregate exposes `override_active`, `override_summary`, `due_at_source` ready-to-render.

---

End of override precedence contract.
