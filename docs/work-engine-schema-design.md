# Work Engine — Schema Design (Stage 1)

Status: Design contract only. No SQL, no migrations, no services, no UI.
Architecture alignment: Core → Commands → Aggregate → UI.

## 1. Purpose

Table-level design for the Work Engine domain. Documents the purpose, key columns, important constraints, required indexes, RLS / org scoping, and audit expectations for each table. SQL migration authors should be able to translate this directly into Supabase migration files without inventing architecture.

## 2. Table catalog

1. `work_items`
2. `work_transitions`
3. `work_checklist_items`
4. `work_notifications`
5. `work_events`
6. `work_item_file_links`

All tables live in the `public` schema, like the rest of the codebase (`client_message_threads`, `client_obligations`, ...). All tables enable RLS. All writes occur via service-role through Work Engine commands; reads via RLS-scoped membership queries.

## 3. Table: `work_items`

### 3.1 Purpose

Canonical row representing one unit of operational work in NodexPro. The atomic unit that all queues, KPIs, and aggregates filter against.

### 3.2 Key columns (conceptual; types are SQL-friendly hints, not migration syntax)

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | Primary key, default `gen_random_uuid()`. |
| `org_id` | uuid | no | FK → `organizations(id) ON DELETE CASCADE`. |
| `client_id` | uuid | no | FK → `clients(id) ON DELETE CASCADE`. |
| `module_key` | text | no | Module code (matches `modules.code` for registered modules where applicable; free text for legacy/internal). |
| `work_type` | text | no | Module-defined sub-category. |
| `period_key` | text | no | Normalized period identity (see dedup policy). |
| `work_state` | text | no | Enum check (12 values). |
| `owner_user_id` | uuid | yes | FK → `users(id) ON DELETE SET NULL`. |
| `assigned_user_id` | uuid | yes | FK → `users(id) ON DELETE SET NULL`. |
| `reviewer_user_id` | uuid | yes | FK → `users(id) ON DELETE SET NULL`. |
| `escalation_owner_id` | uuid | yes | FK → `users(id) ON DELETE SET NULL`. |
| `due_at` | timestamptz | yes | Snapshot. |
| `sla_status` | text | no, default `'none'` | Enum check (`none`, `on_track`, `due_soon`, `overdue`, `breached`). |
| `source_module` | text | no | Originating module key. |
| `source_entity_type` | text | no | Originating entity type. |
| `source_entity_id` | text | no | Originating entity id (text to allow non-uuid legacy). |
| `created_by_rule_id` | uuid | yes | Rule reference (Country Pack / Owner Panel). |
| `created_by_event_id` | uuid | yes | FK → `work_events(event_id)` is not enforced strictly (event_id is the envelope id; see notes); stored verbatim for traceability. |
| `created_by_user_id` | uuid | yes | FK → `users(id)`. |
| `creation_source_type` | text | no | Enum (`event`, `command`, `rule`, `migration`). |
| `version` | int | no, default `0` | Optimistic concurrency. |
| `created_at` | timestamptz | no, default `now()` | |
| `updated_at` | timestamptz | no, default `now()` | Triggered by `set_updated_at()`. |

### 3.3 Important constraints

- CHECK on `work_state` against the exact 12-value enum.
- CHECK on `sla_status` against the 5-value enum.
- CHECK on `creation_source_type` against the 4-value enum.
- PARTIAL UNIQUE on `(org_id, client_id, module_key, work_type, period_key)` WHERE `work_state NOT IN ('done', 'archived')`. This is the database-level enforcement of the dedup invariant.
- CHECK that `client_id`'s organization matches `org_id`. Enforced via trigger or by application boundary (preferred: trigger that joins to `clients.organization_id`).
- CHECK that `version >= 0`.

### 3.4 Indexes

Required:

- `(org_id, client_id, module_key, work_state)` — queue + dedup lookups.
- `(org_id, assigned_user_id, work_state)` WHERE `work_state NOT IN ('done', 'archived')` — "my work" queue.
- `(org_id, reviewer_user_id, work_state)` WHERE `work_state = 'review_pending'` — review queue.
- `(org_id, work_state, due_at)` — overdue / SLA scanning by rule worker.
- `(org_id, client_id, period_key)` — per-client per-period lookups.
- `(org_id, source_module, source_entity_id)` — module → work item lookup.
- `(org_id, updated_at DESC)` — recent activity feeds.

Optional / performance:

- Partial index `(org_id) WHERE work_state IN ('overdue', 'escalated')` for KPI counts.

### 3.5 RLS / org scoping

