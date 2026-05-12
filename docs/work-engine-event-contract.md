# Work Engine — Cross-Module Event Contract (Stage 1)

Status: Design contract only. No code, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Defines the single cross-module event envelope used by all NodexPro modules and by DocFlow to communicate with Work Engine.

Direction:
- Modules and DocFlow EMIT events.
- Work Engine CONSUMES events and decides outcomes.
- DocFlow does NOT decide `work_state`. DocFlow events are facts about communication; Work Engine derives any state implication.

Goal:
- One envelope. One idempotency rule. One tenant model. Implementation can build adapters/consumers without re-deriving architecture.

## 2. Envelope

Every cross-module event accepted by Work Engine MUST conform to this envelope.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `event_id` | uuid | yes | Globally unique identity assigned by the emitter. Same value on retry. |
| `org_id` | uuid | yes | Tenant scope. Must match the org of the referenced `client_id`. |
| `client_id` | uuid | yes | Subject client. Must belong to `org_id`. |
| `source_module` | text | yes | Emitting module key (`payroll`, `vat`, `annual_report`, `documents`, `docflow`, `obligations`, `country_pack`, `accounting_base_view`). |
| `source_entity_type` | text | yes | Emitting entity type within `source_module` (e.g. `obligation`, `payroll_period`, `vat_period`, `annual_report_year`, `docflow_thread`, `docflow_message`, `document_request_item`). |
| `source_entity_id` | text | yes | Stable id of the source entity. UUID preferred; text accepted to support legacy ids. |
| `event_type` | text | yes | Module-defined event type from the catalog in Section 7. |
| `period_key` | text | yes for work-creating event types; conditionally optional for pure-signal events (see Section 5) | First-class period identity. See `work-engine-dedup-policy.md`. |
| `occurred_at` | timestamptz | yes | When the event actually happened in the source module. |
| `emitted_by_type` | enum (`user`, `system`, `rule`) | yes | Type of actor in the source module. |
| `emitted_by_id` | uuid | conditional | Required when `emitted_by_type = 'user'` or `'rule'`. Null when `'system'`. |
| `schema_version` | int | yes | Envelope schema version. Starts at `1`. |
| `payload` | jsonb | yes | Module-specific structured payload. See Section 8 for catalog. |
| `idempotency_key` | text | yes | Idempotency key in the emitter's namespace. Combined with `(org_id, source_module)` to form the dedup unique constraint server-side. |

## 3. Idempotency rules

Two independent dedup constraints. Both MUST hold.

1. **By `event_id`:** unique on `(org_id, event_id)`. Re-submission of the same event with the same `event_id` MUST be accepted at the API boundary but produce no additional state change. Outcome is recorded as `ignored_duplicate` in `work_events`.
2. **By `idempotency_key`:** unique on `(org_id, source_module, idempotency_key)`. Emitters MUST design `idempotency_key` to uniquely identify the *intent* of the emission, not the *retry attempt*. Two different `event_id`s carrying the same `(source_module, idempotency_key)` MUST be treated as duplicates.

Outcome rules on duplicate:
- The first event wins (creates / updates / advances).
- Subsequent duplicates are recorded as `processing_status = ignored_duplicate` in `work_events`.
- No transition is written on duplicates.

Replay safety:
- An emitter MAY safely replay the same event indefinitely.
- A consumer worker SHOULD be designed such that crash-restart between accepting and processing is recoverable by replay (at-least-once semantics from emitter, exactly-once effect server-side via the two dedup constraints).

## 4. Tenant scoping

- `org_id` is mandatory on every event.
- The consumer MUST verify that `client_id` belongs to `org_id` (FK + scope check). Mismatch ⇒ reject with `processing_status = failed`, reason `tenant_mismatch`. The event row is still written (as audit), but no state change occurs.
- Cross-tenant references in any payload field are forbidden. Validation rejects them.

## 5. Direction rules

