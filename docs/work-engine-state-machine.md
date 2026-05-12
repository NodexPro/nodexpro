# Work Engine — State Machine (Stage 1)

Status: Design contract only. No code, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Defines the canonical 12-state lifecycle of a `work_item`. The state machine is backend-owned. UI MUST NOT compute, derive, or display states outside the values enumerated here, and MUST NOT decide transitions.

## 2. State separation principle (mandatory)

These statuses are independent and MUST NEVER be conflated:

| Status | Plane | Owner |
| --- | --- | --- |
| `work_state` | Workflow lifecycle of a work item | Work Engine |
| `thread_status` | Communication lifecycle of a DocFlow thread | DocFlow |
| `delivery_status` | Channel delivery state of a message | Delivery / outbox layer |
| `message_status` | Lifecycle of an individual message entity | DocFlow |
| `rule_run_status` | Communication-rule run lifecycle | DocFlow communication-rule layer |
| `period_status` | Accounting period lock state | Accounting Base |
| `obligation_status` | Operational requirement state | `client_obligations` |

A work item may simultaneously be in `work_state = waiting_client` while a related DocFlow thread is `thread_status = waiting_client`. They are not the same value. Each plane mutates independently via its own commands.

## 3. State catalog

Exact enum (no other values are allowed):

`new`, `assigned`, `waiting_human`, `waiting_client`, `client_replied`, `review_pending`, `approved`, `rejected`, `overdue`, `escalated`, `done`, `archived`.

| State | Active / Terminal | Short meaning |
| --- | --- | --- |
| `new` | active | Work item created. No owner, no assignment yet, or assignment pending engine resolution. |
| `assigned` | active | An office user is assigned and accountable for the next operational action. |
| `waiting_human` | active | The next action is an office-side human action (e.g. internal preparation, manual review prep). |
| `waiting_client` | active | The next action is on the client side (upload, answer, confirm). |
| `client_replied` | active | Client provided a reply/upload; office must process. |
| `review_pending` | active | Work has been prepared; a reviewer must approve or reject. |
| `approved` | active | Reviewer approved; remaining steps before completion are operational, not gating. |
| `rejected` | active | Reviewer rejected; work returns to a prior active state per policy. |
| `overdue` | active | `due_at` has passed and no completion. Backend-set, not UI-computed. |
| `escalated` | active | Escalation policy triggered; `escalation_owner_id` is now the responsible party. |
| `done` | terminal | Work is operationally complete. |
| `archived` | terminal | Historical / retention state. No active work expected. |

Active = countable in queues. Terminal = excluded from dedup active uniqueness.

## 4. State definitions in detail

For each state, this section defines: meaning, allowed transitions, allowed actions, actor permissions conceptually, active/terminal classification, aggregate exposure rules.

### 4.1 `new`

- **Meaning:** Work item exists. No assignment performed yet, or initial intake just landed (e.g. from an event before the assignment rule fired).
- **Allowed transitions to:** `assigned`, `waiting_client` (only if dedicated rule pre-assigns + sends a structured request in one command), `archived` (only for accidental creations).
- **Allowed transitions from:** (initial state; no `from`).
- **Allowed actions:** `assign_work_item`, `archive_work_item` (with override reason).
- **Actor permissions conceptually:** any office user with `assign_work` may assign; only `manager`/`owner` may archive a `new` item.
- **Classification:** active.

### 4.2 `assigned`

- **Meaning:** Office user is responsible. Operational action is required from the office side, but a specific waiting flow (client-action vs internal-action) has not been declared.
- **Allowed transitions to:** `waiting_human`, `waiting_client`, `review_pending` (when assignee finished and seeks review), `archived` (only via override), `done` (only for trivial work types whose completion does not require review per Country Pack rule).
- **Allowed transitions from:** `new`, `rejected`, `reopened-from-done` (see Section 6).
- **Allowed actions:** `reassign_work_item`, `set_work_deadline`, `mark_work_waiting_client`, `mark_work_waiting_human`, `submit_for_review`, `complete_work_item` (rule-conditional).
- **Actor permissions:** assignee, owner, manager, or any user with `assign_work` for reassignment.
- **Classification:** active.

### 4.3 `waiting_human`

- **Meaning:** Office-side action required (internal preparation, manual data entry, manual verification). Not waiting on the client.
- **Allowed transitions to:** `assigned`, `waiting_client` (if data gap discovered), `review_pending`, `escalated` (rule-driven), `overdue` (rule-driven).
- **Allowed transitions from:** `assigned`, `client_replied`, `rejected`.
- **Allowed actions:** `submit_for_review`, `mark_work_waiting_client`, `reassign_work_item`, `set_work_deadline`.
- **Actor permissions:** assignee primarily; manager/owner may force-transition.
- **Classification:** active.

### 4.4 `waiting_client`

