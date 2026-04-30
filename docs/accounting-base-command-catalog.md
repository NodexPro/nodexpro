# Accounting Base Command Catalog (Phase 6 - Step 5)

Status: Conceptual command catalog only.  
No API endpoints, handlers, migrations, DB changes, UI, or module integration in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-lifecycle-state-model.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Every write = explicit command
- 1 user action = 1 command
- No generic PATCH / save-all
- After command: backend rebuilds full aggregate
- UI renders backend truth only

---

## Global command rules

Applies to all Accounting Base commands:

1. Tenant safety:
   - `organization_id` context is mandatory and enforced.
   - All referenced entities must belong to same org (except system categories where allowed).

2. Authorization:
   - Permission check is mandatory per command.

3. Validation:
   - Inputs are validated and normalized server-side.
   - Command must fail atomically on validation/precondition violation.

4. Lifecycle guards:
   - Period and entry lifecycle constraints must be enforced by command preconditions.

5. Side effects:
   - Domain mutation + audit fact emission + aggregate rebuild trigger.

6. Aggregate truth flow:
   - command -> execute -> rebuild aggregate -> return refreshed truth.
   - no partial local truth assumptions.

7. Forbidden command behavior:
   - no country-specific tax logic (Israel/VAT/payroll-tax engines)
   - no direct summary manual truth edits
   - no bypass of service/command boundary

---

## 1) Period commands

## 1.1 `create_period`

Purpose:
- Create a new accounting period in `open` state.

Allowed actor / permission:
- accounting admin or equivalent period-management permission.

Required input (conceptual):
- organization_id (context)
- period_start
- period_end
- period_label
- base_currency

Backend validation:
- `period_start <= period_end`
- no forbidden overlap/duplication policy violations (policy TBD)
- label uniqueness per organization

State/lifecycle preconditions:
- none beyond integrity and policy constraints.

Side effects:
- new period persisted
- optional summary initialization scheduling (derived)

Audit event emitted:
- `period_created`

Aggregate refresh requirement:
- must return/rebuild refreshed aggregate view that includes new period state.

Forbidden behavior:
- implicit close/lock during creation
- creating period without org scope

---

## 1.2 `lock_period`

Purpose:
- Transition period from `open` to `locked`.

Allowed actor / permission:
- privileged accounting role with lock permission.

Required input:
- organization_id
- period_id
- reason optional

Backend validation:
- period exists and belongs to org
- actor has lock permission

State/lifecycle preconditions:
- period status must be `open`

Side effects:
- period status update to `locked`
- optional pending integrity checks/snapshot triggers (derived)

Audit event emitted:
- `period_locked`

Aggregate refresh requirement:
- refreshed aggregate must reflect locked status and updated action availability.

Forbidden behavior:
- locking closed period directly
- silent lock without audit

---

## 1.3 `close_period`

Purpose:
- Transition period from `locked` to `closed`.

Allowed actor / permission:
- privileged accounting role with close permission.

Required input:
- organization_id
- period_id
- reason optional

Backend validation:
- period exists and belongs to org
- actor has close permission
- close prerequisites satisfied (policy TBD)

State/lifecycle preconditions:
- period status must be `locked` (default policy)

Side effects:
- period status set `closed`
- closure metadata (`closed_at`, `closed_by`) updated

Audit event emitted:
- `period_closed`

Aggregate refresh requirement:
- refreshed aggregate required to update lifecycle status + allowed actions.

Forbidden behavior:
- direct summary edits as close substitute
- closing without lifecycle checks

---

## 1.4 `reopen_period` (optional/future)

Purpose:
- Exceptional transition from `closed` back to mutable lifecycle state.

Allowed actor / permission:
- admin/special override permission only.

Required input:
- organization_id
- period_id
- mandatory reason

Backend validation:
- strict authorization and policy checks
- period belongs to org

State/lifecycle preconditions:
- period status must be `closed`

Side effects:
- period state updated per policy (for example `locked` or `open`)
- exceptional control trail persisted

Audit event emitted:
- `period_reopened`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- reopen by regular role
- reopen without reason/audit trail

---

## 2) Entry commands

## 2.1 `create_entry`

Purpose:
- Create a new accounting entry in `draft` posting state and `active` status (default policy).

Allowed actor / permission:
- entry create permission.

Required input:
- organization_id
- period_id
- category_id
- amount
- currency
- direction
- entry_type
- entry_date
- optional: client_id, description, source_type, source_reference

Backend validation:
- period exists and belongs to org
- category exists and belongs to org or is system category
- amount/currency/direction validity
- required fields present
- if period closed -> deny unless special permission (default deny)

State/lifecycle preconditions:
- period must allow entry creation (typically `open`)

Side effects:
- entry inserted
- derived summaries invalidation/recompute scheduling

Audit event emitted:
- `entry_created`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- entry creation without period/category/amount/currency
- embedding local tax engine behavior

---

## 2.2 `update_draft_entry`

Purpose:
- Update mutable fields of draft entry.

Allowed actor / permission:
- entry update permission.