| Emitter | Allowed event types | Forbidden |
| --- | --- | --- |
| Module (e.g. `payroll`) | Module-domain events (`payroll_docs_missing`, `payroll_period_closed`, ...) | Setting `work_state` in payload. Inventing dedup key on Work Engine's behalf. |
| `obligations` | Operational requirement events (`obligation_opened`, `obligation_status_changed`, `obligation_closed`) | Deciding lifecycle on Work Engine's behalf. |
| `docflow` | Communication-domain events (`client_replied`, `client_uploaded_file`, `office_message_sent`, `document_request_acknowledged`, `thread_resolved_by_office`) | Deciding `work_state`. Asserting work item identity beyond `work_item_id` link payload field. |
| `country_pack` / `owner_panel` | Rule lifecycle events (`ruleset_activated`, `rule_effective`, `rule_retracted`) | Direct writes to work items. |
| `accounting_base` (future) | View events (`period_locked`, `period_reopened`) — read-only signals to Work Engine | Anything else. |

Work Engine MAY emit **outbound** events of `direction = outbound` for outbox/DocFlow intents. Those rows live in the same `work_events` table for traceability but are NOT consumed by Work Engine itself.

## 6. Validation rules

A submitted event passes validation only if ALL hold:

1. All required envelope fields present and well-typed.
2. `org_id` exists; `client_id` exists; `client_id.org_id = org_id`.
3. `source_module` is in the registered catalog.
4. `event_type` is in the registered catalog for the given `source_module`.
5. `schema_version` is supported (server keeps a `supported_versions` list per `(source_module, event_type)`).
6. `period_key` matches the format expected for the `(source_module, event_type)` per `work-engine-dedup-policy.md`, OR `event_type` is explicitly classified as `period_optional`.
7. `idempotency_key` and `event_id` are non-empty and within length limits.

Failure modes:
- Envelope-level failure: HTTP/transport 4xx (or equivalent intake error). Event NOT written to `work_events`.
- Domain-level failure (tenant mismatch, unknown work item, etc.): Event IS written to `work_events` with `processing_status = failed` and `processing_error` populated. Aids debugging.

## 7. Event type catalog (registered set, Stage 1)

This is the registered initial catalog. Adding new types requires updating this document and the consumer router.

### 7.1 `source_module = 'obligations'`

| `event_type` | Trigger | `period_key` required? | Typical Work Engine outcome |
| --- | --- | --- | --- |
| `obligation_opened` | A new obligation row is inserted by the obligations engine. | yes | Create work item if no active dedup match; else append event. |
| `obligation_status_changed` | Obligation status moves to a workflow-relevant value (`pending_material`, `not_reported`, `reported_late`, `not_paid`, ...). | yes | Update work item; possibly advance `work_state`. |
| `obligation_closed` | Obligation closed (resolved / not applicable). | yes | Move work item to `done` or `archived` per policy. |

### 7.2 `source_module = 'payroll'`

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `payroll_docs_missing` | Required salary data not received for the period. | yes | Create / update `payroll_period` work item; ensure `waiting_client` checklist drives. |
| `payroll_docs_received` | Salary data received. | yes | Advance work item; update checklist. |
| `payroll_period_closed` | Period closed in module. | yes | Move work item to `done`. |

### 7.3 `source_module = 'vat'`

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `vat_period_opened` | New VAT period appears in the module. | yes | Create work item if dedup allows. |
| `vat_deadline_approaching` | Country Pack rule says deadline is near. | yes | Update `sla_status`; emit reminder intent. |
| `vat_period_filed` | VAT report filed. | yes | Move work item to `done`. |

### 7.4 `source_module = 'annual_report'`

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `annual_report_opened` | Annual cycle started for the client/year. | yes (`annual:YYYY`) | Create work item. |
| `annual_report_missing_docs` | Required documents missing. | yes | Update checklist; ensure `waiting_client`. |
| `annual_report_submitted` | Submission completed. | yes | Move work item to `done`. |

### 7.5 `source_module = 'documents'`

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `client_uploaded_file` | A file was uploaded by the client portal. | yes (period of the work context) | Append event; possibly satisfy checklist item; possibly move state. |
| `office_uploaded_evidence` | Office uploaded supporting evidence. | yes | Append event; link file via `work_item_file_link`. |

