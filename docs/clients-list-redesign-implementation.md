# Clients List Redesign – Implementation Summary

## 1. Audit of the Current Clients Page (Before)

### Backend
- **Route:** `GET /api/v1/organizations/:id/clients`
- **Query params:** `includeArchived`, `sort_by`, `sort_dir`, `limit`, `offset`
- **Response:** `{ items, total, limit, offset, has_more }`
- **Service:** `listClients()` in `apps/api/src/domains/clients/clients.service.ts` – org-scoped, permission `clients:read`; no `view` or `search`; filtering only by `is_archived` and sort.
- **Search:** Separate `GET .../clients/search?q=...&full=true` – returned a different shape (`results`), used only when user clicked Search; list and search were disconnected.

### Frontend
- **Page:** `apps/web/src/pages/Clients.tsx`
- **State:** list, sortBy, sortDir, limit, offset, total, hasMore, includeArchived, searchQ; no view, no bulk selection.
- **UX:** Sort controls (Sort by + Asc/Desc) and Per page were primary; search replaced the list with search results (no pagination, no view). Table: Name, Tax ID, Type, Status, Lifecycle, Archived; no checkboxes, no bulk actions, no Updated column.
- **Flow:** List loaded with sort/pagination; "Search" called search endpoint and overwrote list.

### Gaps
- No predefined views (All / Active / Archived / by type / Recently Updated / etc.).
- No single list API that combined view + search + sort + pagination.
- No bulk selection or bulk actions.
- UX centered on technical sorting, not operational views.

---

## 2. Architecture Decisions

- **Frontend stays dumb:** Frontend only sends `view`, `search`, `sort_by`, `sort_dir`, `limit`, `offset`, `includeArchived` and renders the list and bulk action responses. No security or business rules in the UI.
- **Views are backend-defined:** Each `view` value maps to server-side query rules (filters, sort). Frontend just sends the chosen view.
- **Search in list:** Search is a query parameter on the list endpoint; backend uses `entity_search_index` to restrict by client ids, then applies view/sort/pagination. One endpoint for both “list” and “search list”.
- **Bulk actions are backend-only:** All bulk operations (mark active/inactive, archive, restore, export) are POST endpoints with `clientIds` in body; org scoping and permissions enforced on the server. No client-side permission logic for “can archive” beyond showing/hiding buttons; backend still enforces.
- **Safe default for delete:** Permanent delete and merge are not implemented in this phase; archive/restore remain the standard lifecycle. Future delete/merge will require owner/admin and dependency checks on the backend.

---

## 3. Backend API Changes

### List endpoint (existing, extended)

**GET** `/api/v1/organizations/:id/clients`

| Param            | Type   | Description |
|------------------|--------|-------------|
| `view`           | string | One of: `all`, `active`, `inactive`, `archived`, `business_customer`, `individual_customer`, `supplier`, `partner`, `other`, `recently_updated`, `missing_tax_id`, `duplicate_candidates`. Default: `all`. |
| `search`         | string | Optional. Restricts to clients matching search text (via `entity_search_index`). |
| `includeArchived`| boolean| When true, includes archived in non-archived views. |
| `sort_by`        | string | `display_name` \| `created_at` \| `updated_at` \| `status`. |
| `sort_dir`       | string | `asc` \| `desc`. |
| `limit`          | number | Page size (capped). |
| `offset`         | number | Pagination offset. |

**Response (unchanged):** `{ items, total, limit, offset, has_more }`.

**Files changed:**
- `apps/api/src/domains/clients/clients.service.ts`: Added `CLIENT_LIST_VIEWS`, `ClientListView`, extended `ListClientsOptions` with `view` and `search`; refactored `listClients()` to apply view filters, optional search (via `searchClients` from search-index), and duplicate_candidates (clients sharing a `tax_id`).
- `apps/api/src/domains/clients/clients.routes.ts`: List handler now reads `view` and `search` from query and passes them to `listClients()`.

### Bulk endpoints (new)

All **POST**, body: `{ clientIds: string[] }` (max 500 for state changes, 2000 for export). Organization and permissions enforced in service.

| Endpoint | Permission   | Description |
|----------|-------------|-------------|
| `POST .../clients/bulk/mark-active`   | `clients:write` | Set `status = 'active'` for selected clients in org. |
| `POST .../clients/bulk/mark-inactive` | `clients:write` | Set `status = 'inactive'`. |
| `POST .../clients/bulk/archive`       | `clients:archive` | Set `is_archived = true`, audit + timeline. |
| `POST .../clients/bulk/restore`       | `clients:archive` | Set `is_archived = false`, refresh search index, audit + timeline. |
| `POST .../clients/bulk/export`       | `clients:write` | Returns CSV of selected clients (same columns as full export). |

**Responses:**  
- Mark active/inactive/archive/restore: `{ updated, clientIds }`.  
- Export: CSV body with `Content-Disposition: attachment; filename="clients-selected-export.csv"`.

**Files changed:**
- `apps/api/src/domains/clients/clients.service.ts`: Added `parseBulkClientIds`, `resolveBulkClientsInOrg`, `bulkMarkActive`, `bulkMarkInactive`, `bulkArchive`, `bulkRestore` (all org-scoped, permission-checked, audit/timeline where applicable).
- `apps/api/src/domains/clients/client-import-export.service.ts`: Added `exportSelectedClientsCsv(ctx, orgId, clientIds)`.
- `apps/api/src/domains/clients/clients.routes.ts`: Registered POST routes for bulk mark-active, mark-inactive, archive, restore, export (placed before `/:clientId` routes).

