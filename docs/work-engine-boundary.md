# Work Engine Boundary (Phase 0 — Architecture Lock)

Status: Design contract only.
No code, no migrations, no API, no services, no UI implementation in this step.

## Purpose

Work Engine is the workflow brain / operational memory layer of NodexPro.
It owns the lifecycle of accounting-office work items across all modules and across time.

Architecture alignment:
- Core -> Commands -> Aggregate -> UI
- Workflow / memory truth source -> Work Engine only
- Financial truth source -> Accounting Base only
- Country-specific legal truth source -> Country Pack / Owner Rules only
- Communication / execution surface -> DocFlow only

This document defines boundaries only. It does not introduce schema, migrations, endpoints, command implementations, or UI.

## Mission Statement

> Work Engine remembers what work exists, who owns it, when it is due, what state it is in,
> and what the legally and operationally allowed next action is.
> Modules describe events. Work Engine decides outcome. DocFlow communicates. UI renders truth.

## Module Position (Mandatory)

```
Modules (payroll, vat, annual report, documents, accounting, ...)
        |
        | emit cross-module event (contract-based, see Section 7)
        v
+---------------------+         +---------------------+
|   Work Engine       | <-----> |   Country Pack      |
| (workflow brain)    |  reads  | (legal/period rules)|
+---------------------+ rulesets+---------------------+
        |
        | publishes intents (thread creation, request creation, reminder)
        v
+---------------------+
|   DocFlow           |
| (communication)     |
+---------------------+
        |
        v
        UI (renders aggregate truth only)
```

Forbidden direction reversals:
- DocFlow MUST NOT decide workflow state.
- DocFlow MUST NOT create work items.
- UI MUST NOT compute work state, allowed actions, due dates, SLA, counts.
- Modules MUST NOT call Work Engine directly with hidden side-writes. Modules emit events.
- Work Engine MUST NOT own financial truth (amounts, totals, balances).
- Work Engine MUST NOT own country-specific legal rules (rates, deadlines, statutory calendars).
- Work Engine MUST NOT own message delivery semantics (channel, retry, read receipts).

## Mandatory module analyze (required by NodexPro contract)

1. Financial truth? — **NO**.
   Work Engine stores references to `period_key` and `source_entity_id` and may cache `due_at` snapshots.
   Work Engine does **not** store amounts, totals, VAT, payroll values, balances, fees.
2. Country-specific rules? — **YES, via Country Pack / Owner Rules**.
   Due dates, reminder cadences, escalation timings, statutory deadlines, period calendars are read from Country Pack active ruleset and Owner legal values.
   Work Engine only stores resolved snapshots with provenance (`created_by_rule_id`, `created_by_event_id`).
3. Client / shared entity? — **YES, via Core**.
   `client_id`, `org_id`, `owner_user_id`, `assigned_user_id`, `reviewer_user_id`, RBAC, memberships are read from Core.
   Work Engine does **not** maintain a parallel auth/org/permissions model.

## Core Concepts

### 1) work_item

`work_item` is the atomic unit of operational work in NodexPro.

Conceptual properties (no schema in this step):
- tenant ownership (`org_id`)
- subject (`client_id`)
- module reference (`module_key`)
- work type (`work_type`) — module-defined category (e.g. "payroll_period", "vat_period", "annual_report")
- state (see Section 3)
- period identity (`period_key`, see Section 5)
- due date (`due_at`)
- ownership chain (`owner_user_id`, `assigned_user_id`, `reviewer_user_id`, `escalation_owner_id`)
- provenance (`source_module`, `source_entity_id`, `created_by_rule_id`, `created_by_event_id`, `created_by_user_id`)
- optimistic concurrency (`version`)
- lifecycle timestamps (`created_at`, `updated_at`)

Rules:
- A work item is a fact record in the workflow plane.
- A work item is NOT a chat thread, NOT a message, NOT a notification, NOT an accounting entry, NOT a document.
- A work item MUST always have `org_id`, `client_id`, `period_key`, `state`, `version`, `provenance`.

### 2) work_transition

`work_transition` is the immutable audit record of a state change for a work item.

Rules:
- Every state change appends one `work_transition`.
- Transitions carry actor context, source command, reason, and previous/next state.
- Transitions are append-only. They are not edited or deleted.

### 3) work_checklist_item

`work_checklist_item` is a sub-step inside a work item (e.g. required documents, sub-tasks).

Rules:
- Checklist items belong to one work item.
- Checklist items do NOT carry independent financial or legal truth.
- Checklist items can be linked to documents / threads / external entities by reference only.

### 4) work_notification

`work_notification` is an intent record: a request that someone (office or client) be informed.