- **Meaning:** Next required action is on the client (upload, answer, confirm). Often paired with a DocFlow structured request or message intent.
- **Allowed transitions to:** `client_replied` (via DocFlow event), `waiting_human` (if office decides to proceed without client input), `escalated`, `overdue`.
- **Allowed transitions from:** `new`, `assigned`, `waiting_human`, `rejected`.
- **Allowed actions:** `mark_work_client_replied` (only as a result of a DocFlow event), `cancel_client_wait` (override, with reason), `set_work_deadline`, `assign_work_item`.
- **Actor permissions:** automated by Work Engine on DocFlow event; office override allowed by assignee/owner/manager with reason.
- **Classification:** active.

### 4.5 `client_replied`

- **Meaning:** Client has replied / uploaded; the office must now process the input.
- **Allowed transitions to:** `waiting_human` (office continues processing), `waiting_client` (if reply is insufficient), `review_pending`, `escalated`, `overdue`.
- **Allowed transitions from:** `waiting_client` (via DocFlow `client_replied` event), `rejected`.
- **Allowed actions:** `process_client_reply` (a command that decides next state), `mark_work_waiting_client` (request more), `submit_for_review`, `set_work_deadline`.
- **Actor permissions:** assignee.
- **Classification:** active.

### 4.6 `review_pending`

- **Meaning:** Work is ready; a reviewer must decide.
- **Allowed transitions to:** `approved`, `rejected`.
- **Allowed transitions from:** `assigned`, `waiting_human`, `client_replied`.
- **Allowed actions:** `approve_work_item`, `reject_work_item`.
- **Actor permissions:** only the `reviewer_user_id` or a user with `approve_drafts` / `review` permission.
- **Classification:** active.

### 4.7 `approved`

- **Meaning:** Reviewer approved. Final operational close steps remain (filing, archiving evidence, sending final confirmation).
- **Allowed transitions to:** `done`.
- **Allowed transitions from:** `review_pending`.
- **Allowed actions:** `complete_work_item`.
- **Actor permissions:** assignee, owner, manager.
- **Classification:** active.

### 4.8 `rejected`

- **Meaning:** Reviewer rejected; work returns to a prior active state for rework.
- **Allowed transitions to:** `assigned`, `waiting_human`, `waiting_client` (rule decides which, defaulting to `assigned`).
- **Allowed transitions from:** `review_pending`.
- **Allowed actions:** `assign_work_item`, `mark_work_waiting_human`, `mark_work_waiting_client`.
- **Actor permissions:** assignee, owner, manager.
- **Classification:** active.

### 4.9 `overdue`

- **Meaning:** `due_at` has passed and the item is not in a terminal state. Backend-set.
- **Allowed transitions to:** `escalated` (per rule), `assigned` / `waiting_human` / `waiting_client` (if `due_at` is extended via override), `done` (if completed despite being late), `archived` (only via override).
- **Allowed transitions from:** any active state where `due_at` has passed.
- **Allowed actions:** `set_work_deadline` (override; clears `overdue` if new `due_at` is in the future), `escalate_work_item`, any action allowed by the underlying active state.
- **Actor permissions:** owner/manager for override; rule-driven escalation for `escalated`.
- **Classification:** active.
- **Computation rule:** Work Engine moves an item into `overdue` only via a scheduled rule or via a command-side check. UI MUST NEVER infer `overdue` from `due_at` locally.

### 4.10 `escalated`

- **Meaning:** Escalation policy fired; `escalation_owner_id` is the current responsible party. The underlying functional waiting (waiting_client / waiting_human) is preserved in `payload_snapshot` on the transition for restore.
- **Allowed transitions to:** `assigned` (de-escalate by override), `done` (if resolved during escalation), `archived` (override).
- **Allowed transitions from:** `waiting_client`, `waiting_human`, `client_replied`, `overdue`.
- **Allowed actions:** `cancel_escalation` (override, requires reason), `reassign_work_item`, `set_work_deadline`, `complete_work_item`.
- **Actor permissions:** owner, manager, escalation owner.
- **Classification:** active.

### 4.11 `done`

- **Meaning:** Operational completion.
- **Allowed transitions to:** `archived`, `assigned` (only via explicit reopen policy; see Section 6).
- **Allowed transitions from:** `approved`, `overdue` (if completed late), `escalated` (if resolved during escalation), `assigned` (for non-review work types per rule).
- **Allowed actions:** `archive_work_item`, `reopen_work_item` (governed by reopen policy).
- **Actor permissions:** owner, manager.
- **Classification:** terminal.

### 4.12 `archived`

- **Meaning:** Historical state for retention/reference.
- **Allowed transitions to:** none (Stage 1). Restore is explicitly out of scope for Stage 1; if added later, governed by a separate restore command and policy.
- **Allowed transitions from:** `done`, plus override-only transitions from `new`/`overdue` where explicitly allowed.
- **Allowed actions:** none state-changing in Stage 1.
- **Actor permissions:** owner, manager.
- **Classification:** terminal.

