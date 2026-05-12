# Work Engine — Domain Model (Stage 1)

Status: Design contract only. No code, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Defines the canonical entities of the Work Engine: the workflow brain and operational memory of NodexPro. This document is the source of truth for what a "work item" is, what records surround it, who is allowed to write each entity, and which truths Work Engine explicitly does NOT own.

## 2. Position in the architecture

```
Modules (payroll, vat, annual_report, documents, ...)
     |
     |  cross-module events (see work-engine-event-contract.md)
     v
+--------------------+        +--------------------+
|   Work Engine      | reads  |   Country Pack /   |
|  (workflow brain)  | <----- |   Owner Panel      |  rules + legal values
+--------------------+        +--------------------+
     |
     |  intents (notification, docflow request)
     v
+--------------------+
|     DocFlow        |   communication only; emits comm events back
+--------------------+
     |
     v
     UI  (renders aggregate truth only)
```

Truth ownership (recap):
- Work Engine: workflow memory, lifecycle, ownership, deduplication, period identity at the work plane.
- DocFlow: communication surface (threads, messages, deliveries, drafts, structured requests).
- Accounting Base: financial truth (income/expense/payment/payroll/fees/balances/totals).
- Country Pack / Owner Panel: legal/country-specific rules (deadlines, escalation cadence, statutory calendars, labels).
- Core: identity (clients, users, orgs, memberships, RBAC, modules registry).
- client_obligations: operational "what is required" plane per `(client, period)`.

## 3. Entity catalog

| Entity | One-line role |
| --- | --- |
| `work_item` | The atomic unit of operational work. |
| `work_transition` | Append-only audit of each `work_state` change. |
| `work_checklist_item` | Sub-step inside a work item (e.g. required documents, sub-tasks). |
| `work_notification` | Intent record: "someone should be notified about this work item". Never an inline send. |
| `work_event` | Append-only event log: inbound module/DocFlow events and outbound intents the engine produced. |
| `work_item_file_link` | Reference link from a work item to a Core `file_assets` row. No file storage in this domain. |

## 4. Entity: `work_item`

The atomic unit of operational work in NodexPro. Every accounting-office obligation, follow-up, review, escalation, or client request that needs to be tracked ends up represented as a `work_item`. There can be at most one **active** work item per dedup key (see `work-engine-dedup-policy.md`).

### 4.1 Required conceptual fields

| Field | Type (conceptual) | Meaning |
| --- | --- | --- |
| `id` | uuid | Stable identity. Never reused. |
| `org_id` | uuid (FK Core organizations) | Tenant ownership. Required on every read/write path. |
| `client_id` | uuid (FK Core clients) | Subject of the work. |
| `module_key` | text | Functional module the work belongs to (`payroll`, `vat`, `annual_report`, `documents`, `docflow`, ...). |
| `work_type` | text | Module-defined sub-category (`payroll_period`, `vat_period`, `annual_report`, `document_request`, `client_followup`, ...). Vocabulary is bounded per `module_key`. |
| `period_key` | text | First-class period identity (`payroll:2026-05`, `vat:2026-01-02`, `annual:2025`, ...). Opaque to Work Engine; semantics owned by emitting module + Country Pack. See dedup policy. |
| `work_state` | text (enum, 12 values) | Backend-owned lifecycle state. See `work-engine-state-machine.md`. |
| `owner_user_id` | uuid (FK Core users), nullable | Default operational owner (often the partner/senior). Not the assignee. |
| `assigned_user_id` | uuid (FK Core users), nullable | Current operational assignee performing the work. |
| `reviewer_user_id` | uuid (FK Core users), nullable | Reviewer required for `review_pending` → `approved`/`rejected` transitions. |
| `escalation_owner_id` | uuid (FK Core users), nullable | Recipient of escalations when SLA/escalation rules trigger. |
| `due_at` | timestamptz, nullable | Effective due date snapshot. Resolved at command time from Country Pack / Owner ruleset or from manual override. Never recomputed by UI. |
| `sla_status` | text (enum) | Backend-owned SLA classification: `none`, `on_track`, `due_soon`, `overdue`, `breached`. Stored or denormalized for aggregate efficiency; never computed by UI. |
| `source_module` | text | Module that emitted the originating event. |
| `source_entity_type` | text | Originating entity type in the source module (`obligation`, `docflow_thread`, `payroll_period`, ...). |
| `source_entity_id` | text | Originating entity id in the source module. Free-form string to accept non-uuid legacy ids. |
| `created_by_rule_id` | uuid, nullable | Owner Panel / Country Pack rule id, if the work was created by a rule. |
| `created_by_event_id` | uuid, nullable | The `work_event.event_id` that caused creation. |
| `created_by_user_id` | uuid (FK Core users), nullable | The human actor, if creation was a direct command. |
| `creation_source_type` | text (enum) | One of `event`, `command`, `rule`, `migration`. Disambiguates provenance. |
| `version` | int, not null, default 0 | Optimistic concurrency token. Every successful command increments `version` exactly once and the caller must send `expected_version`. |
| `created_at` | timestamptz, not null, default `now()` | Creation timestamp. |
| `updated_at` | timestamptz, not null, default `now()` | Last successful command write. |