Rules:
- Notifications are NOT direct sends. They are intents.
- Actual delivery is the responsibility of DocFlow / outbox / channel adapters (push/email/SMS).
- A notification stores: target audience, work item reference, severity, intent type, dedup key.

### 5) work_event

`work_event` is the incoming and outgoing event log for the Work Engine.

Rules:
- Inbound events arrive from modules via the cross-module event contract (Section 7).
- Outbound events are published when Work Engine wants DocFlow / push / outbox to act.
- Events are append-only. Replay must be safe (idempotent processing keyed by event id + dedup key).

## Section 3) State Machine (Backend-Only)

Allowed states (exact list):
- `new`
- `assigned`
- `waiting_human`
- `waiting_client`
- `client_replied`
- `review_pending`
- `approved`
- `rejected`
- `overdue`
- `escalated`
- `done`
- `archived`

Rules:
- State transitions happen ONLY through Work Engine commands.
- UI MUST NOT decide state.
- DocFlow MUST NOT decide state (DocFlow events may trigger commands that decide state).
- `overdue` and `escalated` are computed by backend rules, never by UI date logic.
- `archived` is terminal except for explicit restore command policy (out of scope in Phase 0).

Aggregate must always expose, per work item:
- `state`
- `state_label` (localized, backend-resolved)
- `allowed_actions`
- `next_actions`
- `sla_status`

## Section 4) Deduplication Policy (Mandatory)

Uniqueness rule for active work items:

> One active `work_item` per `(org_id, client_id, module_key, work_type, period_key)`.

Definition of "active":
- Any state except `done` and `archived`.

Behavior on duplicate intent:
- Do NOT create a second active work item.
- Append a `work_event` to the existing item.
- Optionally reopen the existing item if it is in a non-active terminal state, subject to explicit reopen policy (not implemented in Phase 0).
- Update existing item fields where command policy allows (e.g. extend deadline, add checklist item).

## Section 5) Period Identity (Mandatory)

Every work item MUST carry `period_key`.

Allowed format examples (illustrative, not exhaustive):
- `2026-05` (monthly)
- `2026-Q2` (quarterly)
- `2026` (annual)
- `custom:annual-report-2025` (custom-scoped period)

Rules:
- `period_key` is opaque to Work Engine business meaning. It is a stable identity string.
- Period semantics (open/closed/locked) are owned by Accounting Base periods, not Work Engine.
- Statutory due dates per `period_key` are owned by Country Pack rulesets, not Work Engine.
- Work Engine MUST NOT infer period boundaries by itself.

Rationale: Payroll May != Payroll June, VAT Jan-Feb != VAT Mar-Apr. Without `period_key`, deduplication and history are unsafe.

## Section 6) Commands (Required Catalog)

All writes to Work Engine occur through commands. No PATCH, no generic save, no monolithic batch update.

Minimum command catalog (signatures are conceptual in Phase 0, not implemented):
- `create_work_item`
- `assign_work_item`
- `reassign_work_item`
- `set_work_deadline`
- `change_work_state`
- `mark_work_waiting_client`
- `mark_work_client_replied`
- `approve_work_item`
- `reject_work_item`
- `complete_work_item`
- `archive_work_item`
- `escalate_work_item`

Rules per command:
- Tenant-scoped (org context).
- RBAC-checked via Core permissions (Section 11).
- Carry `expected_version`. On stale version: **reject with conflict**. No silent overwrites.
- Validation, normalization, business meaning are backend responsibilities.
- After successful command, the response MUST return the **full refreshed aggregate** for the affected work item / queue context (truth flow rule).
- Every critical command writes an audit record.

## Section 7) Cross-Module Event Contract (Mandatory)

Modules do not call Work Engine directly with ad-hoc payloads. Modules emit events.

Event envelope (conceptual; schema in Phase 1+):
- `event_id`
- `event_type`
- `source_module`
- `source_entity_id`
- `org_id`
- `client_id`
- `period_key`
- `occurred_at`
- `payload`
- `schema_version`
- `dedup_key`

Example event types (illustrative):
- `payroll_docs_missing`
- `vat_deadline_approaching`
- `client_uploaded_file`
- `annual_report_missing_docs`
- `invoice_overdue`

Rules:
- Event intake into Work Engine is idempotent by `event_id` + `dedup_key`.
- Work Engine decides outcome per event:
  - ignore
  - create work item (subject to deduplication policy, Section 4)
  - update existing work item
  - move state
  - create notification intent
  - emit DocFlow suggestion
- DocFlow MUST NOT make these decisions.

## Section 8) DocFlow Integration Contract

Work Engine and DocFlow communicate ONLY via:
- Work Engine emitting intents (notification intent, DocFlow request intent).
- DocFlow emitting events back into Work Engine via the cross-module event contract.

