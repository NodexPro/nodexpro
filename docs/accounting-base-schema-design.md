# Accounting Base Schema Design (Phase 6 - Step 3)

Status: Proposed schema design only.  
No migrations, no DB changes, no runtime/API/UI implementation in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`

Architecture constraints:
- Core -> Commands -> Aggregate -> UI
- Financial truth source = `accounting_entries`
- `accounting_summaries` are derived read model
- documents are external evidence, not accounting truth
- no country-specific tax logic in Accounting Base

---

## Global schema principles

1. Tenant safety:
   - `organization_id` required on tenant-owned tables/rows.
   - Every tenant query must be scoped by `organization_id`.

2. Financial truth:
   - Canonical amounts live in `accounting_entries`.
   - Summaries do not replace entries as truth.

3. Separation:
   - `posting_state` and `status` are separate dimensions.
   - Category is managed entity (FK), not free text classification.
   - Link table handles entry relations to external entities (document/client/module).

4. Transition-safe:
   - Design only; integration and migration deferred.

---

## 1) `accounting_periods`

Purpose:
- Defines accounting time windows for posting/finalization boundaries.

### Fields

- `id` (required)
  - meaning: period identity.
- `organization_id` (required)
  - meaning: tenant owner.
- `period_start` (required)
  - meaning: inclusive start date of period.
- `period_end` (required)
  - meaning: inclusive end date of period.
- `period_label` (required)
  - meaning: display/business label (for example `2026-04`).
- `status` (required)
  - meaning: period lifecycle state (for example open/locked/finalized).
- `base_currency` (required)
  - meaning: reporting currency context for the period.
- `created_at` (required)
- `updated_at` (required)
- `closed_at` (nullable)
  - meaning: close/finalize timestamp.
- `closed_by` (nullable)
  - meaning: actor user id who closed/finalized period.

### Key constraints (recommended)

- PK: (`id`)
- FK: `organization_id -> organizations.id`
- FK (nullable): `closed_by -> users.id`
- CHECK: `period_start <= period_end`
- CHECK: status in allowed period states.

### Tenant isolation rules

- tenant-owned row, must always include and filter by `organization_id`.
- Unique labels/scopes should be constrained per organization.

### Important indexes (recommended)

- `idx_accounting_periods_org` (`organization_id`)
- `idx_accounting_periods_org_status` (`organization_id`, `status`)
- `idx_accounting_periods_org_range` (`organization_id`, `period_start`, `period_end`)
- UNIQUE (recommended): (`organization_id`, `period_label`)

### Must NOT be stored here

- entry-level amounts/totals
- VAT/payroll-tax/local-country filing logic
- module workflow state machines

---

## 2) `accounting_categories`

Purpose:
- Managed accounting classification taxonomy (system + organization-specific).

### Fields

- `id` (required)
- `organization_id` (nullable for system/global categories)
  - meaning: null means global/system category.
- `code` (required)
  - meaning: stable category code.
- `name` (required)
  - meaning: category display name.
- `category_type` (required)
  - meaning: semantic class (income/expense/etc. in neutral accounting terms).
- `status` (required)
  - meaning: active/inactive lifecycle.
- `is_system` (required)
  - meaning: true for global managed catalog rows.
- `parent_category_id` (nullable)
  - meaning: hierarchy parent.
- `created_at` (required)
- `updated_at` (required)

### Key constraints (recommended)

- PK: (`id`)
- FK (nullable self): `parent_category_id -> accounting_categories.id`
- CHECK: consistency between `is_system` and `organization_id`:
  - if `is_system = true` then `organization_id is null`
  - if `is_system = false` then `organization_id is not null`
- CHECK: `code` non-empty normalized format.

### Tenant isolation rules

- system categories are global read-only base.
- org categories are tenant-owned.
- tenant queries should return `(is_system=true) OR (organization_id=current_org)`.

### Important indexes (recommended)

- `idx_accounting_categories_org` (`organization_id`)
- `idx_accounting_categories_type_status` (`category_type`, `status`)
- UNIQUE (recommended):
  - (`organization_id`, `code`) for tenant categories
  - (`code`) for system categories (enforced with partial unique index)

### Must NOT be stored here

- free-text per-entry override as source of truth
- module-specific workflow ownership
- tax filing logic

---

## 3) `accounting_entries`

Purpose:
- Canonical source-of-truth financial facts.

### Fields

- `id` (required)
- `organization_id` (required)
- `period_id` (required)
- `entry_type` (required)
  - meaning: accounting entry semantic type.
- `status` (required)
  - meaning: operational/state dimension (separate from posting lifecycle).
- `posting_state` (required)
  - meaning: draft/posted/finalized lifecycle state.
- `client_id` (nullable)
  - meaning: optional association to client entity.
- `category_id` (required)
- `description` (nullable)
- `entry_date` (required)
- `amount` (required)
- `currency` (required)
- `direction` (required)
  - meaning: financial direction model (policy TBD).
- `source_type` (nullable)
  - meaning: provenance source class.
- `created_by` (required)
- `created_at` (required)
- `updated_at` (required)
- `finalized_at` (nullable)
- `finalized_by` (nullable)
- `is_archived` (required)

### Key constraints (recommended)

- PK: (`id`)
- FK: `organization_id -> organizations.id`
- FK: `period_id -> accounting_periods.id`
- FK: `category_id -> accounting_categories.id`
- FK (nullable): `client_id -> clients.id`
- FK: `created_by -> users.id`
- FK (nullable): `finalized_by -> users.id`
- CHECK: `amount >= 0` (or signed strategy TBD, see open questions)
- CHECK: `posting_state` in allowed values
- CHECK: `status` in allowed values
- CHECK: `currency` format constraint
- CHECK: if `finalized_at is not null` then `posting_state` is finalized-like.

### Tenant isolation rules

- hard tenant ownership via `organization_id`.
- row must not reference period/category/client of another organization.
- service/command boundary must validate cross-entity org consistency.

### Important indexes (recommended)

- `idx_accounting_entries_org` (`organization_id`)
- `idx_accounting_entries_org_period` (`organization_id`, `period_id`)
- `idx_accounting_entries_org_client_date` (`organization_id`, `client_id`, `entry_date`)
- `idx_accounting_entries_org_category_date` (`organization_id`, `category_id`, `entry_date`)
- `idx_accounting_entries_org_posting_state` (`organization_id`, `posting_state`)
- `idx_accounting_entries_org_status` (`organization_id`, `status`)
- `idx_accounting_entries_org_archived` (`organization_id`, `is_archived`)

### Must NOT be stored here

- statutory filing status fields (VAT/reporting engine outcomes)
- country-specific tax semantics
- document blobs/content
- frontend-derived totals

---

## 4) `accounting_entry_links`

Purpose:
- Generic relation model between entries and external entities.

### Fields

- `id` (required)
- `organization_id` (required)
- `accounting_entry_id` (required)
- `target_entity_type` (required)
  - meaning: linked target class (`document`, `client`, `module_entity`, etc.)
- `target_entity_id` (required)
- `relation_type` (required)
  - meaning: relation role (`evidence`, `source`, `context`, etc.)
- `created_by` (required)
- `created_at` (required)

### Key constraints (recommended)

- PK: (`id`)
- FK: `organization_id -> organizations.id`
- FK: `accounting_entry_id -> accounting_entries.id`
- FK: `created_by -> users.id`
- CHECK: `target_entity_type` in supported enum
- CHECK: `relation_type` in supported enum
- UNIQUE (recommended): (`organization_id`, `accounting_entry_id`, `target_entity_type`, `target_entity_id`, `relation_type`)

### Tenant isolation rules

- link row tenant must match linked entry tenant.
- target resolution must be tenant-scoped in service boundary.

### Important indexes (recommended)

- `idx_entry_links_org_entry` (`organization_id`, `accounting_entry_id`)
- `idx_entry_links_org_target` (`organization_id`, `target_entity_type`, `target_entity_id`)
- `idx_entry_links_org_relation` (`organization_id`, `relation_type`)

### Must NOT be stored here

- financial amounts (truth belongs in entries)
- target entity state copy as canonical truth
- enforced 1:1 document ownership of entry

---

## 5) `accounting_summaries`

Purpose:
- Derived aggregate snapshots/read model for fast workspace/report rendering.

### Fields

- `id` (required)
- `organization_id` (required)
- `period_id` (required)
- `summary_scope` (required)
  - meaning: scope dimension (period/category/client/global etc.)
- `summary_key` (required)
  - meaning: deterministic grouping key within scope.
- `amount_total` (required)
- `currency` (required)
- `calculated_at` (required)

### Key constraints (recommended)

- PK: (`id`)
- FK: `organization_id -> organizations.id`
- FK: `period_id -> accounting_periods.id`
- CHECK: allowed `summary_scope` values
- UNIQUE (recommended): (`organization_id`, `period_id`, `summary_scope`, `summary_key`, `currency`)

### Tenant isolation rules

- tenant-owned derived rows only.
- rebuild/refresh summary in tenant-scoped command/service contexts.

### Important indexes (recommended)

- `idx_summaries_org_period` (`organization_id`, `period_id`)
- `idx_summaries_org_scope_key` (`organization_id`, `summary_scope`, `summary_key`)
- `idx_summaries_org_calculated_at` (`organization_id`, `calculated_at`)

### Must NOT be stored here

- canonical source truth replacing entries
- module workflow actions
- tax filing logic

---

## 6) `accounting_activity_timeline` (optional)

Purpose:
- Optional event/timeline stream for accounting actions and state transitions.

### Fields

- `id` (required)
- `organization_id` (required)
- `accounting_entry_id` (required)
- `event_type` (required)
- `actor_user_id` (required)
- `payload_json` (required)
- `created_at` (required)

### Key constraints (recommended)

- PK: (`id`)
- FK: `organization_id -> organizations.id`
- FK: `accounting_entry_id -> accounting_entries.id`
- FK: `actor_user_id -> users.id`
- CHECK: valid event type set.
- CHECK: `payload_json` is structured object.

### Tenant isolation rules

- tenant-owned events only.
- entry and actor tenant consistency enforced in command/service boundary.

### Important indexes (recommended)

- `idx_timeline_org_entry` (`organization_id`, `accounting_entry_id`, `created_at`)
- `idx_timeline_org_event` (`organization_id`, `event_type`, `created_at`)
- `idx_timeline_org_actor` (`organization_id`, `actor_user_id`, `created_at`)

### Must NOT be stored here

- canonical financial truth amounts replacing entries
- current-state cache as primary truth

---

## Recommended foreign keys (cross-table summary)

- `accounting_periods.organization_id -> organizations.id`
- `accounting_categories.organization_id -> organizations.id` (nullable for system rows)
- `accounting_categories.parent_category_id -> accounting_categories.id` (nullable)
- `accounting_entries.organization_id -> organizations.id`
- `accounting_entries.period_id -> accounting_periods.id`
- `accounting_entries.category_id -> accounting_categories.id`
- `accounting_entries.client_id -> clients.id` (nullable)
- `accounting_entry_links.accounting_entry_id -> accounting_entries.id`
- `accounting_summaries.period_id -> accounting_periods.id`
- timeline FKs per optional table section above

Cross-tenant integrity rule (service-level mandatory):
- All referenced entities in a write command must share same `organization_id`.

---

## Recommended unique constraints (summary)

- `accounting_periods`: unique (`organization_id`, `period_label`)
- `accounting_categories`:
  - tenant unique (`organization_id`, `code`)
  - system unique (`code`) for `is_system=true` rows (partial unique)
- `accounting_entry_links`: unique composite to avoid duplicate semantic links
- `accounting_summaries`: unique by (`organization_id`, `period_id`, `summary_scope`, `summary_key`, `currency`)

---

## Data integrity rules

1. `accounting_entries` is canonical truth for amounts.
2. `accounting_summaries` must be derivable from entries.
3. `document` linkage must occur through `accounting_entry_links`; document is not entry.
4. `posting_state` lifecycle is independent from `status`.
5. `category_id` required in entries; no free-text category fallback as truth.
6. Archived entries remain part of traceable truth model (policy on summary inclusion TBD).
7. No local-country tax semantics in Accounting Base tables.
8. No VAT engine fields in Accounting Base tables.
9. No payroll tax engine fields in Accounting Base tables.

---

## What this schema must NOT encode

- Israel-specific filing rules
- VAT statutory engine outputs
- payroll-tax statutory engine outputs
- client workflow ownership
- document workflow ownership
- frontend-derived totals/priority/status semantics

---

## Risky decisions (to resolve before implementation)

1. `amount` + `direction` vs signed amount strategy impacts constraints and aggregation complexity.
2. Allowing global + tenant categories requires strict uniqueness and conflict policy.
3. Summary materialization strategy may create staleness risk if versioning/invalidation is weak.
4. `status` vs `posting_state` taxonomy can drift without strict enum governance.
5. Generic `target_entity_type/target_entity_id` links require disciplined validation to avoid orphan links.

---

## Open questions / UNKNOWN

1. UNKNOWN: final enum sets for:
   - `entry_type`
   - `status`
   - `posting_state`
   - `category_type`
   - `summary_scope`
   - `relation_type`
2. UNKNOWN: whether periods can overlap by design or must be strictly non-overlapping per organization.
3. UNKNOWN: base currency policy when entry currency differs (store both raw and normalized amounts or normalize in summary only).
4. UNKNOWN: archival semantics for summaries (include archived entries or not by default).
5. UNKNOWN: retention policy for optional timeline payload size and redaction/security constraints.
6. UNKNOWN: whether system categories are immutable or partially overrideable per organization.

