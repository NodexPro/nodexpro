# Phase 3 Clients Layer Hardening – Implementation Deliverable

## 1. Audit of the current gap list

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| 1 | Edit client notes | **DONE** | PATCH `/:id/clients/:clientId/notes/:noteId`; `updateNote()` in client-notes.service; edit/save/cancel in ClientCard. |
| 2 | Sorting for clients list | **DONE** | `listClients(..., { sort_by, sort_dir })`; GET clients accepts `sort_by`, `sort_dir`; frontend sort dropdowns. |
| 3 | Pagination for clients list | **DONE** | `listClients(..., { limit, offset })`; response `{ items, total, limit, offset, has_more }`; frontend limit/offset/prev/next. |
| 4 | Restore archived client | **DONE** | POST `/:id/clients/:clientId/restore`; `restoreClient()`; audit CLIENT_RESTORED; timeline CLIENT_RESTORED; Restore button on ClientCard. |
| 5 | Remove file from client | **DONE** | DELETE `/:id/clients/:clientId/files/:fileAssetId`; `removeFileFromClient()` deletes entity_file_links row only; file_asset preserved; audit + timeline; Remove button. |
| 6 | Object-level access verification | **DONE** | All routes check `req.params.id === req.context!.organizationId`; services use `.eq('organization_id', orgId)` and client existence; verified per action below. |
| 7 | Secure file access for client files | **DONE** | getFileOpenUrl: client in org, link (clientId + fileAssetId) exists, file_asset.organization_id === orgId; signed URL only; no public URLs. |
| 8 | Audit and activity for sensitive/view actions | **DONE** | Sensitive note view: CLIENT_SENSITIVE_NOTE_VIEWED. File open: CLIENT_FILE_VIEWED. Note edit: CLIENT_NOTE_UPDATED + note_edited timeline. File unlink: CLIENT_FILE_LINK_REMOVED + file_link_removed timeline. Restore: CLIENT_RESTORED + client_restored timeline. |
| 9 | Verify existing search foundation | **DONE** | Client search uses entity_search_index (search-index.service); upsert on create/update; restoreClient calls upsertClientSearchIndex; search filters by org and optional is_archived; no new search layer. |

---

## 2. Architecture decisions

- **Note edit permission:** Any user with `clients:write` can edit any note in the organization. Object-level: client and note must belong to org; note must belong to client. No author-only or role-based restriction.
- **Restore:** Same permission as archive (`clients:archive`). Restore only clears archive state (is_archived, archived_at, archived_by); no hard delete anywhere.
- **Remove file:** Only the `entity_file_links` row is deleted. `file_assets` row and storage object are preserved. Unlink is idempotent in behavior: if link does not exist, 403 "File link not found for this client".
- **Sort/pagination:** Backend-driven only. Frontend sends `sort_by`, `sort_dir`, `limit`, `offset`; backend validates allowed sort fields and cap limit; returns `items`, `total`, `limit`, `offset`, `has_more`.
- **Search:** No new search layer. Existing `entity_search_index` + `searchClients` / `searchClientsWithData`; index updated on create, update, and restore.

---

## 3. Exact backend routes/contracts

### 3.1 Edit client note
- **Route:** `PATCH /api/v1/organizations/:id/clients/:clientId/notes/:noteId`
- **Permission:** `clients:write`
- **Body:** `{ note_text: string; visibility_scope?: string; is_sensitive?: boolean }`
- **Response:** 200, updated note object.
- **Object-level:** Client and note must belong to org; note must belong to client.

### 3.2 Clients list (sorting + pagination)
- **Route:** `GET /api/v1/organizations/:id/clients`
- **Query params:** `includeArchived` (boolean), `sort_by` (display_name | created_at | updated_at | status), `sort_dir` (asc | desc), `limit` (1–100), `offset` (≥0).
- **Default sort:** sort_by=display_name, sort_dir=asc.
- **Default limit:** 20; max 100.
- **Response:** `{ items: ClientRow[], total: number, limit: number, offset: number, has_more: boolean }`.

### 3.3 Restore archived client
- **Route:** `POST /api/v1/organizations/:id/clients/:clientId/restore`
- **Permission:** `clients:archive`
- **Body:** none (or `{}`).
- **Response:** 200, restored client object.

### 3.4 Remove file from client
- **Route:** `DELETE /api/v1/organizations/:id/clients/:clientId/files/:fileAssetId`
- **Permission:** `clients:write`
- **Response:** 204 No Content.
- **Design:** Only `entity_file_links` row deleted; `file_assets` preserved. If link does not exist or does not belong to this client: 403.

---

## 4. Exact schema changes / migrations

**None.** All behavior uses existing tables: `client_notes`, `clients`, `entity_file_links`, `file_assets`, `activity_timeline`, `audit_log`, `entity_search_index`. No new columns or migrations.

---

## 5. Exact frontend changes

### 5.1 Endpoints (apps/web/src/api/endpoints.ts)
- `orgClientNote(orgId, clientId, noteId)` for PATCH note.
- `orgClientRestore(orgId, clientId)` for POST restore.
- `orgClientFileRemove(orgId, clientId, fileAssetId)` for DELETE file link.

### 5.2 Clients list (apps/web/src/pages/Clients.tsx)
- State: `sortBy`, `sortDir`, `limit`, `offset`, `total`, `hasMore`.
- GET clients URL: query params `sort_by`, `sort_dir`, `limit`, `offset`, `includeArchived`.
- Response handled as `{ items, total, limit, offset, has_more }`; `setList(data.items)`.
- UI: Sort dropdown (display_name, created_at, updated_at, status), sort direction (asc/desc), per-page (10/20/50/100), “Showing X–Y of Z”, Previous/Next (offset ± limit).