### 4.2 Invariants

1. `org_id`, `client_id`, `module_key`, `work_type`, `period_key`, `work_state`, `version`, `creation_source_type` are NEVER null.
2. `client_id.org_id` MUST equal `work_items.org_id`. Cross-tenant references are forbidden.
3. `version` is monotonically non-decreasing and increments exactly once per successful command.
4. At most one row exists with `work_state NOT IN ('done', 'archived')` for any `(org_id, client_id, module_key, work_type, period_key)`. See dedup policy for terminal-state reopen behavior.
5. The triplet `(source_module, source_entity_type, source_entity_id)` is stored verbatim — Work Engine does not interpret module-specific entity semantics.
6. `due_at` is a stored snapshot, not a computed value. Recomputation requires an explicit command (`set_work_deadline` or rule-triggered command).
7. `sla_status` is set by Work Engine (rule worker / state machine), not by the UI and not by emitting modules.

### 4.3 Forbidden on `work_item`

- Monetary amounts, totals, balances, VAT, payroll figures.
- Country-specific labels or translated strings.
- DocFlow message bodies.
- Module-specific business attributes (those stay on `source_entity_id` rows in the module).
- Direct mutation outside the Work Engine command boundary.

## 5. Entity: `work_transition`

Append-only audit record of a `work_state` change.

### 5.1 Conceptual fields

| Field | Meaning |
| --- | --- |
| `id` | uuid identity. |
| `org_id` | tenant scope (mirrored from `work_item`). |
| `work_item_id` | FK to `work_items`. |
| `from_state` | previous `work_state`. Null only for initial creation row. |
| `to_state` | new `work_state`. |
| `kind` | enum: `command`, `automation`, `override`, `system_correction`. |
| `actor_type` | enum: `user`, `system`, `rule`. |
| `actor_user_id` | nullable; required if `actor_type = 'user'`. |
| `command` | text; the command name that drove the transition. |
| `reason_code` | optional short code. |
| `reason_text` | optional free-form reason; required when `kind = 'override'` and the transition cancels escalation, cancels a reminder, or modifies `due_at`. |
| `payload_snapshot` | jsonb; minimal context relevant to the transition (e.g. previous `due_at`, escalation_owner_id, idempotency keys). Never carries raw user PII beyond identifiers. |
| `created_at` | timestamptz, not null. |

### 5.2 Rules

- Append-only. No update. No delete.
- Exactly one row per successful state-changing command.
- Rejected commands MUST NOT produce transitions; they may produce `work_event` records of type `command_rejected` for diagnostic purposes (optional).
- Override transitions are never silently merged into automation transitions; they are distinct rows.

## 6. Entity: `work_checklist_item`

Sub-step inside a work item. Examples: required documents to upload, required confirmations, sub-tasks of an annual report.

### 6.1 Conceptual fields