- Enable RLS.
- SELECT policy: `org_id IN (SELECT public.organizations_for_current_auth_user())` (matches DocFlow pattern).
- INSERT / UPDATE / DELETE: rely on service-role from backend commands; no client-side write policies in Stage 1.
- Trigger ensures `org_id` immutability after insert.

### 3.6 Audit expectations

- Every state change AND every override appends a `work_transitions` row.
- Routine field-only updates (`due_at` change, assignment change, sla_status recompute) append a `work_transitions` row with `from_state = to_state` for traceability of attribute history, with `kind` set appropriately (`command`, `automation`, `override`, `system_correction`).
- Cross-system audit (via shared `writeAudit` / `audit_events`) is also written for high-signal commands (`create_work_item`, `escalate_work_item`, `reopen_work_item`, all overrides).

## 4. Table: `work_transitions`

### 4.1 Purpose

Append-only audit row for every state-changing or override-classified action on a `work_item`. Reconstructs the full lifecycle narrative of a work item.

### 4.2 Key columns

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK. |
| `org_id` | uuid | no | FK → `organizations`. Mirrored from parent. |
| `work_item_id` | uuid | no | FK → `work_items(id) ON DELETE CASCADE`. |
| `from_state` | text | yes | Null only for initial-creation row. |
| `to_state` | text | no | New state. |
| `kind` | text | no | Enum (`command`, `automation`, `override`, `system_correction`). |
| `actor_type` | text | no | Enum (`user`, `system`, `rule`). |
| `actor_user_id` | uuid | yes | Required when `actor_type = 'user'`. |
| `command` | text | no | Command name that produced the transition. |
| `reason_code` | text | yes | Short machine code. |
| `reason_text` | text | yes | Free-form; required when override kind matches policy (deadline, escalation cancel, reminder cancel). |
| `payload_snapshot` | jsonb | no, default `'{}'` | Includes `previous_value` / `new_value` for relevant fields. |
| `created_at` | timestamptz | no, default `now()` | |

### 4.3 Constraints

- Append-only at application layer.
- No `UPDATE` allowed (enforced by REVOKE on `authenticated`; service-role bypass acceptable but commands MUST NOT update rows).
- CHECK `kind` enum and `actor_type` enum.
- CHECK `(actor_type = 'user') => actor_user_id IS NOT NULL`.
- CHECK `(kind = 'override') => reason_text IS NOT NULL` for the policy-mandated cases (deadline change, escalation cancel, reminder cancel). Enforced at command layer to keep CHECK simple; alternative is a trigger that inspects `payload_snapshot.field`.

### 4.4 Indexes

- `(work_item_id, created_at ASC)` — full history of a work item.
- `(org_id, created_at DESC)` — recent activity org-wide.
- `(org_id, kind, created_at DESC)` — override / system_correction audits.

### 4.5 RLS

- Enable RLS. SELECT policy mirrors `work_items`.
- No client-side INSERT/UPDATE/DELETE policies.

### 4.6 Audit expectations

- This table IS the audit log of the work plane.
- Cross-system audit (`writeAudit`) MAY also record high-signal commands; this table is the primary source.

## 5. Table: `work_checklist_items`

### 5.1 Purpose

Sub-step inside a work item.

### 5.2 Key columns

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK. |
| `org_id` | uuid | no | FK. |
| `work_item_id` | uuid | no | FK → `work_items(id) ON DELETE CASCADE`. |
| `position` | int | no, default `0` | Ordering. |
| `key` | text | no | Stable machine key inside this work item's checklist. |
| `label_key` | text | no | Resolves to localized label via Country Pack. |
| `status` | text | no, default `'pending'` | Enum (`pending`, `received`, `accepted`, `rejected`, `n_a`). |
| `required` | boolean | no, default `true` | |
| `linked_file_link_id` | uuid | yes | FK → `work_item_file_links(id) ON DELETE SET NULL`. |
| `linked_source_entity_type` | text | yes | |
| `linked_source_entity_id` | text | yes | |
| `version` | int | no, default `0` | |
| `created_at`, `updated_at` | timestamptz | no | |

### 5.3 Constraints

- UNIQUE `(work_item_id, key)`.
- CHECK on `status` enum.
- CHECK that `org_id` matches the parent `work_items.org_id` (trigger).

### 5.4 Indexes

- `(work_item_id, position)`.
- `(org_id, status)`.

### 5.5 RLS

- Enable RLS. SELECT policy mirrors `work_items`.

### 5.6 Audit expectations

- Status changes recorded as `work_events` of type `checklist_item_updated` (inbound from internal logic) OR as `work_transitions` with `from_state = to_state` on the parent work item if no state movement was triggered; preferred Stage 1 approach is `work_events`.