### 7.6 `source_module = 'docflow'`

DocFlow events are pure communication facts. Work Engine derives any state implication.

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `client_replied` | Client posted a message in a thread linked to a work item. | yes if the thread is linked to a work item; otherwise optional | Append event; move work item `waiting_client` → `client_replied`. |
| `office_message_sent` | Office sent a published message. | conditional | Append event only. No `work_state` change unless rule policy specifies one. |
| `document_request_acknowledged` | Client acknowledged the structured request. | yes | Append event; possibly advance `waiting_client` substate. |
| `thread_resolved_by_office` | Office resolved a thread. | conditional | DocFlow communication fact only; Work Engine may move work item to `review_pending`/`done` per rule policy, never automatically. |

### 7.7 `source_module = 'country_pack'` / `'owner_panel'`

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `ruleset_activated` | New active ruleset for org. | no (event_type is `period_optional`) | Rebuild snapshots on next command for affected work items. No direct state change. |
| `rule_effective` | A specific rule becomes effective. | no | Reference for future automation; no immediate write. |
| `rule_retracted` | Rule retracted. | no | Future automation respects retraction; prior snapshots stay. |

### 7.8 `source_module = 'accounting_base'` (future, view-only)

| `event_type` | Trigger | `period_key` required? | Typical outcome |
| --- | --- | --- | --- |
| `period_locked` | Accounting period locked. | yes | Read-only signal. Work Engine may use to constrain commands (e.g. block reopen) — only after explicit binding. |
| `period_reopened` | Accounting period reopened. | yes | Read-only signal. |

## 8. Payload conventions

- `payload` is always a JSON object.
- Field names use `snake_case`.
- Sensitive payloads (e.g. document body, message body) MUST NOT be inlined. References (`source_entity_id`, `file_asset_id`, `thread_id`, `message_id`) are stored instead.
- Country-specific labels MUST NOT appear in payload (resolved at aggregate time from Country Pack).
- Numeric financial amounts MUST NOT appear in payload (Accounting Base scope).

## 9. Routing / consumer behavior (conceptual, no implementation)

For each accepted event, Work Engine MUST:

1. Persist the envelope into `work_events` with `direction='inbound'`, `processing_status='accepted'` (or `ignored_*`/`failed`).
2. Compute the dedup key (see `work-engine-dedup-policy.md`).
3. Look up active work item by dedup key.
4. Apply one of the routing outcomes:
   - `created_work_item` — new active row.
   - `appended_to_existing` — existing active row updated; transition appended only if state changed.
   - `reopened` — terminal row reactivated, subject to reopen policy.
   - `state_advanced` — state machine moved.
   - `no_op` — event recorded but no derived change (e.g. signal event).
   - `ignored_duplicate` — by event_id or idempotency_key.
   - `ignored_policy` — accepted but suppressed (e.g. event from retracted rule).
   - `failed` — validation passed at envelope level but domain-level reject (tenant mismatch, missing client, etc.).
5. Stamp `processing_outcome` on the `work_events` row.

## 10. Schema versioning

- `schema_version` starts at `1` for all event types in Stage 1.
- A new schema version per `(source_module, event_type)` REQUIRES updating this document and the registered `supported_versions` map.
- Backward-incompatible changes require adding a new `event_type` rather than bumping `schema_version`, unless the previous version is explicitly deprecated and retired with a migration plan.

## 11. Hard rules

- Modules emit; Work Engine consumes.
- DocFlow does NOT decide `work_state`.
- Every event is tenant-scoped via `org_id` and verified against `client_id.org_id`.
- Every event is idempotent on `(org_id, event_id)` AND `(org_id, source_module, idempotency_key)`.
- Every accepted event is recorded in `work_events`, including duplicates and failures.
- Modules MUST NOT carry localized strings, financial amounts, or country rules in `payload`.
- Adding a new event type requires updating this catalog first.

---

End of cross-module event contract.
