# Work Engine — Deduplication Policy (Stage 1)

Status: Design contract only. No code, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Defines the canonical deduplication rule for `work_items` and the consumer behavior of Work Engine when duplicate or competing events arrive. This is the single rule that prevents three things:

1. Duplicate active work items for the same logical responsibility.
2. Race conditions between modules emitting overlapping events.
3. Silent loss of operational truth across module restarts/replays.

## 2. Dedup key

The canonical dedup key for any `work_item` is the tuple:

```
(org_id, client_id, module_key, work_type, period_key)
```

Constraints on the dedup key:

- All five components are mandatory.
- All five are stored verbatim on the `work_items` row.
- Database-level partial uniqueness:
  > UNIQUE on `(org_id, client_id, module_key, work_type, period_key)` WHERE `work_state NOT IN ('done', 'archived')`.
- Application-level validation MUST also enforce the same rule and reject conflicting commands/events with a deterministic error code.

The dedup key does NOT include:

- `assigned_user_id` (assignment changes do not create a new work item).
- `due_at` (deadline changes do not create a new work item).
- `source_entity_id` (multiple source entities can map to one logical work item across time).

## 3. Definition of active

A work item is **active** if and only if `work_state NOT IN ('done', 'archived')`.

The active classification is used in two places:

- The partial UNIQUE constraint above.
- KPI / queue aggregates ("active by client", "active overdue", "active assigned to me").

Terminal states (`done`, `archived`) are excluded from the uniqueness constraint, which is what enables the reopen policy in Section 6 to function safely.

## 4. Behavior on event arrival

When an event arrives that matches the dedup key (after consumer-side computation of the key from the envelope), Work Engine applies exactly one of the following outcomes. The decision is fully backend-owned and MUST NOT be re-derived in UI or modules.

### 4.1 Decision flow (conceptual)

```
1. Compute dedup_key from event.
2. Look up active row with that dedup_key.
3. If active row exists:
     a. Consult per-event-type policy table (Section 5):
        - ignore_duplicate
        - append_event_only
        - merge_fields  (e.g. extend deadline, add checklist item)
        - advance_state
4. Else if a terminal (done/archived) row exists:
     a. Consult terminal policy (Section 6):
        - new_item        (period semantics allow distinct cycles, e.g. new period_key)
        - reopen          (explicit policy, governed by overrideable settings)
        - reject          (cannot duplicate; emit failure event)
5. Else:
     - create new work_item; append work_event; first work_transition (kind='command'/'automation').
```

All outcomes append a row to `work_events` regardless of whether the work item changed.

### 4.2 Outcome catalog

| Outcome | Effect on `work_items` | Effect on `work_transitions` | Effect on `work_events` |
| --- | --- | --- | --- |
| `created_work_item` | Insert new row. `version=0`. | One transition `null → new` (or `null → assigned` if the same command both creates and assigns). | One `inbound` row, outcome `created_work_item`. |
| `appended_to_existing` | No row change, or merge_fields update with `version+=1` if state-relevant. | Transition appended only if `work_state` changed. | One `inbound` row, outcome `appended_to_existing`. |
| `state_advanced` | `work_state` updated, `version+=1`. | One transition. | One `inbound` row, outcome `state_advanced`. |
| `merge_fields` | Non-state fields updated (e.g. `due_at`, checklist), `version+=1`. | No transition (no state change). | One `inbound` row, outcome `merge_fields`. |
| `reopened` | Terminal row reactivated, `work_state → assigned`, `version+=1`. | One transition `kind='override'`. | One `inbound` row, outcome `reopened`. |
| `ignored_duplicate` | None. | None. | One `inbound` row, outcome `ignored_duplicate`. |
| `ignored_policy` | None. | None. | One `inbound` row, outcome `ignored_policy`. |
| `failed` | None. | None. | One `inbound` row, outcome `failed`, with `processing_error`. |

## 5. Per-event-type behavior (Stage 1 reference)

Per `(source_module, event_type)`, the consumer policy is one of: `create_or_append`, `append_only`, `merge_fields`, `advance_state`, `signal_only`, `ignore_if_terminal`.

| Event type (example) | If no active row | If active row | If only terminal row(s) exist |
| --- | --- | --- | --- |
| `obligation_opened` | `created_work_item` | `appended_to_existing` | New cycle → `created_work_item` only if `period_key` differs; same `period_key` → `ignored_policy` (the prior cycle was already concluded). |
| `obligation_status_changed` | `created_work_item` (recover from missing parent) | `merge_fields` or `state_advanced` per status mapping | `ignored_policy`. |
| `obligation_closed` | `ignored_policy` | `state_advanced` → `done` | `ignored_duplicate`. |
| `payroll_docs_missing` | `created_work_item` | `merge_fields` (extend checklist) and possibly `state_advanced` → `waiting_client` | `ignored_policy` unless reopen policy allows. |
| `payroll_docs_received` | `ignored_policy` | `state_advanced` → `client_replied`/`waiting_human` per rule | `ignored_policy`. |
| `payroll_period_closed` | `ignored_policy` | `state_advanced` → `done` | `ignored_duplicate`. |
| `vat_period_opened` | `created_work_item` | `appended_to_existing` | `created_work_item` if `period_key` differs; else `ignored_policy`. |
| `vat_deadline_approaching` | `signal_only` (logged; rule worker handles SLA) | `signal_only`/`merge_fields` (`sla_status`) | `signal_only`. |
| `vat_period_filed` | `ignored_policy` | `state_advanced` → `done` | `ignored_duplicate`. |
| `annual_report_opened` | `created_work_item` | `appended_to_existing` | `created_work_item` if `period_key` differs. |
| `annual_report_missing_docs` | `created_work_item` | `merge_fields` + state to `waiting_client` | `ignored_policy`. |
| `annual_report_submitted` | `ignored_policy` | `state_advanced` → `done` | `ignored_duplicate`. |
| `client_uploaded_file` | `created_work_item` only if event carries enough context, otherwise `ignored_policy` | `merge_fields` (link file), possibly `state_advanced` → `client_replied` | `ignored_policy`. |
| `office_uploaded_evidence` | `ignored_policy` | `merge_fields` (link file) | `ignored_policy`. |
| `client_replied` (docflow) | `ignored_policy` | `state_advanced` → `client_replied` if currently `waiting_client` | `ignored_policy`. |
| `office_message_sent` (docflow) | `ignored_policy` | `append_only` | `ignored_policy`. |
| `document_request_acknowledged` | `ignored_policy` | `append_only`, optional `merge_fields` | `ignored_policy`. |
| `thread_resolved_by_office` (docflow) | `ignored_policy` | `signal_only`; Work Engine does NOT auto-close on this signal | `ignored_policy`. |
| `ruleset_activated` / `rule_effective` / `rule_retracted` | `signal_only` | `signal_only` | `signal_only`. |
| `period_locked` / `period_reopened` (accounting_base, future) | `signal_only` | `signal_only` | `signal_only`. |