## 6. Table: `work_notifications`

### 6.1 Purpose

Intent records for notifying audiences about work-item changes. Decoupled from actual delivery.

### 6.2 Key columns

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK. |
| `org_id` | uuid | no | FK. |
| `work_item_id` | uuid | no | FK. |
| `audience` | text | no | Enum (see domain model §7). |
| `intent_type` | text | no | Enum (see domain model §7). |
| `severity` | text | no | Enum (`info`, `warn`, `urgent`). |
| `dedup_key` | text | no | Idempotency key for the intent. |
| `payload_snapshot` | jsonb | no, default `'{}'` | |
| `delivery_status` | text | no, default `'pending_dispatch'` | Enum (`pending_dispatch`, `dispatched_to_outbox`, `cancelled`). |
| `created_by_transition_id` | uuid | yes | FK → `work_transitions(id) ON DELETE SET NULL`. |
| `created_at`, `updated_at` | timestamptz | no | |

### 6.3 Constraints

- UNIQUE `(org_id, work_item_id, dedup_key)` — prevents duplicate intent in the same dedup bucket.
- CHECK enums for `audience`, `intent_type`, `severity`, `delivery_status`.

### 6.4 Indexes

- `(org_id, delivery_status, created_at)` — outbox-pickup-style scan.
- `(work_item_id, created_at DESC)`.
- `(org_id, intent_type, severity)`.

### 6.5 RLS

- Enable RLS. SELECT policy mirrors `work_items`.

### 6.6 Audit expectations

- Cancellation requires a linked `work_transitions` row (override) referenced via `created_by_transition_id` of the cancel record OR — simpler — by appending a new `work_notifications`-side audit table; Stage 1 design: append a `work_events` row of type `notification_cancelled` referencing the notification id.

## 7. Table: `work_events`

### 7.1 Purpose

Append-only event log. Records every cross-module event accepted by Work Engine and, optionally, outbound intents the engine emitted.

### 7.2 Key columns

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | Server PK. |
| `event_id` | uuid | no | Envelope identity. |
| `org_id` | uuid | no | FK. |
| `direction` | text | no | Enum (`inbound`, `outbound`). |
| `source_module` | text | no | |
| `source_entity_type` | text | no | |
| `source_entity_id` | text | no | |
| `event_type` | text | no | |
| `client_id` | uuid | yes | Nullable for events without a client (e.g. ruleset activation org-wide). |
| `period_key` | text | yes | Nullable for `period_optional` event types. |
| `work_item_id` | uuid | yes | Populated after routing. FK → `work_items(id) ON DELETE SET NULL`. |
| `occurred_at` | timestamptz | no | From envelope. |
| `received_at` | timestamptz | no, default `now()` | Server time. |
| `emitted_by_type` | text | no | Enum (`user`, `system`, `rule`). |
| `emitted_by_id` | uuid | yes | |
| `schema_version` | int | no | |
| `idempotency_key` | text | no | |
| `payload` | jsonb | no, default `'{}'` | |
| `processing_status` | text | no | Enum (`accepted`, `ignored_duplicate`, `ignored_policy`, `failed`). |
| `processing_outcome` | text | no | Short code (catalog in domain model + dedup policy). |
| `processing_error` | text | yes | Populated when `processing_status = 'failed'`. |

### 7.3 Constraints

- UNIQUE `(org_id, event_id)` — envelope idempotency.
- UNIQUE `(org_id, source_module, idempotency_key)` — emitter-namespace idempotency.
- CHECK enums.
- CHECK direction `outbound` rows MAY have null `idempotency_key` if generated internally with a different uniqueness strategy (Stage 1: still require non-null, generated by engine).

### 7.4 Indexes

- `(org_id, source_module, event_type, received_at DESC)`.
- `(org_id, work_item_id, received_at DESC)` — full event trail per work item.
- `(org_id, client_id, period_key, received_at DESC)` — period-cycle audit.
- `(org_id, processing_status, received_at DESC)` — operations.

### 7.5 RLS

- Enable RLS. SELECT policy mirrors `work_items`. INSERT via service-role only.

### 7.6 Audit expectations

- This table IS the audit log of the event plane.
- Failures are stored too (`processing_status = 'failed'`).

## 8. Table: `work_item_file_links`

### 8.1 Purpose

Reference from a work item (or checklist item) to a Core `file_assets` row.

### 8.2 Key columns