---

## 4. Bulk Action Design

- **Selection:** Frontend sends an array of client ids in the request body. Backend resolves them to ids that belong to the current org and applies the action only to those.
- **Idempotency:** Mark active/inactive and archive/restore are idempotent for already-in-state clients (e.g. archiving an already archived client still returns success and count).
- **Audit:** Bulk archive/restore and status changes write audit entries (e.g. bulk action + count + client_ids). Single-client timeline events are created for archive/restore.
- **Export:** Selected clients are exported in the same CSV format as full export; only clients in the org are included. No sensitive fields beyond what the existing export exposes.

---

## 5. UI Redesign Specification

- **Top controls (in order):**  
  - View selector (dropdown): All Clients, Active, Inactive, Archived, Business Customers, Individual Customers, Suppliers, Partners, Other, Recently Updated, Missing Tax ID, Duplicate Candidates.  
  - Search input + “Search” (applies `search` param and resets offset).  
  - “Include archived” when view is not “All” or “Archived”.  
  - New client, Import CSV, Export CSV (full).  
- **Secondary row:** Sort (Sort by + Asc/Desc), Per page.
- **Bulk bar:** Shown when at least one row is selected; shows count and: Mark active, Mark inactive, Archive, Restore, Export selected, Clear. Buttons gated by `clients:write` / `clients:archive`; backend still enforces.
- **Table:** Checkbox column (with “select all” for current page), Name (link to client card), Tax ID, Type, Status, Lifecycle, Updated (date), Archived indicator. Empty state: message when no results (with search vs without).
- **Pagination:** Unchanged (limit, offset, total, has_more; Previous/Next).

**Files changed:**
- `apps/web/src/pages/Clients.tsx`: View state and selector; search input + applied search; list fetch with `view` and `search`; `selectedIds` + row and “select all” checkboxes; bulk bar and handlers (runBulk, exportSelected); table columns (checkbox, Updated); i18n keys for views and empty states. Removed use of standalone search endpoint for replacing list.
- `apps/web/src/api/endpoints.ts`: Added `orgClientsBulkMarkActive`, `orgClientsBulkMarkInactive`, `orgClientsBulkArchive`, `orgClientsBulkRestore`, `orgClientsBulkExport`.
- `apps/web/src/i18n/en.json`, `he.json`: Added `clients.views.*`, `clients.empty`, `clients.noResultsSearch`.

---

## 6. Security Implications

- **Organization:** All list and bulk operations use `req.context.organizationId` and filter by `organization_id`; `resolveBulkClientsInOrg` ensures only org clients are affected.
- **Permissions:** List uses `clients:read` / `view_clients`; bulk mark active/inactive and export use `clients:write`; bulk archive/restore use `clients:archive`. Enforced in service and routes.
- **No trust of client:** Frontend may show/hide bulk buttons by permission, but backend always validates org and permission and only applies actions to clients in org. Deleting or merging is not exposed in this phase.

---

## 7. QA Checklist

- [ ] List: switch views (all, active, inactive, archived, each type, recently_updated, missing_tax_id, duplicate_candidates) and confirm counts and rows match backend rules.
- [ ] List: set search, apply, then clear; confirm list and total update and pagination works with search.
- [ ] List: change sort_by/sort_dir and per page; confirm order and page size.
- [ ] List: “Include archived” when view is e.g. active; confirm archived clients appear where expected.
- [ ] Select one or more rows; use “Select all” and clear; confirm bulk bar appears and count is correct.
- [ ] Bulk: Mark active / Mark inactive; confirm status updates and list refresh.
- [ ] Bulk: Archive / Restore; confirm archive state and that list/timeline/audit reflect it.
- [ ] Bulk: Export selected; confirm CSV contains only selected clients and correct columns.
- [ ] Permission: user without `clients:write` does not see write/export bulk buttons; user without `clients:archive` does not see archive/restore; backend returns 403 for unauthorized bulk calls.
- [ ] Large list (e.g. 100+ clients): pagination and view filters perform acceptably.

---

## 8. Final Implementation Status

| Item | Status |
|------|--------|
| Backend: list `view` + `search` | Done |
| Backend: view logic (all, active, inactive, archived, types, recently_updated, missing_tax_id, duplicate_candidates) | Done |
| Backend: bulk mark-active, mark-inactive, archive, restore | Done |
| Backend: bulk export selected | Done |
| Backend: routes and permissions | Done |
| Frontend: view selector | Done |
| Frontend: search as list param | Done |
| Frontend: bulk selection + bulk bar | Done |
| Frontend: table with checkbox, Updated, empty states | Done |
| i18n for views and messages | Done |
| Delete permanently / Merge | Not implemented (as specified) |
| Deliverable doc | Done |

**Files touched**

- `apps/api/src/domains/clients/clients.service.ts` – list views + bulk actions
- `apps/api/src/domains/clients/clients.routes.ts` – list query params + bulk routes
- `apps/api/src/domains/clients/client-import-export.service.ts` – export selected
- `apps/web/src/pages/Clients.tsx` – full list UX redesign
- `apps/web/src/api/endpoints.ts` – bulk endpoints
- `apps/web/src/i18n/en.json`, `he.json` – view labels and empty/search messages
- `docs/clients-list-redesign-implementation.md` – this document