Required input:
- organization_id
- entry_id
- patch fields (allowed draft-edit fields only)

Backend validation:
- entry exists and belongs to org
- patch whitelist enforced
- referenced period/category/client consistency checks

State/lifecycle preconditions:
- `posting_state` must be `draft`
- entry period must not be `closed` unless special override policy allows

Side effects:
- entry updated
- summary recompute trigger

Audit event emitted:
- `entry_updated`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- updating finalized entry as draft
- unrestricted patch of immutable fields

---

## 2.3 `finalize_entry`

Purpose:
- Transition entry posting lifecycle `draft -> finalized`.

Allowed actor / permission:
- finalize permission.

Required input:
- organization_id
- entry_id
- optional finalization note/reason

Backend validation:
- entry exists and belongs to org
- required entry fields complete and valid
- period lifecycle permits finalization (not closed, unless special policy)

State/lifecycle preconditions:
- `posting_state` must be `draft`

Side effects:
- posting_state becomes `finalized`
- finalization metadata updated
- derived summary recompute

Audit event emitted:
- `entry_finalized`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- finalizing invalid/incomplete entry
- silent finalization without audit

---

## 2.4 `archive_entry`

Purpose:
- Transition entry status `active -> archived` (status dimension).

Allowed actor / permission:
- archive permission (or elevated accounting role).

Required input:
- organization_id
- entry_id
- optional reason

Backend validation:
- entry exists and belongs to org
- permission check

State/lifecycle preconditions:
- status must be `active`
- posting_state-specific policy check (if any)

Side effects:
- status updated to archived
- summary inclusion rules applied/recomputed by policy

Audit event emitted:
- `entry_archived`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- using archive to bypass posting lifecycle restrictions

---

## 2.5 `cancel_entry` (optional/future)

Purpose:
- Transition entry status to `cancelled` under explicit policy.

Allowed actor / permission:
- privileged cancel permission.

Required input:
- organization_id
- entry_id
- mandatory cancellation reason

Backend validation:
- entry exists and belongs to org
- cancellation policy constraints

State/lifecycle preconditions:
- status must be cancellable under policy (TBD)

Side effects:
- status updated to cancelled
- downstream recompute/signaling

Audit event emitted:
- `entry_cancelled`

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- cancellation without reason
- implicit replacement of correction workflow

---

## 3) Category commands

## 3.1 `create_category`

Purpose:
- Create organization-specific accounting category.

Allowed actor / permission:
- category management permission.

Required input:
- organization_id
- code
- name
- category_type
- optional parent_category_id

Backend validation:
- unique code per org
- parent category validity and tenant compatibility
- category_type allowed set

State/lifecycle preconditions:
- none beyond policy validation.

Side effects:
- new category persisted

Audit event emitted:
- `category_created` (recommended)

Aggregate refresh requirement:
- refreshed aggregate/category list required.

Forbidden behavior:
- free-text-only category use without managed entity

---

## 3.2 `update_category`

Purpose:
- Update mutable category attributes.

Allowed actor / permission:
- category management permission.

Required input:
- organization_id
- category_id
- patch (allowed fields only)

Backend validation:
- category exists and is editable under policy
- uniqueness and hierarchy integrity

State/lifecycle preconditions:
- category must be active/editable by policy.

Side effects:
- category updated

Audit event emitted:
- `category_updated` (recommended)

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- mutating system category without special authority

---

## 3.3 `deactivate_category`

Purpose:
- Mark category as inactive while preserving historical references.

Allowed actor / permission:
- category management permission.

Required input:
- organization_id
- category_id
- optional reason

Backend validation:
- category exists and belongs to org or permitted system scope
- deactivation policy checks

State/lifecycle preconditions:
- category currently active.

Side effects:
- category status set inactive

Audit event emitted:
- `category_deactivated` (recommended)

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- hard delete that breaks historical entries.

---

## 4) Link commands

## 4.1 `link_entry_to_entity`

Purpose:
- Add relation from accounting entry to external entity.

Allowed actor / permission:
- entry/link management permission.

Required input:
- organization_id
- accounting_entry_id
- target_entity_type
- target_entity_id
- relation_type

Backend validation:
- entry exists and belongs to org
- target entity exists and belongs to org (or allowed system scope)
- relation uniqueness/idempotency policy

State/lifecycle preconditions:
- entry exists; link operation allowed by lifecycle policy.

Side effects:
- link row created

Audit event emitted:
- `entry_linked` (recommended)

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- linking to missing target entity
- treating document link as entry creation

---

## 4.2 `unlink_entry_from_entity`

Purpose:
- Remove relation between entry and target entity.

Allowed actor / permission:
- entry/link management permission.

Required input:
- organization_id
- accounting_entry_id
- target_entity_type
- target_entity_id
- relation_type optional (if disambiguation required)

Backend validation:
- link exists and belongs to org
- permission check

State/lifecycle preconditions:
- link must be removable under policy.

Side effects:
- link row removed/deactivated per policy

