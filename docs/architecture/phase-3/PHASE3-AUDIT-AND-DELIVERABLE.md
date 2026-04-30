# Phase 3: Shared Entities Layer — Audit and Deliverable

**Status:** Implemented  
**Date:** 2025-03

---

## 1. Phase 3 Audit Summary

### DONE

| Requirement | Evidence |
|------------|----------|
| **Clients table** | Migration `013_phase3_shared_entities.sql`: `clients` with `id`, `organization_id`, `tax_id` NOT NULL, `client_type`, `display_name`, `legal_name`, `external_code`, `country_code`, `email`, `phone`, `status`, `lifecycle_state`, `owner_user_id`, `is_archived`, `archived_at`, `archived_by`, `created_by`, `created_at`, `updated_at` |
| **UNIQUE(organization_id, tax_id)** | Same migration: `unique(organization_id, tax_id)` |
| **Client contacts** | `client_contacts` table; FK to `clients`; one primary per client (partial unique index) |
| **Client notes** | `client_notes` with `visibility_scope`, `is_sensitive` |
| **Tags** | `tags` table; `entity_tag_links` for many-to-many (no CSV on client) |
| **Activity timeline** | `activity_timeline` with `entity_type`, `entity_id`, `event_type`, `source_type`, `source_module`, `actor_user_id`, `visibility_scope`, `is_sensitive`, `payload_json` |
| **Entity links** | `entity_links` (source/target entity_type + entity_id, relation_type) |
| **Entity file links** | `entity_file_links` linking `file_assets` to entities; no client_id on file_assets |
| **Entity search index** | `entity_search_index` with `normalized_search_text`; tenant-bound; updated on client create/update and contact add/update |
| **RLS** | All new tables have RLS by `organizations_for_current_auth_user()` |
| **Archive policy** | Clients use `is_archived`, `archived_at`, `archived_by`; no physical delete |
| **Permissions** | Migration `014`: `clients:read`, `clients:write`, `clients:view_sensitive`, `clients:archive`; admin/member get all; viewer gets read only |
| **Object-level access** | Backend: section permission (`clients:read`/`write`/`archive`) + sensitive data gated by `clients:view_sensitive`; list strips `tax_id` for non–view_sensitive; getClientById strips tax_id/email/phone when !includeSensitive |
| **Sensitive data** | tax_id, email, phone, sensitive notes protected; audit for CLIENT_VIEWED, CLIENT_SENSITIVE_NOTE_VIEWED |
| **Audit events** | CLIENT_CREATED, CLIENT_UPDATED, CLIENT_ARCHIVED, CLIENT_TAX_ID_CHANGED, CLIENT_VIEWED, CLIENT_CONTACT_ADDED/UPDATED, CLIENT_NOTE_ADDED, CLIENT_SENSITIVE_NOTE_VIEWED, CLIENT_FILE_ATTACHED, CLIENT_TAG_ADDED/REMOVED |
| **Backend services** | `clients.service`, `client-contacts.service`, `client-notes.service`, `tags.service`, `timeline.service`, `entity-file-links.service`, `search-index.service` |
| **API routes** | Under `/api/v1/organizations/:id/`: clients CRUD, archive, search; contacts CRUD, set primary; notes list/add, sensitive note view; tags list/create, client tags add/remove; timeline; files list/attach |
| **Frontend** | Clients list (filter archived, search, create client), Client card (details, contacts, notes, tags, files, timeline, edit, archive) |
| **Search foundation** | Sync update on create/update/archive; tenant-bound; normalized text; index includes client + contact text |

### PARTIALLY DONE

| Item | Notes |
|------|--------|
| **File upload UI** | Attach file API exists (body: `file_asset_id`); no UI for uploading a new file and then attaching. File list on client card shows links; “File upload and attach coming soon” message. |
| **Categories** | Deferred; tags only in this phase. |

### NOT DONE (by design / deferred)

| Item | Notes |
|------|--------|
| **Advanced sharing model** | Per-object ownership/sharing beyond role-based baseline is DEFERRED. |
| **Archive for contacts/notes/links** | Only client archive is implemented; contact/note/link archive DEFERRED. |
| **Signed URL / file download API** | Secure file access is enforced by `assertCanAccessFileViaClient`; actual signed URL or download endpoint not implemented in this phase. |

---

## 2. Architecture Decisions