Rule for additions: every new `(source_module, event_type)` MUST appear in this table before the consumer can route it.

## 6. Terminal-state handling

When the only matching rows are terminal:

- `done`: A new event with the same `period_key` is `ignored_policy` by default. Reopen requires explicit `reopen_work_item` command (override). Automation MUST NOT reopen by itself unless a Country Pack rule explicitly authorizes it for the work type (e.g. `vat_period_reopened` after `period_reopened`).
- `archived`: A new event with the same `period_key` is `ignored_policy`. Manual restore is out of scope for Stage 1.

If the incoming event's `period_key` differs from the terminal row's `period_key`, the items are by definition different logical cycles and the new item is created normally.

## 7. Period identity — examples

The dedup key is only meaningful with a stable, well-formed `period_key`. Work Engine treats it as opaque, but emitters MUST conform to the following examples (illustrative; full canonical catalog lives in Country Pack):

### 7.1 Payroll — May 2026

- `module_key = 'payroll'`
- `work_type = 'payroll_period'`
- `period_key = 'payroll:2026-05'`

Distinct from May 2027 (`payroll:2027-05`) and from June 2026 (`payroll:2026-06`). The June payroll work item is a different active item; both can be active simultaneously without violating uniqueness.

### 7.2 VAT — Jan–Feb 2026 (bi-monthly cycle, IL)

- `module_key = 'vat'`
- `work_type = 'vat_period'`
- `period_key = 'vat:2026-01-02'`

Distinct from `vat:2026-03-04`. The cycle granularity (bi-monthly vs monthly) is determined by Country Pack; Work Engine only stores the resolved `period_key`.

### 7.3 Annual report — 2025

- `module_key = 'annual_report'`
- `work_type = 'annual_report'`
- `period_key = 'annual:2025'`

A single active item per tax year per client. Re-emission of `annual_report_missing_docs` for the same year merges checklist items rather than creating a second work item.

### 7.4 Ad-hoc / non-period work (rare)

For work that has no statutory period (e.g. a one-off office task created manually), the period_key is still required and uses the convention:

- `period_key = 'adhoc:<yyyy-mm-dd>:<short-slug>'` where the slug is supplied by the originating command.

This preserves the invariant that every work item has a `period_key`.

## 8. Period key normalization rules

- Lowercase ASCII, hyphenated date components, colon separators.
- `module_key` prefix (`payroll:`, `vat:`, `annual:`, `adhoc:`, ...).
- No localization, no whitespace, no embedded JSON.
- Validation regex (conceptual): `^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_:-]*$`.
- Emitters that cannot form a compliant `period_key` MUST NOT emit; instead, the work is not deduplicated and Work Engine has no responsibility for that emission.

## 9. Conflict cases and resolution

### 9.1 Two emitters target the same dedup key concurrently

- The first transaction to commit wins.
- The second emitter receives an outcome of `appended_to_existing` (or whatever the per-event-type policy specifies given the now-existing active row).
- No second active row is ever created.

### 9.2 Late event for a now-terminal row

- `ignored_policy` is the default.
- The event is still recorded for audit.
- Rules MAY override this only by explicit catalog entry (Section 5).

### 9.3 Same `(source_module, idempotency_key)` arriving twice

- Handled by the event contract (`ignored_duplicate`) before dedup logic runs.
- No work item state is touched.

### 9.4 Mismatched `period_key` between event and existing active row

- The events are different cycles. A new active row is created. This is correct behavior, not a conflict.

### 9.5 Tenant mismatch

- `failed` outcome. Event recorded with `processing_error = 'tenant_mismatch'`. No work item touched.

## 10. Forbidden on UI / modules

- Computing dedup decisions on the frontend.
- Inferring "is this a new period" without `period_key`.
- Modules constructing work items locally and pushing them via PATCH/save.
- Splitting one logical work item into two by varying `work_type` for the same `(module, period)` cycle.

## 11. Hard rules summary

- Dedup key: `(org_id, client_id, module_key, work_type, period_key)`.
- Active = `work_state NOT IN ('done','archived')`.
- Database-level partial UNIQUE enforces this.
- Every accepted event appends `work_events` with an explicit outcome.
- Terminal-state reopen is policy-gated, never automatic without rule authorization.
- `period_key` is mandatory, normalized, and opaque to Work Engine.

---

End of deduplication policy.
