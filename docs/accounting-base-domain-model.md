# Accounting Base Domain Model (Phase 6 - Step 2)

Status: Conceptual domain model only (no schema/API/runtime implementation in this step).

References:
- `docs/accounting-base-boundary.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Financial truth -> Accounting Base only

---

## 1) Required domain entities

## 1.1 accounting_period

Represents a bounded accounting time window used for posting, summarization, and lifecycle controls.

## 1.2 accounting_entry

Represents the atomic financial fact record.
This is the source of truth for financial amounts.

## 1.3 accounting_category

Represents canonical accounting classification (not ad-hoc free text).

## 1.4 accounting_entry_link

Represents links between an accounting entry and external domain entities (client/module/document/etc.).
Links are metadata references, not ownership transfer of financial truth.

## 1.5 accounting_summary

Represents derived read model(s) over entries (period/category/client views).
Not source of truth.

## 1.6 accounting_activity_timeline (optional)

Represents timeline/events for accounting-related actions and state transitions.
Supports observability/audit-style traceability as a read model adjunct.

---

## 2) Source of truth rules

1. Financial truth = `accounting_entry`.
2. `accounting_summary` is derived from entries; never canonical truth.
3. Document is external evidence/link; document != accounting entry.
4. `accounting_category` is a managed entity; category != free text.
5. Any future module financial amount that becomes canonical must resolve to accounting entries.

---

## 3) Entity responsibilities

## 3.1 accounting_period

Represents:
- accounting scope window (for example reporting/posting period boundary).

Owns:
- period identity and lifecycle state boundaries.
- opening/locking/finalization semantics metadata.

Must NOT own:
- module workflow logic.
- country-specific tax rules.
- financial totals as source of truth.

## 3.2 accounting_entry

Represents:
- one normalized financial fact.

Owns:
- amount/currency/direction/type/date/category references.
- posting lifecycle/state metadata.
- canonical numeric truth for reporting/summaries.

Must NOT own:
- document lifecycle.
- module UI state.
- statutory filing behavior.

## 3.3 accounting_category

Represents:
- controlled classification node for entries.

Owns:
- category identity/code/name and optional hierarchy semantics.
- availability/active state metadata.

Must NOT own:
- module-specific workflow actions.
- free-text ad-hoc user notes as canonical type system.

## 3.4 accounting_entry_link

Represents:
- relation between entry and external entity.

Owns:
- external reference tuple (entity_type/entity_id/link_type).
- provenance metadata.

Must NOT own:
- external entity state.
- financial amount truth.

## 3.5 accounting_summary

Represents:
- precomputed/derived aggregates for read use.

Owns:
- summarized values and dimensional breakdowns.

Must NOT own:
- canonical truth for amounts.
- mutation authority over entries.

## 3.6 accounting_activity_timeline (optional)

Represents:
- event/fact history of accounting actions/transitions.

Owns:
- time-ordered facts for traceability.

Must NOT own:
- current canonical state truth for amounts.

---

## 4) Conceptual fields (non-SQL, conceptual only)

## 4.1 accounting_period (conceptual fields)

- organization_id
- period_id (stable identity)
- period_key (human/business identifier)
- period_type (for example month/quarter/year - policy TBD)
- start_date
- end_date
- lifecycle_state (open/locked/finalized semantics)
- closed_at optional
- closed_by optional
- created_at
- updated_at

## 4.2 accounting_entry (conceptual fields)

- organization_id
- entry_id
- period_id
- entry_type
- amount
- currency
- direction (debit/credit or inflow/outflow semantic - policy TBD)
- category_id
- client_id optional
- source_type optional
- source_reference optional
- posting_state (draft/posted/finalized)
- status (operational status metadata, distinct from posting_state)
- entry_date
- effective_date optional
- note optional
- created_at
- created_by
- updated_at
- updated_by

## 4.3 accounting_category (conceptual fields)

- organization_id optional (null/none for global/system category)
- category_id
- category_code
- category_name
- category_group optional
- parent_category_id optional
- is_system_category
- is_active
- sort_order optional
- created_at
- updated_at

## 4.4 accounting_entry_link (conceptual fields)

- organization_id
- link_id
- entry_id
- linked_entity_type (client/document/module_entity/etc.)
- linked_entity_id
- link_role (evidence/source/context/derived_from/etc.)
- created_at
- created_by

## 4.5 accounting_summary (conceptual fields)

- organization_id
- summary_scope (period/category/client/global)
- period_id optional
- category_id optional
- client_id optional
- totals (structured amount set)
- currency_context
- computed_at
- computed_from_version optional

## 4.6 accounting_activity_timeline (optional conceptual fields)

- organization_id
- event_id
- entry_id optional
- period_id optional
- event_type
- event_payload
- occurred_at
- actor_user_id optional

---

## 5) Relationships

1. Period has many entries.
2. Entry belongs to exactly one period.
3. Entry belongs to exactly one category (category can be system or organization-specific).
4. Entry may have zero or many links via `accounting_entry_link`.
5. Entry may link to client/document/module entities through link records.
6. Summary is calculated from entries (and period/category/client dimensions), never vice versa.
7. Category can be global/system-level or organization-specific extension.

---

## 6) Separation rules (explicit)

1. `entry_type` != `posting_state`.
2. `status` != `posting_state`.
3. document != entry.
4. summary != truth.
5. category != free text.
6. event != state.
7. local tax rule != accounting base.

Additional separation:
- module workflow action != accounting fact.
- accounting link != ownership of external entity state.

---

## 7) Future integration note (no implementation now)

Future modules may create/update accounting entries only through command/service boundary:
- module action -> module command
- module command -> accounting boundary command/service
- accounting entries updated in Accounting Base
- aggregate rebuilt for UI truth

Not implemented in this step:
- no schema
- no migrations
- no endpoints
- no module integration
- no runtime changes

---

## Open questions / UNKNOWN

1. UNKNOWN: canonical direction model (debit/credit vs inflow/outflow abstraction layer).
2. UNKNOWN: final posting lifecycle vocabulary and transitions (`draft/posted/finalized/...`).
3. UNKNOWN: multi-currency normalization and reporting conversion policy.
4. UNKNOWN: category governance model (global base + tenant overlay exact rules).
5. UNKNOWN: summary materialization strategy and recomputation trigger/version model.
6. UNKNOWN: exact link taxonomy (`link_role`) standard set.
7. UNKNOWN: how strict period locking impacts retroactive corrections workflow.