| Column | Type hint | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK. |
| `org_id` | uuid | no | FK. |
| `work_item_id` | uuid | no | FK → `work_items(id) ON DELETE CASCADE`. |
| `checklist_item_id` | uuid | yes | FK → `work_checklist_items(id) ON DELETE SET NULL`. |
| `file_asset_id` | uuid | no | FK → `file_assets(id) ON DELETE RESTRICT`. |
| `link_role` | text | no | Enum (`evidence`, `request_attachment`, `office_attachment`, `client_upload`). |
| `created_by_event_id` | uuid | yes | Traceability. |
| `created_by_user_id` | uuid | yes | FK → `users(id)`. |
| `created_at` | timestamptz | no | |

### 8.3 Constraints

- UNIQUE `(work_item_id, file_asset_id, link_role)` to prevent accidental duplicate links of identical role.
- CHECK `link_role` enum.
- Trigger ensuring `org_id` matches both `work_items.org_id` and `file_assets.org_id`.

### 8.4 Indexes

- `(org_id, work_item_id)`.
- `(file_asset_id)`.

### 8.5 RLS

- Enable RLS. SELECT policy mirrors `work_items`.

### 8.6 Audit expectations

- Link creations recorded as `work_events` of type `file_linked`.
- Removals (if implemented later) recorded as `file_unlinked`; not in Stage 1 scope.

## 9. Cross-table integrity

- `org_id` must match across parent and child rows. Enforced by triggers.
- Cascades:
  - `work_items` deletion cascades to `work_transitions`, `work_checklist_items`, `work_notifications`, `work_item_file_links`.
  - `work_events.work_item_id` becomes `NULL` on parent delete (kept for audit).
- `file_assets` deletion is RESTRICTED when a `work_item_file_links` row exists (matches existing DocFlow attachments behavior in 087).

## 10. Migration relationship to legacy workflow-like tables

Stage 1 of Work Engine introduces new tables. Legacy tables (`client_tasks`, `client_obligations`, `client_message_threads`) are NOT modified in Phase 1.

### Phase 1 — Create new Work Engine tables

- Create `work_items`, `work_transitions`, `work_checklist_items`, `work_notifications`, `work_events`, `work_item_file_links`.
- Add RLS, indexes, triggers, enums, constraints.
- Seed RBAC permission codes (in a follow-up migration).
- Do NOT replace `client_tasks`.
- Do NOT touch `client_message_threads`.
- Do NOT touch `client_obligations`.

### Phase 2 — DocFlow threads gain `work_item_id` link

- Add nullable column `work_item_id` (uuid, FK → `work_items(id) ON DELETE SET NULL`) to `client_message_threads`.
- Add index on `(org_id, work_item_id, updated_at DESC)`.
- Update DocFlow consumer to set `work_item_id` when a thread is created in response to a Work Engine intent.
- Do NOT change `thread_status` semantics. DocFlow's status remains independent.
- Do NOT migrate historical threads automatically. Backfill is opt-in per module.

### Phase 3 — `client_tasks` becomes a projection written by Work Engine

- Add columns to `client_tasks` to mark provenance: `projected_from_work_item_id` (uuid, FK, nullable) and `projection_version` (int).
- Backfill: map active `client_tasks` rows that were generated by the obligations→tasks reconciler to `work_items` via `(source_type, source_id, task_type) → (source_module, source_entity_id, work_type, period_key from obligations)`.
- Switch the projection writer from the legacy reconciler to Work Engine.
- Old reconciler is left in place but is FEATURE-FLAGGED OFF.

### Phase 4 — Old obligation→task reconciler removed

- Remove the legacy reconciler from `client-obligations-tasks-core.service.ts`.
- `client_tasks` is written exclusively by Work Engine.
- Begin migrating legacy UI screens to Work Engine aggregates.

### Phase 5 — Legacy task UI migrates to Work Engine aggregates

- Each consumer screen of `client_tasks` switches to a Work Engine aggregate (`my_work_aggregate`, `client_work_context_aggregate`, ...).
- After the last consumer migrates, `client_tasks` is frozen (no new writes) and eventually retired in a separate explicit migration.
- Retiring `client_tasks` is out of scope for the Stage 1 documents.

Phase ordering is not negotiable. Skipping Phase 2 or 3 collapses Work Engine back into a parallel system (the architecture-decision warning from option B).

## 11. Hard rules summary

- Every Work Engine table includes `org_id` and enables RLS.
- Every mutable table includes `version` and is written via command boundary only.
- Dedup is database-level via partial UNIQUE on `work_items`.
- Event idempotency is database-level via two UNIQUE constraints on `work_events`.
- Audit is database-resident in `work_transitions` and `work_events`.
- Files are referenced, not stored.
- `client_tasks` becomes a projection only after Phase 3; never a source of truth.
- DocFlow gains a `work_item_id` link (Phase 2) but never owns workflow state.

---

End of schema design contract.