### 5.3 Client card (apps/web/src/pages/ClientCard.tsx)
- **Notes:** Edit button per note; inline form (textarea + Save/Cancel) calling PATCH note; refetch notes on success.
- **Restore:** “Restore” button when `client.is_archived && canArchive`; POST restore; set client from response.
- **Files:** “Remove” button per file when `canWrite`; confirm dialog; DELETE file link; refetch files.

### 5.4 i18n (en.json, he.json)
- `clients.actions.restore`, `clients.files.remove` added.

---

## 6. Security implications

- **Org scoping:** Every route checks `req.params.id === req.context!.organizationId`. Services use `ctx.organizationId` and `.eq('organization_id', orgId)` for client, notes, and file links.
- **Permissions:** Note edit and file remove require `clients:write`; restore requires `clients:archive`. Sensitive note view requires `clients:view_sensitive`; file open requires `clients:read`.
- **File access:** getFileOpenUrl verifies (1) client in org, (2) entity_file_links row for (org, client, file_asset_id), (3) file_asset.organization_id === orgId. Access only via signed URL; no public URL for client files.
- **Idempotent unlink:** Removing a non-existent link returns 403; no information leak about other clients or files.

---

## 7. Audit / activity event changes

### 7.1 Audit (shared/audit-events.ts)
- `CLIENT_NOTE_UPDATED: 'client_note.updated'`
- `CLIENT_FILE_LINK_REMOVED: 'client_file.link_removed'`
- `CLIENT_RESTORED: 'client.restored'`

### 7.2 Timeline (timeline.service.ts)
- `NOTE_EDITED: 'note_edited'`
- `FILE_LINK_REMOVED: 'file_link_removed'`
- `CLIENT_RESTORED: 'client_restored'`

### 7.3 Where written
- **Note edit:** writeAudit CLIENT_NOTE_UPDATED; addTimelineEvent NOTE_EDITED.
- **File remove:** writeAudit CLIENT_FILE_LINK_REMOVED; addTimelineEvent FILE_LINK_REMOVED.
- **Restore:** writeAudit CLIENT_RESTORED; addTimelineEvent CLIENT_RESTORED.
- **Sensitive note view:** already CLIENT_SENSITIVE_NOTE_VIEWED.
- **File open:** already CLIENT_FILE_VIEWED.

---

## 8. QA checklist

- [ ] Edit note: PATCH with valid note_text; response 200; note updated; timeline and audit present. Invalid org/client/note → 403.
- [ ] Clients list: change sort_by/sort_dir; order matches. Change limit/offset; items and has_more correct; total stable.
- [ ] Pagination: Next/Previous; boundary (offset 0, last page); per-page 10/20/50/100.
- [ ] Restore: archived client → Restore → client no longer archived; timeline and audit; list includes client when includeArchived=false after refresh.
- [ ] Remove file: Remove → confirm → file disappears from list; entity_file_links row gone; file_assets row still present; audit and timeline.
- [ ] Remove file 403: DELETE with wrong clientId or fileAssetId not linked → 403.
- [ ] Object-level: use token for org A, request org B’s client/note/file → 403.
- [ ] Secure file: open client file → signed URL; no public URL; file_asset in same org and linked to client.
- [ ] Search: create/update/restore client → search by name finds client (with includeArchived as appropriate).

---

## 9. Final verdict

| Gap | Verdict |
|-----|---------|
| 1. Edit client notes | **DONE** |
| 2. Sorting for clients list | **DONE** |
| 3. Pagination for clients list | **DONE** |
| 4. Restore archived client | **DONE** |
| 5. Remove file from client | **DONE** |
| 6. Object-level access verification | **DONE** |
| 7. Secure file access for client files | **DONE** |
| 8. Audit and activity for sensitive/view actions | **DONE** |
| 9. Verify existing search foundation | **DONE** |

All business logic, permissions, sorting, pagination, and object-level checks are enforced on the backend. Frontend only renders backend data and calls the API.

---

## Files changed (summary)

**Backend**
- `apps/api/src/shared/audit-events.ts` — CLIENT_NOTE_UPDATED, CLIENT_FILE_LINK_REMOVED, CLIENT_RESTORED.
- `apps/api/src/domains/clients/timeline.service.ts` — NOTE_EDITED, FILE_LINK_REMOVED, CLIENT_RESTORED.
- `apps/api/src/domains/clients/client-notes.service.ts` — updateNote().
- `apps/api/src/domains/clients/clients.service.ts` — listClients() options/result (sort, pagination), restoreClient().
- `apps/api/src/domains/clients/entity-file-links.service.ts` — removeFileFromClient().
- `apps/api/src/domains/clients/clients.routes.ts` — PATCH note, GET clients query params, POST restore, DELETE file link.

**Frontend**
- `apps/web/src/api/endpoints.ts` — orgClientNote, orgClientRestore, orgClientFileRemove.
- `apps/web/src/pages/Clients.tsx` — list state (sortBy, sortDir, limit, offset, total, hasMore); request/response shape; sort and pagination UI.
- `apps/web/src/pages/ClientCard.tsx` — restore, edit note (inline), remove file; handlers and UI.
- `apps/web/src/i18n/en.json` — clients.actions.restore, clients.files.remove.
- `apps/web/src/i18n/he.json` — same keys.

**No schema or migration changes.**