| Field | Meaning |
| --- | --- |
| `id` | uuid identity. |
| `org_id` | tenant scope. |
| `work_item_id` | FK to `work_items`. |
| `position` | int ordering. |
| `key` | text; stable machine key inside this work item's checklist (`p106`, `salary_data`, ...). Unique within `work_item_id`. |
| `label_key` | text; resolves to a Country Pack / Owner label at aggregate time. Work Engine never stores localized strings. |
| `status` | enum: `pending`, `received`, `accepted`, `rejected`, `n_a`. Backend-owned. |
| `required` | boolean. |
| `linked_file_link_id` | nullable FK to `work_item_file_links` for the supporting file, if any. |
| `linked_source_entity_type` | optional text; the module entity providing the truth (e.g. `obligation_id`, `docflow_request_item_id`). |
| `linked_source_entity_id` | optional text. |
| `version` | int, optimistic concurrency for checklist-level commands. |
| `created_at`, `updated_at` | timestamps. |

### 6.2 Rules

- A checklist item does not carry financial or legal truth.
- Mutation only via Work Engine checklist commands.
- A checklist status change MUST be reflected by a `work_event` of type `checklist_item_updated`, never a transition on the parent work item (unless the parent state machine moves as a consequence — which is decided by Work Engine, not by the UI).

## 7. Entity: `work_notification`

Intent record. "Someone should be notified about this work item." Work Engine never performs inline external sends. Delivery is the responsibility of the outbox / DocFlow / channel adapters.

### 7.1 Conceptual fields

| Field | Meaning |
| --- | --- |
| `id` | uuid identity. |
| `org_id` | tenant scope. |
| `work_item_id` | FK. |
| `audience` | enum: `office_assigned`, `office_reviewer`, `office_escalation_owner`, `office_owner`, `client_portal`, `client_external`. |
| `intent_type` | enum: `assignment_changed`, `due_soon`, `overdue`, `escalation`, `client_action_required`, `client_reply_received`, `review_required`, `approval_decision`, `state_changed`. |
| `severity` | enum: `info`, `warn`, `urgent`. |
| `dedup_key` | text; idempotency key for the intent (`work_item_id + intent_type + bucket_period`). Same intent in the same bucket is suppressed. |
| `payload_snapshot` | jsonb; data needed by downstream delivery (e.g. due_at snapshot, role context). No localized strings. |
| `delivery_status` | enum: `pending_dispatch`, `dispatched_to_outbox`, `cancelled`. Work Engine view only; the actual channel delivery state lives in the delivery layer (see `delivery_status` separation rule). |
| `created_by_transition_id` | optional FK to the `work_transition` that produced this intent. |
| `created_at`, `updated_at` | timestamps. |

### 7.2 Rules

- A notification is an intent, not a send.
- `delivery_status` on `work_notification` ≠ `delivery_status` on `client_message_deliveries`. The DocFlow/outbox layer owns channel delivery state; Work Engine only tracks the intent lifecycle until handoff.
- Suppression by `dedup_key` is mandatory.

## 8. Entity: `work_event`

Append-only event log. Two roles in one table:

1. Inbound: every cross-module event accepted into Work Engine (see `work-engine-event-contract.md`).
2. Outbound (optional): records of intents emitted to DocFlow / outbox (e.g. "asked DocFlow to create a structured request").

### 8.1 Conceptual fields

| Field | Meaning |
| --- | --- |
| `id` | uuid identity (server-side). |
| `event_id` | uuid; idempotency identity from the envelope. Unique per `(org_id, source_module, event_id)`. |
| `org_id` | tenant scope. |
| `direction` | enum: `inbound`, `outbound`. |
| `source_module` | text. |
| `source_entity_type` | text. |
| `source_entity_id` | text. |
| `event_type` | text. |
| `client_id` | uuid. |
| `period_key` | text, nullable for events not tied to a period (rare; must be justified). |
| `work_item_id` | uuid, nullable. Populated after Work Engine matches the event to a work item or creates one. |
| `occurred_at` | timestamptz from the envelope. |
| `received_at` | timestamptz when Work Engine accepted the event. |
| `emitted_by_type` | enum: `user`, `system`, `rule`. |
| `emitted_by_id` | uuid, nullable. |
| `schema_version` | int. |
| `idempotency_key` | text. |
| `payload` | jsonb (envelope payload). |
| `processing_status` | enum: `accepted`, `ignored_duplicate`, `ignored_policy`, `failed`. |
| `processing_outcome` | text; short code (`created_work_item`, `appended_to_existing`, `reopened`, `state_advanced`, `no_op`, ...). |
| `processing_error` | text, nullable. |