Conceptual link:
- A DocFlow thread MAY reference a `work_item_id`.
- A `work_item` MAY reference a DocFlow `thread_id` for traceability.
- Neither side performs hidden cross-domain writes into the other.

Reference flow (illustrative):
1. Work Engine moves work_item to `waiting_client`.
2. Work Engine publishes intent: "create DocFlow structured request / message draft".
3. DocFlow creates draft, accountant approves via DocFlow command.
4. DocFlow sends through outbox.
5. Client replies / uploads through portal.
6. DocFlow emits event back to Work Engine (e.g. `client_uploaded_file`, `client_replied`).
7. Work Engine command updates state to `client_replied` / `review_pending`.

This formalizes Section 8 ("Task Connection — Conceptual Only") of `docflow-thread-semantics.md`.

## Section 9) Outbox / Delivery (Forbidden Inline Sends)

Work Engine MUST NOT perform inline external sends (push / email / SMS / integrations) from within a command.

Rules:
- Command writes DB state + intent rows transactionally.
- A separate worker processes outbox rows and performs delivery.
- Delivery status is tracked separately (see Section 10).
- This applies to push, email, SMS, future integrations.

## Section 10) Delivery Lifecycle (Reference, Owned by DocFlow / Outbox Layer)

Conceptual delivery statuses (owned by the delivery layer, referenced by Work Engine for visibility):
- `pending`
- `sent`
- `delivered`
- `read`
- `failed`
- `permanent_failed`

Retry metadata (delivery layer):
- `retry_count`
- `next_retry_at`
- `failure_reason`
- `permanent_failure`
- `dead_letter_at`

Rule:
- Work Engine reads delivery status via aggregates for display, but does NOT own the retry policy implementation.

## Section 11) Office RBAC (via Core)

Work Engine permissions live in Core RBAC, not in Work Engine's own auth.

Reference permission names (Phase 0 vocabulary; binding to Core in Phase 11):
- `view_assigned_work`
- `view_org_workload`
- `assign_work`
- `reassign_work`
- `approve_drafts`
- `bulk_send`
- `bulk_archive`
- `revoke_portal_access`
- `export_evidence`
- `impersonate_client_with_audit`

Rules:
- Every command checks the relevant permission against Core RBAC.
- Permission resolution is backend-only. UI must never gate writes by local role checks.

## Section 12) Aggregates (UI Truth Source)

UI reads work data ONLY through aggregates. One screen = one aggregate response.

Required aggregate surface (conceptual, schema in Phase 12):
- `work_queue_aggregate`
- `work_item_detail_aggregate`
- `my_work_aggregate`
- `review_queue_aggregate`
- `client_work_context_aggregate`

Each aggregate MUST return ready-to-render data:
- cards / rows
- filters
- counts
- status labels (localized)
- allowed actions
- action buttons (labels + command intent ids)
- empty states
- SLA indicators

UI MUST NOT compute totals, counts, due-soon, overdue, status labels, or visibility.

## Section 13) Human Override Policy

Manual overrides are allowed and authoritative when issued by an authorized actor.

Rules:
- Manual override (e.g. extend deadline) overrides automatic state (e.g. `overdue`).
- Override MUST be auditable: `override_reason`, `overridden_by`, `overridden_at`, `previous_due_at`, `new_due_at`.
- Override does NOT silently mutate prior `work_transition` records. It appends a new transition with override metadata.

## Section 14) Tenant Billing Lifecycle (Entitlement Gate)

Work Engine commands and DocFlow sends MUST respect tenant entitlement state.

Reference statuses (owned by subscriptions/billing, consumed by Work Engine):
- `trial`
- `active`
- `grace`
- `suspended`
- `expired`
- `downgraded`

Behavior (backend-enforced; UI badges insufficient):
- `active` -> full access
- `grace` -> warnings, still functional
- `suspended` -> read-only (no commands, no sends)
- `expired` -> blocked send/create
- `downgraded` -> retain history, block new actions according to plan policy

Rule:
- Entitlement check is at the command boundary on backend. UI may show hints but never gates truth.

## Section 15) Forbidden Inside Work Engine

Work Engine MUST NOT contain:
- monetary amounts, balances, totals, VAT computations, payroll computations
- statutory rate tables, country-specific deadline math, credit point math
- direct external delivery (push/email/SMS) calls inside a command
- module-specific business processes (those live in modules and emit events)
- chat message storage (lives in DocFlow)
- accounting entries (live in Accounting Base)
- UI-driven state decisions

Also forbidden:
- bypass writes outside the command boundary
- PATCH endpoints as primary write path
- frontend-orchestrated multi-step saves
- silent overwrite without `expected_version`

