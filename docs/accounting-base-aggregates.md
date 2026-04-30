# Accounting Base Aggregates (Phase 6 - Step 6)

Status: Read-model/aggregate architecture definition only.  
No API handlers/endpoints, migrations, DB changes, UI, or module integration in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-lifecycle-state-model.md`
- `docs/accounting-base-command-catalog.md`

Architecture constraints:
- Core -> Commands -> Aggregate -> UI
- UI reads one backend-prepared aggregate per screen/workspace
- no hidden GET
- no stitched reads
- frontend does not compute statuses/actions/totals
- financial truth source = `accounting_entries`
- summaries are derived from entries

---

## Aggregate naming convention

Pattern:
- `<domain>_<screen>_aggregate`

Required naming style:
- explicit scope (`workspace`, `details`)
- stable snake_case names
- command responses and read fetches reference the same aggregate contract name

Examples in this document:
- `accounting_entries_workspace_aggregate`
- `accounting_entry_details_aggregate`
- `accounting_periods_workspace_aggregate`
- `accounting_categories_workspace_aggregate`
- `accounting_summary_workspace_aggregate`

---

## Global aggregate contract rules

1. One aggregate per workspace/screen truth.
2. Aggregate must return ready:
   - sections/cards
   - statuses/states
   - action availability
   - table model (columns/rows/cell semantics)
   - summaries/metadata
   - empty states and warnings
3. Permissions must be included in aggregate payload.
4. UI must render only; no semantic calculations.

What UI must NOT calculate:
- totals
- lifecycle status labels/colors
- action availability
- posting-state semantics
- warning severity/meaning
- table ownership/grouping semantics

---

## Full refresh rule after command

After every command:
1. backend mutates domain state
2. backend rebuilds affected aggregate (or full case containing it)
3. backend returns refreshed aggregate truth
4. frontend performs full replace for that aggregate/screen state

Forbidden:
- partial local patch as final truth
- command success without aggregate refresh path

Command response contract (internal):

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

Rules:
- `refreshed` must always be a specific aggregate contract, never a generic bundle.
- `additional_refreshed` is optional and is used only when command context requires more than one full aggregate (for example entries list + entry details).

---

## No hidden modal GET rule

Modal/editor data must NOT be fetched from hidden side-read endpoints as truth source.

Allowed patterns:
1. Modal schema/data is included inside the main workspace aggregate, or
2. Modal-opening command returns modal payload + refreshed aggregate contract

Forbidden patterns:
- separate truth GET for modal/table/summary/status outside aggregate flow
- frontend stitching modal truth with base truth from multiple endpoints

---

## 1) `accounting_entries_workspace_aggregate`

Purpose:
- Main screen for accounting entries list and operational accounting view.

Source tables (conceptual):
- `accounting_entries`
- `accounting_periods`
- `accounting_categories`
- `accounting_entry_links` (for relation indicators)
- optional `accounting_summaries` (derived cards)

Input parameters (conceptual):
- `organization_id` (context)
- pagination (page/limit/cursor)
- filter set (period, category, status, posting_state, direction, client, date range, search)
- sort options

Returned sections (ready):
- page header/title/subtitle
- filter schema + selected filter values
- summary cards (derived)
- warnings/errors panel
- permissions block
- empty-state block

Returned table model (ready):
- column definitions
- row list
- cell kinds
- row states/status tags
- posting_state display
- row-level action descriptors
- table-level actions (if any)

Returned actions:
- command keys (for example create/finalize/archive/link)
- enable/disable flags
- action reason/tooltips for disabled actions

Returned states/statuses:
- entry `status`
- entry `posting_state`
- period/lock constraints affecting action availability

Permissions included:
- can_view_entries
- can_create_entry
- can_update_draft_entry
- can_finalize_entry
- can_archive_entry
- can_manage_links

What UI must NOT calculate:
- action availability from status/period
- badge semantics from raw fields
- totals shown in cards

Post-command refresh behavior:
- command returns or triggers refetch of refreshed `accounting_entries_workspace_aggregate`

---

## 2) `accounting_entry_details_aggregate`

Purpose:
- Entry details screen/card for a single accounting entry.

Source tables (conceptual):
- `accounting_entries`
- `accounting_categories`
- `accounting_periods`
- `accounting_entry_links`
- optional `accounting_activity_timeline`

Input parameters:
- `organization_id` (context)
- `entry_id`

Returned sections (ready):
- entry header block
- entry fields block
- linked entities block (client/documents/module entities)
- lifecycle block (`status`, `posting_state`, period state context)
- audit/events summary block
- warnings/errors block

Returned table model (if relevant):
- links table model (if list layout is used)
- timeline/event list model (if list layout is used)

Returned actions:
- update_draft_entry (if draft)
- finalize_entry (if allowed)
- archive_entry
- link/unlink actions
- optional future cancel/correction actions

Returned states/statuses:
- entry status/posting_state
- period status context
- validation/warning states

Permissions included:
- can_view_entry
- can_edit_draft
- can_finalize
- can_archive
- can_link_entities

What UI must NOT calculate:
- whether entry is editable/finalizable
- relation warnings
- event summary semantics

Post-command refresh behavior:
- any entry command returns/refetches refreshed `accounting_entry_details_aggregate`
- if list screen is open too, list aggregate should also be refreshed per navigation/state policy

---

## 3) `accounting_periods_workspace_aggregate`

Purpose:
- Period list and lifecycle management screen.

Source tables (conceptual):
- `accounting_periods`
- `accounting_entries` (derived period counts/health)
- optional `accounting_summaries` (derived totals metadata)

Input parameters:
- `organization_id`
- status filter
- date range filter
- pagination/sort

Returned sections (ready):
- page header
- status filter schema
- warning cards (locked/closed operational warnings)
- permissions
- empty state

Returned table model (ready):
- period rows
- lifecycle status display
- derived period summary snippet (counts/totals metadata)
- row actions (`lock`, `close`, optional future `reopen`)

Returned actions:
- create_period
- lock_period
- close_period
- optional reopen_period

Returned states/statuses:
- period status (`open`/`locked`/`closed`)
- warnings for period operational constraints

Permissions included:
- can_view_periods
- can_create_period
- can_lock_period
- can_close_period
- can_reopen_period (future)

What UI must NOT calculate:
- period action availability
- status transition validity
- warning severity

Post-command refresh behavior:
- period commands return/refetch refreshed `accounting_periods_workspace_aggregate`

---

## 4) `accounting_categories_workspace_aggregate`

Purpose:
- Category catalog management screen (system + organization categories).

Source tables (conceptual):
- `accounting_categories`
- optional `accounting_entries` usage references (derived, for safe deactivation warnings)

Input parameters:
- `organization_id`
- category_type/status filters
- tree/list view mode

Returned sections (ready):
- system categories section
- organization categories section
- optional category tree section
- warnings (for deactivation constraints)
- permissions
- empty states

Returned table/tree model (ready):
- rows/nodes
- parent relations
- active/inactive states
- row/node actions (`update`, `deactivate`, etc.)

Returned actions:
- create_category
- update_category
- deactivate_category

Returned states/statuses:
- category active/inactive
- system vs org-owned flags

Permissions included:
- can_view_categories
- can_create_category
- can_update_category
- can_deactivate_category

What UI must NOT calculate:
- parent/ownership semantics
- deactivation safety rules
- system vs org action restrictions

Post-command refresh behavior:
- category commands return/refetch refreshed `accounting_categories_workspace_aggregate`

---

## 5) `accounting_summary_workspace_aggregate`

Purpose:
- Financial summary screen using derived summary truth from entries.

Source tables (conceptual):
- `accounting_entries` (truth source for derivation)
- `accounting_summaries` (materialized/derived read model)
- `accounting_periods`
- `accounting_categories` (group dimensions)

Input parameters:
- `organization_id`
- period range
- scope filters (entry_type/category/client/direction/currency)

Returned sections (ready):
- totals by period
- totals by entry type
- totals by category
- currency context/info
- derived metadata (`calculated_at`, source version if available)
- staleness/unknown warning block
- permissions

Returned table model (ready, if tabular views used):
- summary dimension tables
- rows/cells
- scope descriptors

Returned actions:
- optional system/privileged `recompute_summary` trigger descriptor
- no manual total edit actions

Returned states/statuses:
- summary freshness/staleness state
- computation health state (ok/stale/unknown)

Permissions included:
- can_view_summary
- can_recompute_summary (if privileged)

What UI must NOT calculate:
- totals from raw rows
- stale vs fresh decision
- summary warning semantics

Post-command refresh behavior:
- any command affecting entry truth must refresh/recompute and return/refetch summary aggregate

---

## Aggregate summary list (required set)

1. `accounting_entries_workspace_aggregate`
2. `accounting_entry_details_aggregate`
3. `accounting_periods_workspace_aggregate`
4. `accounting_categories_workspace_aggregate`
5. `accounting_summary_workspace_aggregate`

---

## Open questions / UNKNOWN

1. UNKNOWN: whether command responses should always return full Accounting Base case bundle vs per-screen aggregate payload.
2. UNKNOWN: cache invalidation/version strategy across multiple open aggregates (list/details/summary).
3. UNKNOWN: exact stale detection contract for summary aggregate (time-based vs version-based).
4. UNKNOWN: whether category tree is always returned or only on demand within same aggregate payload.
5. UNKNOWN: standard action descriptor schema (labels, disabled reasons, severity, confirmation hints).
6. UNKNOWN: dual-refresh strategy when a details command should update both details and list aggregates.