- **Client = shared master entity** keyed by `tax_id` (HP) per organization; no alternative master client in modules.
- **Contacts, notes, tags, files, timeline** are structurally linked to client; all tenant-bound by `organization_id`.
- **Tags** are separate table + `entity_tag_links`; no CSV on client.
- **Files**: `file_assets` = metadata; `entity_file_links` = link; access via entity authorization.
- **Timeline**: structured events (system + manual); not free-text logs.
- **Search**: sync update on relevant changes; tenant-bound; normalized search text.
- **Sensitive data**: tax_id, email, phone, sensitive notes; access requires `clients:view_sensitive`; views audited.

---

## 3. Schema / Migrations

- **013_phase3_shared_entities.sql**: tables `clients`, `client_contacts`, `client_notes`, `tags`, `entity_tag_links`, `activity_timeline`, `entity_links`, `entity_file_links`, `entity_search_index`; indexes; RLS; no DELETE policy on clients.
- **014_phase3_clients_permissions.sql**: permissions and role_permissions for clients.

---

## 4. Constraints / Indexes

- `clients`: UNIQUE(organization_id, tax_id); indexes on organization_id, (organization_id, is_archived), (organization_id, tax_id), owner_user_id.
- `client_contacts`: UNIQUE(client_id) WHERE is_primary = true.
- `entity_tag_links`: UNIQUE(organization_id, entity_type, entity_id, tag_id).
- `entity_file_links`: UNIQUE(file_asset_id, entity_type, entity_id).
- `entity_search_index`: UNIQUE(organization_id, entity_type, entity_id); index on (organization_id, normalized_search_text).

---

## 5. Backend Services and Files

| File | Purpose |
|------|--------|
| `domains/clients/clients.service.ts` | List, get, create, update, archive; permission/sensitive handling; timeline + search index writes |
| `domains/clients/client-contacts.service.ts` | List, add, update, set primary; search index refresh with contact text |
| `domains/clients/client-notes.service.ts` | List (mask sensitive if no permission), add, view sensitive (audited) |
| `domains/clients/tags.service.ts` | List tags, create tag, list/add/remove client tags |
| `domains/clients/timeline.service.ts` | Add event, get by entity |
| `domains/clients/entity-file-links.service.ts` | List files for client, attach file, assertCanAccessFileViaClient |
| `domains/clients/search-index.service.ts` | normalizeSearchText, buildClientSearchText, upsertClientSearchIndex, refreshClientSearchIndexWithContacts, searchClients |
| `domains/clients/clients.routes.ts` | All routes under organizations/:id/ |
| `shared/audit-events.ts` | New Phase 3 audit action constants |

---

## 6. API Contracts (summary)

- `GET /organizations/:id/clients` — list (query: includeArchived).
- `POST /organizations/:id/clients` — create (body: tax_id, display_name, client_type, …).
- `GET /organizations/:id/clients/search?q=&includeArchived=` — tenant-bound search.
- `GET /organizations/:id/clients/:clientId` — get one (sensitive fields only if permission).
- `PATCH /organizations/:id/clients/:clientId` — update.
- `POST /organizations/:id/clients/:clientId/archive` — archive.
- `GET/POST /organizations/:id/clients/:clientId/contacts`; `PATCH .../contacts/:contactId`; `PUT .../contacts/:contactId/primary`.
- `GET/POST /organizations/:id/clients/:clientId/notes`; `GET .../notes/:noteId/sensitive`.
- `GET /organizations/:id/tags`; `POST /organizations/:id/tags`; `GET/POST /organizations/:id/clients/:clientId/tags`; `DELETE .../tags/:tagId`.
- `GET /organizations/:id/clients/:clientId/timeline`.
- `GET/POST /organizations/:id/clients/:clientId/files`.

---

## 7. Frontend UI

- **Clients** (`/clients`): list table, include-archived filter, search, “New client” (tax_id + display_name), link to client card.
- **Client card** (`/clients/:clientId`): details (with Edit for display_name, status, lifecycle); contacts (add, list); notes (add, list, sensitive indicator); tags (add from org tags, list); files (list; upload/attach placeholder); activity timeline; Archive button when permitted.

---

## 8. Object-Level Access

- **Section-level:** `clients:read`, `clients:write`, `clients:archive`, `clients:view_sensitive` enforced on all client routes.
- **Object-level:** Every client/contact/note/file operation checks `organization_id` and that the resource belongs to the org; sensitive note body and client tax_id/email/phone only returned when `clients:view_sensitive`.
- **File access:** `assertCanAccessFileViaClient` ensures user can access the client the file is linked to before granting access (foundation for signed URL/download later).

---

## 9. Sensitive Data / Audit