## Section 16) Forbidden On Frontend (Work Engine Surface)

Frontend MUST NOT:
- compute `state` or `state_label`
- compute `allowed_actions` or `next_actions`
- compute `sla_status`, `overdue`, `due_soon`
- compute counts, badges, filters from raw lists
- compute deduplication / period semantics
- compute escalation timing
- merge multiple GETs to form workflow truth
- mutate local state after a successful command before refreshed aggregate arrives
- send commands without `expected_version`

## Section 17) Definition of Done (per Work Engine feature / tab / module)

A Work Engine feature is DONE only if ALL hold simultaneously:
1. READ — only via aggregate (Section 12).
2. WRITE — only via command (Section 6).
3. TRUTH FLOW — every command returns full refreshed aggregate; UI renders only returned truth.
4. FRONTEND — no business logic, no domain meaning, no hidden local truth.
5. SECURITY — org context applied; queries scoped by tenant; no theoretical cross-tenant path.
6. AUDIT — critical writes logged with actor, source command, prior/next state.
7. CONCURRENCY — `expected_version` enforced; conflicts rejected, not silently merged.
8. EVENT IDEMPOTENCY — inbound events idempotent by `event_id` + `dedup_key`.
9. ENTITLEMENT — billing/lifecycle gate enforced at command boundary (Section 14).
10. DELIVERY — no inline external sends; outbox path used (Section 9).

If any item fails, the feature is NOT done.

## Section 18) Transition Constraints (Current Program State)

- No automatic refactor of existing modules in this phase.
- No forced migration in this phase.
- No runtime behavior change in this phase.
- New workflow truth logic should target Work Engine design direction.
- If Work Engine integration is unavailable for a new feature, mark:
  - `TEMPORARY_WORK_ENGINE_PENDING`
  - keep implementation minimal and easy to migrate.

## Section 19) Hard Rules (Single-Page Summary)

- DocFlow is communication, not workflow brain.
- Work Engine is workflow brain, not communication.
- Accounting Base owns financial truth, not Work Engine.
- Country Pack owns country-specific rules, not Work Engine.
- Core owns clients, users, tenant, RBAC, not Work Engine.
- One screen = one aggregate.
- One user action = one command.
- Every command carries `expected_version`.
- Every external send goes through outbox.
- Every state change is auditable.
- One active work item per `(org_id, client_id, module_key, work_type, period_key)`.
- Every work item carries `period_key`.
- UI computes nothing of business meaning.

## Section 20) Open Questions / UNKNOWN

1. UNKNOWN: canonical `period_key` format catalog per module (string conventions for monthly, quarterly, annual, custom).
2. UNKNOWN: precise dedup behavior when a non-active terminal item exists (`done`, `archived`) — auto-reopen vs new item policy.
3. UNKNOWN: escalation policy authority — Owner Panel rules vs module-default vs org-level override.
4. UNKNOWN: reviewer chain semantics (single reviewer vs multi-step approval).
5. UNKNOWN: cross-period dependency model (e.g. annual report depends on monthly periods).
6. UNKNOWN: SLA grace policy interaction with `overdue` state computation.
7. UNKNOWN: bulk-action transaction model (per-item commands vs batch command with partial-failure semantics).
8. UNKNOWN: archive retention policy duration and evidence export trigger.
9. UNKNOWN: legacy DocFlow Task Center coexistence path during Work Engine rollout.

## Phase 0 Validation Checklist

- [x] Work Engine position relative to Core / Modules / Accounting Base / Country Pack / DocFlow is defined.
- [x] Mandatory module analyze answered (financial truth, country-specific, client/shared entity).
- [x] Core concepts named (work_item, work_transition, work_checklist_item, work_notification, work_event).
- [x] State machine enumerated and ownership rules stated.
- [x] Deduplication policy defined.
- [x] Period identity rule defined.
- [x] Minimum command catalog enumerated with `expected_version` rule.
- [x] Cross-module event contract envelope defined.
- [x] DocFlow integration direction (intent / event) defined; direct cross-domain writes forbidden.
- [x] Outbox rule defined.
- [x] Delivery lifecycle referenced (owned by delivery layer).
- [x] RBAC vocabulary referenced (resolved via Core in later phase).
- [x] Aggregates surface named.
- [x] Human override policy defined with audit fields.
- [x] Entitlement gate defined at command boundary.
- [x] Forbidden lists for engine and frontend defined.
- [x] Definition of Done defined.
- [x] Open questions captured.

---

Final confirmation:
**Work Engine is the workflow brain and operational memory of NodexPro. DocFlow communicates. Accounting Base holds money. Country Pack holds law. Core holds identity. Work Engine holds the work itself.**