## 5. Transition matrix (single page)

`X` = allowed, `O` = allowed only via override (with `override_reason`), blank = forbidden.

|  From \ To      | new | assigned | waiting_human | waiting_client | client_replied | review_pending | approved | rejected | overdue | escalated | done | archived |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `new`           |     | X        | O             | O              |                |                |          |          |         |           |      | O        |
| `assigned`      |     |          | X             | X              |                | X              |          |          |         |           | O*   | O        |
| `waiting_human` |     | X        |               | X              |                | X              |          |          | system  | system    |      | O        |
| `waiting_client`|     | X        | X             |                | system         |                |          |          | system  | system    |      | O        |
| `client_replied`|     |          | X             | X              |                | X              |          |          | system  | system    |      | O        |
| `review_pending`|     |          |               |                |                |                | X        | X        |         |           |      | O        |
| `approved`      |     |          |               |                |                |                |          |          |         |           | X    | O        |
| `rejected`      |     | X        | X             | X              |                |                |          |          |         |           |      | O        |
| `overdue`       |     | O        | O             | O              |                |                |          |          |         | system    | X    | O        |
| `escalated`     |     | O        |               |                |                |                |          |          |         |           | X    | O        |
| `done`          |     | O (reopen) |             |                |                |                |          |          |         |           |      | X        |
| `archived`      |     |          |               |                |                |                |          |          |         |           |      |          |

Notes:
- `system` = transition produced only by Work Engine rule worker (overdue/escalation), not by direct user command.
- `O*` on `assigned → done` = allowed only for work types whose Country Pack policy explicitly classifies as "no-review-required".
- `reopen` on `done → assigned` follows reopen policy in Section 6 and dedup policy.

## 6. Reopen policy

- A `done` item MAY transition back to `assigned` only via the explicit `reopen_work_item` command, with `override_reason`, executed by `owner`/`manager`.
- Reopen MUST NOT violate the dedup uniqueness invariant. Implementation rule: reopen is allowed only if no other active item exists for the dedup key. If an active item already exists, reopen is rejected with `reopen_conflict`.
- Reopen appends a `work_transition` with `kind = 'override'`.

## 7. SLA classification (`sla_status`)

`sla_status` is an attribute of the row, set by Work Engine; UI does not compute it.

Allowed values: `none`, `on_track`, `due_soon`, `overdue`, `breached`.

- `none`: no `due_at` set or work type has no SLA.
- `on_track`: `due_at` in future, beyond the "due_soon" window defined by Country Pack/Owner rule for this work type.
- `due_soon`: `due_at` in future, within the configured window.
- `overdue`: `due_at` in the past and `work_state` is active.
- `breached`: `due_at` in the past beyond the configured breach threshold; possibly combined with `escalated`.

`work_state = 'overdue'` and `sla_status = 'overdue'` are related but independent:
- `work_state = 'overdue'` is a lifecycle state per the state machine.
- `sla_status` is a classification used for aggregate filters and KPI counts.
- It is valid to have `work_state = 'waiting_client'` AND `sla_status = 'overdue'` — the system has detected the SLA breach but not yet performed the state transition.

## 8. Aggregate exposure (mandatory contract for read models)

Every aggregate that exposes a work item MUST include all of:

- `work_state` (raw value).
- `state_label` (Country Pack-localized label, resolved at aggregate time).
- `allowed_actions` (array of `{ command, enabled, reason }`).
- `next_actions` (recommended action set, ordered).
- `sla_status` (raw value).
- `sla_label` (localized).
- `override_active` (boolean; true when the latest transition has `kind = 'override'` and has not yet been superseded by an automation transition).
- `version` (for `expected_version` on subsequent commands).

UI MUST NOT recompute any of the above.

## 9. Forbidden on UI (state-related)

- Computing `work_state` from row fields.
- Computing `sla_status` from `due_at` and `now()`.
- Localizing `state_label` or `sla_label` from a frontend dictionary.
- Deciding which actions are enabled.
- Inferring `overdue` from a deadline.
- Deciding when a `done` item can be reopened.

## 10. Hard rules summary

- 12 states, exact enum, no synonyms.
- Backend owns every transition.
- `work_state` ≠ `thread_status` ≠ `delivery_status` ≠ `rule_run_status` ≠ `period_status` ≠ `obligation_status`.
- Every transition appends a `work_transition`.
- Override transitions are distinct rows; provenance preserved.
- `overdue` and `escalated` are stored states reached by Work Engine rule worker, not UI inference.
- Aggregate exposes ready-to-render labels, actions, SLA classification.
- Reopen is bounded by dedup uniqueness.

---

End of state machine contract.