- **Classification:** Normal: display_name, status, tags. Sensitive: tax_id, phone, email, sensitive notes.
- **Audit:** Create/update/archive/client view/contact add/note add/sensitive note view/file attach/tag add-remove and tax_id change are audited with the actions listed in §1.

---

## 10. Search Foundation

- **Strategy:** Sync: search index updated in same request as client/contact create or update (and on archive via client update).
- **Archived:** Search endpoint can include or exclude archived via `includeArchived`; index is not deleted on archive so historical search can be supported later if needed.
- **Indexed:** Client fields (display_name, legal_name, tax_id, external_code, email, phone) and contact full_name, email, phone combined into `search_text` and `normalized_search_text`.

---

## 11. Deferred Items

- Categories (controlled taxonomy).
- Full file upload + attach UI (and optional signed URL/download endpoint).
- Archive policy for contacts/notes/entity links.
- Advanced per-object sharing beyond role-based permissions.

---

## 12. QA Checklist (Phase 3)

| # | Check | Result |
|---|--------|--------|
| 1 | Create a client | ✅ API + UI (New client with tax_id, display_name) |
| 2 | Client appears in list | ✅ List endpoint + Clients page |
| 3 | Open client card | ✅ Route /clients/:clientId, load client + contacts/notes/tags/files/timeline |
| 4 | Update client basic data | ✅ Edit block: display_name, status, lifecycle_state |
| 5 | Add contact | ✅ Form on card; primary can be set via API |
| 6 | Set primary contact | ✅ API PUT .../contacts/:id/primary |
| 7 | Add note | ✅ Form on card |
| 8 | Add sensitive note | ✅ Body is_sensitive; list masks without permission |
| 9 | Attach file | ✅ API (file_asset_id); UI shows list; upload UI deferred |
| 10 | Add tag | ✅ Org tags + add tag to client |
| 11 | Timeline shows events | ✅ System events on create/update/contact/note/tag/file |
| 12 | Search index entry | ✅ Upsert on create/update; search endpoint returns results |
| 13 | Archive client | ✅ Archive button; client not physically deleted |
| 14 | organization_id on all records | ✅ All tables have organization_id; RLS |
| 15 | Cannot open another org’s client | ✅ Backend checks org on every route |
| 16 | Sensitive note without role | ✅ List shows [Sensitive]; view body requires clients:view_sensitive |
| 17 | File access without client access | ✅ assertCanAccessFileViaClient |
| 18 | Object-level checks in backend | ✅ Permission + org + resource ownership |
| 19 | Sensitive view logged | ✅ CLIENT_VIEWED, CLIENT_SENSITIVE_NOTE_VIEWED |
| 20 | Audit: client created/updated/archived, contact, note, file, tag | ✅ All listed in §1 |
| 21 | Contact without client | ✅ FK client_id NOT NULL |
| 22 | Note without client | ✅ FK client_id NOT NULL |
| 23 | Tag link to non-existing entity | ✅ Application logic; DB has FKs where applicable |
| 24 | File link to non-existing file_asset | ✅ FK file_asset_id references file_assets |
| 25 | No cross-tenant search | ✅ searchClients filters by organization_id |
| 26 | No duplicate client same org + tax_id | ✅ UNIQUE(organization_id, tax_id); API returns 409 |
| 27 | Cannot set client tax_id to existing in same org | ✅ updateClient checks duplicate tax_id |

---

## 13. Security Checklist (Phase 3)

- Object-level permission checks: ✅ Section + sensitive gating.
- Secure file access: ✅ Via entity (client) access; no public uncontrolled URLs.
- Audit for create/update/archive/view sensitive: ✅.
- No cross-tenant entity access: ✅ organization_id and RLS.
- Note visibility: ✅ visibility_scope and is_sensitive; sensitive body only with permission.
- Sensitive handling baseline: ✅ tax_id, email, phone, sensitive notes; audit on view.

---

## 14. Final Verdict

**Phase 3 is complete** for the scope defined:

- Client exists as the shared master entity with tax_id (HP) and archive policy.
- Contacts, notes, tags, files, and timeline are structurally linked to client; all tenant-bound.
- Object-level and sensitive-data checks are in place; audit covers required operations.
- Search foundation is implemented (sync index, tenant-bound).
- UI provides clients list and client card with details, contacts, notes, tags, files, timeline, create/edit/archive.

**Note:** The repo has pre-existing TypeScript errors in other domains (auth, memberships, modules, organizations, middleware). They are outside Phase 3; the Phase 3 clients domain code compiles with the applied casts. File upload UI and signed URL/download are deferred.
