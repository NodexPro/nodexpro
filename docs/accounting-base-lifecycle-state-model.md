# Accounting Base Lifecycle / State Model (Phase 6 - Step 4)

Status: Conceptual lifecycle/state definition only.  
No migrations, no DB changes, no API/UI/runtime implementation in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`

Architecture constraints:
- Core -> Commands -> Aggregate -> UI
- Financial truth source = `accounting_entries`
- UI must render backend lifecycle truth and action availability

---

## 1) Period lifecycle

Period status set:
- `open`
- `locked`
- `closed`

## 1.1 `open`

Meaning:
- Normal working state for accounting operations in this period.

Allowed operations:
- create draft entries
- update draft entries
- finalize entries
- archive/cancel entries (subject to command policy)
- recalculate derived summaries

Forbidden operations:
- direct summary edits as truth override
- bypass command boundary writes

Required permissions:
- accounting period view
- accounting entry create/update/finalize/archive by role policy

Audit requirements:
- every state-changing command emits audit fact
- period-level mutations are auditable with actor + timestamp

## 1.2 `locked`

Meaning:
- Temporary freeze; operational edits restricted pending close/review.

Allowed operations:
- read period entries/summaries
- system/authorized reconciliation commands only (if defined)
- close period command (authorized)

Forbidden operations:
- standard draft updates/creates by regular operators
- unrestricted finalize/archive operations

Required permissions:
- elevated accounting role for lock management

Audit requirements:
- `period_locked` fact required
- restricted commands during lock must emit explicit audit trail

## 1.3 `closed`

Meaning:
- Final period boundary state; treated as closed for normal operations.

Allowed operations:
- read entries/summaries
- optional future reopen command (strictly privileged)

Forbidden operations:
- normal edit/create/finalize operations in closed period
- direct mutation of derived summaries

Required permissions:
- close requires elevated accounting authority
- reopen (future) requires admin/special authority

Audit requirements:
- `period_closed` fact required
- any exceptional post-close action must emit explicit high-severity audit

---

## 2) Entry posting lifecycle

Posting state set:
- `draft`
- `finalized`

## 2.1 `draft`

Meaning:
- Mutable entry candidate, not yet finalized posting truth.

Allowed operations:
- update draft fields
- validate and finalize
- archive/cancel subject to status policy

Forbidden operations:
- bypassing validation/finalization command boundary

Required permissions:
- entry create/update permission

Audit requirements:
- create/update operations produce audit facts

## 2.2 `finalized`

Meaning:
- Finalized posting state for entry lifecycle.

Allowed operations:
- read
- archive/cancel only via explicit privileged commands/policy (if permitted)
- correction only through explicit compensating workflow (future policy)

Forbidden operations:
- editing finalized entry as if it were draft
- silent direct data mutation

Required permissions:
- finalize permission required
- correction/reversal permissions (future policy) must be explicit

Audit requirements:
- `entry_finalized` fact required
- any post-finalization exceptional mutation must emit explicit audit event

---

## 3) Entry business status (separate from posting_state)

Status set:
- `active`
- `archived`
- `cancelled` (optional/future)

Semantics:
- `status` describes business visibility/operational status.
- `posting_state` describes posting lifecycle maturity.

Rule:
- `status != posting_state`
- They are separate fields with separate transitions and permissions.

Examples:
- entry may be `posting_state=finalized`, `status=active`
- entry may become `posting_state=finalized`, `status=archived`
- optional future: `status=cancelled` with explicit policy and audit

---

## 4) Allowed transitions

## 4.1 Period transitions

- `open -> locked`
- `locked -> closed`
- optional future: `closed -> reopened` (admin/special command only)

Direct `open -> closed`:
- not default path unless explicit command policy allows forced close (TBD).

## 4.2 Entry posting transitions

- `draft -> finalized`

Reverse `finalized -> draft`:
- forbidden by default (see forbidden transitions).

## 4.3 Entry status transitions

- `active -> archived`
- optional future: `active -> cancelled`

Potential future restoration:
- `archived -> active` only through explicit privileged command (TBD).

---

## 5) Forbidden transitions / operations

Explicitly forbidden:
1. Editing finalized entry as draft.
2. Changing entries in closed period without special privileged command.
3. Directly changing summaries as truth source.
4. Treating event/fact records as current state fields.
5. Treating `status` and `posting_state` as one field.
6. Performing lifecycle transitions without command boundary + audit.

---

## 6) Commands implied by lifecycle (conceptual)

Period commands:
- `create_period`
- `lock_period`
- `close_period`
- `reopen_period` (optional/future)

Entry commands:
- `create_entry`
- `update_draft_entry`
- `finalize_entry`
- `archive_entry`
- `cancel_entry` (optional/future)

Notes:
- These are conceptual command names for lifecycle policy.
- No endpoint/implementation is defined in this step.

---

## 7) Required audit/event facts

Period facts:
- `period_created`
- `period_locked`
- `period_closed`
- `period_reopened` (optional/future)

Entry facts:
- `entry_created`
- `entry_updated`
- `entry_finalized`
- `entry_archived`
- `entry_cancelled` (optional/future)

Audit minimum payload expectations:
- actor_user_id
- organization_id
- entity_id
- command/action type
- occurred_at
- reason/context (for exceptional actions)

---

## 8) Aggregate implications

Aggregate contract expectations:
1. Backend returns lifecycle statuses (period status, entry posting_state, entry status).
2. Backend returns available actions derived from permissions + lifecycle state.
3. UI does not calculate lifecycle status.
4. UI does not calculate action availability.
5. UI only renders backend-provided truth.

Implication:
- lifecycle gating logic belongs to backend command policy + aggregate model.

---

## Transition summary (quick view)

Period:
- open -> locked -> closed
- optional future: closed -> reopened (special authority)

Entry posting:
- draft -> finalized

Entry business status:
- active -> archived
- optional future: active -> cancelled

---

## Risky decisions

1. Whether forced close (`open -> closed`) is allowed can impact operational controls and audit complexity.
2. Policy for post-finalization corrections (reverse/adjust vs in-place privileged edits) affects integrity guarantees.
3. Optional `cancelled` semantics may overlap with `archived` without strict business definitions.
4. Closed-period exceptional edits require strict governance to avoid weakening closure guarantees.
5. Action availability matrix complexity can drift if not centralized in aggregate command policy.

---

## Open questions / UNKNOWN

1. UNKNOWN: exact role/permission matrix per transition (`lock`, `close`, `reopen`, `finalize`, `archive`, `cancel`).
2. UNKNOWN: whether `open -> closed` direct path should be allowed under any policy.
3. UNKNOWN: canonical correction model after finalization (reversal entry vs special amendment flow).
4. UNKNOWN: whether `archived -> active` restore is permitted and under what authority.
5. UNKNOWN: optional `cancelled` state semantics and whether it is terminal.
6. UNKNOWN: SLA/automation policy for lock/close transitions (manual only vs scheduled support).