### 8.2 Rules

- Append-only.
- Idempotency: unique on `(org_id, source_module, idempotency_key)` AND on `(org_id, event_id)`. Either collision => reject as duplicate.
- Direction `outbound` rows are optional and used for traceability of work_engine → DocFlow/outbox intents.

## 9. Entity: `work_item_file_link`

Reference from a work item (or checklist item) to a Core `file_assets` row. Work Engine does not store files.

### 9.1 Conceptual fields

| Field | Meaning |
| --- | --- |
| `id` | uuid identity. |
| `org_id` | tenant scope. |
| `work_item_id` | FK. |
| `checklist_item_id` | optional FK to `work_checklist_items`. |
| `file_asset_id` | FK to Core `file_assets`. |
| `link_role` | enum: `evidence`, `request_attachment`, `office_attachment`, `client_upload`. |
| `created_by_event_id` | optional FK to `work_events.id`. |
| `created_by_user_id` | optional FK. |
| `created_at` | timestamptz. |

### 9.2 Rules

- Files themselves remain Core-owned; Work Engine only references.
- A file can be linked to multiple work items / checklist items if multiple work contexts share evidence; this is by intent, not by accident.
- Tenant scope must match the `file_assets.org_id`.

## 10. Ownership rules (single page, mandatory)

1. **Only Work Engine commands** write `work_items`, `work_transitions`, `work_checklist_items`, `work_notifications`, `work_events`, `work_item_file_links`. No bypass. No PATCH.
2. **Modules emit events only.** Modules MUST NOT call Work Engine internal services. Modules MUST NOT write Work Engine tables. Modules MAY read Work Engine aggregates via the aggregate API.
3. **DocFlow emits communication events only.** DocFlow emits, for example, `client_replied`, `client_uploaded_file`, `office_message_sent`, `request_acknowledged`. DocFlow MUST NOT decide `work_state`. DocFlow MAY reference `work_item_id` on its own rows (after Phase 2 link).
4. **No reverse writes from `client_tasks`.** During the migration phases (see schema design doc), the data flow is one-directional: events → Work Engine → projection into `client_tasks`. The legacy obligations→tasks reconciler is removed by the end of Phase 3.
5. **`client_tasks` becomes a projection only.** After Phase 3, the legacy table is read-only from the application perspective; only Work Engine maintains it for legacy UI compatibility, and even that ends at Phase 5.
6. **Country Pack / Owner Panel** provide rule and label snapshots. Work Engine reads at command time and stores resolved snapshots on the row with provenance (`created_by_rule_id`, `due_at`).
7. **Accounting Base** owns financial truth. Work Engine has no `amount`, no `total`, no `currency`, no `vat`, no `payroll_value` columns anywhere.
8. **Core** owns identity. Work Engine references `users.id`, `clients.id`, `organizations.id`, `file_assets.id` via FK; it does not maintain a parallel auth/permission model.

## 11. Out-of-scope for this document

- Specific permission codes (covered in `work-engine-boundary.md` Section 11; final binding in RBAC seeds during implementation).
- Aggregate JSON shape (covered later, when `work-engine-aggregates.md` is created).
- Exact SQL schema (covered conceptually in `work-engine-schema-design.md`).
- Country-specific period_key catalog (lives in Country Pack).

## 12. Hard rules summary

- Every entity carries `org_id`.
- Every mutable row carries `version` and is written via command only.
- `work_items` has at most one active row per dedup key.
- Every state change is recorded in `work_transitions`.
- Every notification is an intent, not a send.
- Every event accepted is recorded in `work_events` with idempotency.
- File storage stays in Core; Work Engine only links.

---

End of domain model contract.