Audit event emitted:
- `entry_unlinked` (recommended)

Aggregate refresh requirement:
- refreshed aggregate required.

Forbidden behavior:
- unlink operation used to hide canonical entry truth.

---

## 5) Summary commands / jobs

Rule:
- summaries are derived artifacts.
- summaries are not manually edited as truth.

Conceptual operations:
- `recompute_summary` (system/internal job or privileged maintenance command)

Purpose:
- recompute derived summary rows from current entries.

Allowed actor / permission:
- system job, or privileged maintenance operator.

Required input:
- organization_id
- scope/period selector

Backend validation:
- tenant scope correctness
- selector validity

State/lifecycle preconditions:
- source entries available.

Side effects:
- summary rows recalculated/replaced

Audit event emitted:
- `summary_recomputed` (recommended)

Aggregate refresh requirement:
- refreshed aggregate for affected scope if interactive command path.

Forbidden behavior:
- direct manual editing of summary totals as source truth.

---

## Required validations (cross-command checklist)

1. organization_id tenant scoping is mandatory.
2. Permission check is mandatory.
3. Period exists and belongs to org.
4. Category exists and belongs to org or is system category.
5. Finalized entry cannot be updated as draft.
6. Closed period cannot be mutated without special permission.
7. Link target entity must exist and be valid.
8. Entry creation requires period/category/amount/currency (and other required fields).
9. No Israel/VAT/payroll-tax-specific rules inside Accounting Base commands.

---

## Aggregate refresh contract (mandatory)

After every successful command:
1. mutate domain state in command boundary
2. emit audit fact
3. rebuild backend aggregate/read model
4. return refreshed truth for UI full replace

Forbidden:
- partial post-command frontend truth patching as final model
- command response without refreshed aggregate path

Implemented internal response shape:

```ts
{
  ok: true,
  command: "<command_name>",
  refreshed: {
    aggregate_key: "<specific_aggregate_key>",
    aggregate: <full aggregate object>
  },
  additional_refreshed?: [
    {
      aggregate_key: "<secondary_aggregate_key>",
      aggregate: <full aggregate object>
    }
  ]
}
```

Implemented command -> refreshed aggregate mapping:
- `create_period` -> `accounting_periods_workspace_aggregate`
- `lock_period` -> `accounting_periods_workspace_aggregate`
- `close_period` -> `accounting_periods_workspace_aggregate`
- `create_entry` -> `accounting_entries_workspace_aggregate` (+ optional `accounting_entry_details_aggregate`)
- `update_draft_entry` -> `accounting_entries_workspace_aggregate` (+ optional `accounting_entry_details_aggregate`)
- `finalize_entry` -> `accounting_entries_workspace_aggregate` (+ optional `accounting_entry_details_aggregate`)
- `archive_entry` -> `accounting_entries_workspace_aggregate` (+ optional `accounting_entry_details_aggregate`)
- `create_category` -> `accounting_categories_workspace_aggregate`
- `update_category` -> `accounting_categories_workspace_aggregate`
- `deactivate_category` -> `accounting_categories_workspace_aggregate`
- `link_entry_to_entity` -> `accounting_entry_details_aggregate` (fallback: `accounting_entries_workspace_aggregate`)
- `unlink_entry_from_entity` -> `accounting_entry_details_aggregate` (fallback: `accounting_entries_workspace_aggregate`)
- `recompute_summary` -> `accounting_summary_workspace_aggregate`

---

## Command/Event/State separation notes

- Command: intent to mutate domain.
- State: current domain lifecycle/status values.
- Event: immutable fact/audit record of what happened.

Rules:
- command != event
- event != state
- state transitions are command-driven and event-recorded

---

## Command catalog summary

Period:
- `create_period`, `lock_period`, `close_period`, optional/future `reopen_period`

Entry:
- `create_entry`, `update_draft_entry`, `finalize_entry`, `archive_entry`, optional/future `cancel_entry`

Category:
- `create_category`, `update_category`, `deactivate_category`

Links:
- `link_entry_to_entity`, `unlink_entry_from_entity`

Summary:
- internal/system `recompute_summary` only (derived model maintenance)

---

## Risky decisions

1. Whether reopen is allowed and under what authority can weaken closure guarantees if not strict.
2. Archive/cancel semantics can overlap without crisp policy.
3. Summary recompute timing (sync vs async) impacts consistency expectations.
4. Link permissions may become too broad without strict target-type policy.
5. Category update/deactivate policy can break reporting consistency if historical semantics are not preserved.

---

## Open questions / UNKNOWN

1. UNKNOWN: final permission matrix per command (role mapping).
2. UNKNOWN: exact idempotency policy for commands (especially link/unlink and recompute).
3. UNKNOWN: whether `recompute_summary` is command endpoint, internal job, or both.
4. UNKNOWN: correction strategy for finalized entries (reversal-only vs privileged amendment).
5. UNKNOWN: policy for period overlap and forced close/reopen exceptional flows.
6. UNKNOWN: long-term event taxonomy naming standard for non-required category/link/summary events.

