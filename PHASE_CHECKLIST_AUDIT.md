# NodexPro Phase Checklist Audit

Strict status audit. For each item: **DONE** | **PARTIAL** | **NOT DONE**, plus what exists, what is missing, and relevant files/routes/tables.

---

## PHASE 1

### 1. Auth flow
- **Status:** DONE
- **What exists:** POST `/api/v1/auth/register` (email, password, fullName), POST `/api/v1/auth/login`, POST `/api/v1/auth/logout` (Bearer), GET `/api/v1/auth/me`. Supabase Auth signUp/signInWithPassword; `public.users` sync via `ensureAppUser`; JWT validated in `authMiddleware` via `getUser(token)`. Routes: `apps/api/src/domains/auth/auth.routes.ts`. Service: `auth.service.ts`. Middleware: `apps/api/src/middleware/auth.ts`.
- **What is missing:** Nothing required for phase checklist.
- **Files/routes:** `auth.routes.ts`, `auth.service.ts`, `middleware/auth.ts`; tables: `public.users`, `auth.users`.

### 2. Organization creation
- **Status:** DONE
- **What exists:** POST `/api/v1/organizations` (name, countryCode, legalName, timezone); creates row in `organizations`, owner membership in `organization_users` and `organization_memberships`, optional starter plan/subscription; audit `ORGANIZATION_CREATED`. Cooldown 2.5s per user. `organizations.service.ts` `createOrganization()`.
- **What is missing:** Nothing.
- **Files/routes:** `organizations.routes.ts`, `organizations.service.ts`; tables: `organizations`, `organization_users`, `organization_memberships`, `subscriptions`, `organization_modules` (if starter plan).

### 3. Membership creation
- **Status:** DONE
- **What exists:** Invite flow: POST `/:id/members/invite` (email, role_code) → `inviteUserRbac`; accept: POST `/api/v1/auth/invite/accept` (token) → `acceptInviteRbac` creating membership. Legacy add: `memberships.service.ts` `addMember()`. Audit `MEMBERSHIP_CREATED` on add. Tables: `user_invitations`, `organization_users`, `organization_memberships`.
- **What is missing:** Nothing.
- **Files/routes:** `memberships.routes.ts`, `memberships-rbac.service.ts` (invite/accept), `memberships.service.ts`; tables: `user_invitations`, `organization_users`, `organization_memberships`.

### 4. Active organization context
- **Status:** DONE
- **What exists:** `X-Organization-Id` header set by frontend; `authMiddleware` loads membership for that org via `loadMembershipWithPermissions` or legacy `organization_users` + role_permissions; `req.context.organizationId` and `req.context.membership`. PUT `/api/v1/auth/me/active-organization` to set active org. `requireOrg` middleware rejects if no `organizationId` or membership. GET `/me` returns `activeOrganizationId`, `organizations`, `permissions`, `navItems`, `enabledModules`.
- **What is missing:** Nothing.
- **Files/routes:** `middleware/auth.ts`, `middleware/requireOrg.ts`, `auth.routes.ts` GET /me, PUT me/active-organization; `shared/context.ts`.

### 5. Roles and permissions on backend
- **Status:** DONE
- **What exists:** Tables `roles`, `permissions`, `role_permissions` (001); `organization_memberships` + `rbac_role_permissions` (021, 022); legacy `organization_users` + `roles` + `role_permissions`. `hasPermission()`, `requirePermission(...codes)` used on routes. RBAC mapping in `rbac.service.ts` (e.g. access_billing → subscriptions:read). Migrations: 003 seed roles/permissions, 020 owner/admin_manager/staff/viewer, 021/022 RBAC memberships.
- **What is missing:** Nothing.
- **Files/routes:** `rbac.service.ts`, `requirePermission.ts`; routes use `requirePermission('clients:read', 'view_clients')` etc.; tables: `roles`, `permissions`, `role_permissions`, `organization_memberships`, `rbac_role_permissions`.

### 6. Modules registry display
- **Status:** DONE
- **What exists:** GET `/api/v1/modules` (auth only) returns registry via `modulesService.listRegistryWithDependencies()`. Modules page: GET `/:id/modules/state` returns trial + module states; frontend `Modules.tsx` shows catalog, system/commercial modules, plans, activate/deactivate, select plan. Audit `MODULES_VIEWED` on list. Tables: `modules`, `module_dependencies`, `module_plans`, `organization_modules`, `organization_module_subscriptions`.
- **What is missing:** Nothing.
- **Files/routes:** `modules.routes.ts`, `modules.service.ts`, `modules-state.service.ts`; `apps/web/src/pages/Modules.tsx`; tables: `modules`, `module_dependencies`, `module_plans`, `organization_modules`, `organization_module_subscriptions`.

### 7. Subscription state reading
- **Status:** DONE
- **What exists:** GET `/api/v1/organizations/:id/subscription` with `requirePermission('subscriptions:read')` returns `subscriptionsService.getCurrentSubscription()`. Trial: GET `/:id/trial`, GET `/:id/owner-identity` etc. Modules state includes subscription/trial per module. Tables: `subscriptions`, `organization_module_subscriptions`, `organization_trials`.
- **What is missing:** Nothing.
- **Files/routes:** `subscriptions.routes.ts`, `subscriptions.service.ts`; `trial.routes.ts`, `trial.service.ts`; tables: `subscriptions`, `organization_module_subscriptions`, `organization_trials`.

### 8. Audit log for required core events
- **Status:** PARTIAL
- **What exists:** Table `audit_log` (001); `writeAudit()` in `shared/audit-events.ts`. Written for: USER_CREATED, USER_LOGGED_IN, ORGANIZATION_CREATED, MEMBERSHIP_CREATED, ROLE_ASSIGNED, MEMBERSHIP_DELETED, MODULES_VIEWED, SUBSCRIPTION_VIEWED, module activation/deactivation/denial, trial events, client/document/file events, etc. GET `/:id/audit` with `audit:read`. AUDIT_ACTIONS defines USER_LOGGED_OUT, MEMBERSHIP_UPDATED.
- **What is missing:** USER_LOGGED_OUT is never written (logout in auth.routes does not call writeAudit). MEMBERSHIP_UPDATED is never written (role change uses ROLE_ASSIGNED).
- **Files/routes:** `shared/audit-events.ts`, `domains/audit/audit.routes.ts`, `audit.service.ts`; table: `audit_log`. Missing calls: in `auth.routes.ts` POST /logout; optionally use MEMBERSHIP_UPDATED or keep ROLE_ASSIGNED as the only membership update event.

### 9. Tenant isolation tests
- **Status:** NOT DONE
- **What exists:** RLS on tenant tables (002, 013, 016, etc.) with `organizations_for_current_auth_user()`. Backend uses service_role and enforces org in code (e.g. `req.params.id !== req.context!.organizationId`, `.eq('organization_id', orgId)` in services). No project-owned tenant isolation tests.
- **What is missing:** Automated tests that verify cross-tenant access is denied (e.g. user A cannot read org B’s clients/documents when passing B’s org id with A’s token).
- **Files/routes:** No test files in `apps/api` or `apps/web` for tenant isolation; migrations 002, 013, 014, 016, 017, etc. for RLS.

### 10. App shell working as real platform shell
- **Status:** DONE
- **What exists:** `AppShell.tsx`: Sidebar from `me.navItems` (or fallback from permissions); TopBar with org switcher, user, sign out; `<Outlet />` for child routes. Nav items from GET /me (Dashboard, Settings, Users & Roles, Clients, Documents, Modules, Billing + per-enabled-module links). RequireAuth + RequireOrg wrap shell; routes under `/` use AppShell. Modules catalog visibility independent of enabledModules (defensive merge + permission-based).
- **What is missing:** Nothing.
- **Files/routes:** `apps/web/src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`; `App.tsx`; `auth.routes.ts` GET /me.

---

## PHASE 2

### 11. Module registry
- **Status:** DONE
- **What exists:** Table `modules` (001) with code, name, is_system, nav_path, nav_label, nav_order, etc.; 006 phase2 columns; GET `/api/v1/modules` and GET `/:id/modules`; seed in 007, 004. `modules.service.ts` listModules, listRegistryWithDependencies, listOrganizationModules.
- **What is missing:** Nothing.
- **Files/routes:** `modules.routes.ts`, `modules.service.ts`; tables: `modules`, `module_dependencies`; migrations 001, 006, 007, 004.

### 12. Entitlement engine
- **Status:** DONE
- **What exists:** `entitlement.service.ts`: `resolveEntitlement(organizationId, moduleId)` — system => entitled; else organization_module_subscriptions (active/trialing) or org-wide trial via `hasValidTrial()`. Returns status: entitled | trial | expired | not_entitled. Used by activation and `requireModuleActive`.
- **What is missing:** Nothing.
- **Files/routes:** `domains/modules/entitlement.service.ts`; tables: `modules`, `organization_module_subscriptions`; trial.service `hasValidTrial`.

### 13. Activation engine
- **Status:** DONE
- **What exists:** POST `/:id/modules/:moduleId/activate` with `modules:write`; `activation.service.ts` activateModule(): checks system (no-op + audit), entitlement, dependencies via `getMissingActiveDependencies`, then inserts/updates `organization_modules` and runs `runModuleActivateHook`. Audit MODULE_ACTIVATED, MODULE_ACCESS_VIA_TRIAL, etc.
- **What is missing:** Nothing.
- **Files/routes:** `modules.routes.ts`, `activation.service.ts`; tables: `organization_modules`; `dependency.service.ts`, `init-hooks.ts`.

### 14. Deactivation flow
- **Status:** DONE
- **What exists:** POST `/:id/modules/:moduleId/deactivate` with `modules:write`; `activation.service.ts` deactivateModule(): blocks for system module, removes active row from `organization_modules`, runs `runModuleDeactivateHook`, audit MODULE_DEACTIVATED.
- **What is missing:** Nothing.
- **Files/routes:** `modules.routes.ts`, `activation.service.ts` (deactivateModule); table: `organization_modules`.

### 15. Module dependency resolver
- **Status:** DONE
- **What exists:** `dependency.service.ts`: getDependencyCodes, getDependencyModuleIds, getMissingActiveDependencies(orgId, dependencyIds), topologicalSort. Table `module_dependencies`. Used in activation to block if dependencies not active.
- **What is missing:** Nothing.
- **Files/routes:** `dependency.service.ts`; table: `module_dependencies` (006).

### 16. Sidebar built from active modules + permissions + org context
- **Status:** DONE
- **What exists:** GET /me builds navItems: permission-based (Dashboard, Settings, Users & Roles, Clients, Documents, Modules, Billing); then for activeOrgId appends nav items from `organization_modules` (status=active) with modules.nav_path, nav_label, nav_order. Sorted by order. Frontend uses me.navItems or buildNavItemsFallback(permissions, enabledModules); Modules catalog entry ensured by permission (not enabledModules). Sidebar shows only what user may access.
- **What is missing:** Nothing.
- **Files/routes:** `auth.routes.ts` GET /me; `AppShell.tsx`; tables: `organization_modules`, `modules`.

### 17. API protection for inactive modules
- **Status:** DONE
- **What exists:** `requireModuleActive(moduleCode)` middleware: checks organization_modules for (org, module) active; else 403 + audit MODULE_ACCESS_DENIED. Used on example module router: `exampleModuleRouter.use(authMiddleware, requireOrg, requireModuleActive('example'), router)`. Catalog routes do not use requireModuleActive.
- **What is missing:** Nothing.
- **Files/routes:** `middleware/requireModuleActive.ts`; `example-module.routes.ts`; table: `organization_modules`.

### 18. API protection for missing entitlement
- **Status:** DONE
- **What exists:** `requireModuleActive` also calls `resolveEntitlement`; if status not entitled/trial, 403 and audit MODULE_ACCESS_DENIED / MODULE_ENTITLEMENT_CHECK_FAILED. Activation blocks when not entitled. So both “inactive” and “not entitled” are enforced.
- **What is missing:** Nothing.
- **Files/routes:** `requireModuleActive.ts`, `entitlement.service.ts`; `activation.service.ts`.

### 19. Audit for module activation/deactivation
- **Status:** DONE
- **What exists:** MODULE_ACTIVATED, MODULE_DEACTIVATED, MODULE_ACTIVATION_BLOCKED, MODULE_ENTITLEMENT_CHECK_FAILED, MODULE_DEPENDENCY_CHECK_FAILED, MODULE_ACCESS_DENIED, MODULE_ACCESS_VIA_TRIAL, MODULE_ACCESS_DENIED_AFTER_TRIAL, SYSTEM_MODULE_PROTECTED, MODULE_INIT_RUN written from activation.service and requireModuleActive.
- **What is missing:** Nothing.
- **Files/routes:** `activation.service.ts`, `requireModuleActive.ts`; `shared/audit-events.ts`.

---

## PHASE 3

### 20. Clients as shared master entity
- **Status:** DONE
- **What exists:** Table `clients` (013): organization_id, tax_id, client_type, display_name, legal_name, status, lifecycle_state, is_archived, etc. List/create/get/update/archive via `clients.routes.ts` and `clients.service.ts`; all queries scoped by organization_id. Unique (organization_id, tax_id).
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `clients.service.ts`; table: `clients` (013).

### 21. Client contacts
- **Status:** DONE
- **What exists:** Table `client_contacts` (013); list/add/update/setPrimary in `client-contacts.service.ts`; routes GET/POST/PATCH/PUT for `/:id/clients/:clientId/contacts`.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `client-contacts.service.ts`; table: `client_contacts`.

### 22. Client notes with visibility
- **Status:** DONE
- **What exists:** Table `client_notes` (013) with visibility_scope (organization/restricted/private), is_sensitive. listNotes(includeSensitive), addNote, viewSensitiveNote (separate endpoint with clients:view_sensitive). Audit CLIENT_NOTE_ADDED, CLIENT_SENSITIVE_NOTE_VIEWED.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `client-notes.service.ts`; table: `client_notes`.

### 23. Tags and entity tag links
- **Status:** DONE
- **What exists:** Tables `tags`, `entity_tag_links` (013). listTags, createTag, listTagsForClient, addTagToClient, removeTagFromClient. Audit CLIENT_TAG_ADDED, CLIENT_TAG_REMOVED.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `tags.service.ts`; tables: `tags`, `entity_tag_links`.

### 24. Entity file links
- **Status:** DONE
- **What exists:** Table `entity_links` (013) for linking file_assets to entities (entity_type, entity_id). listFilesForClient, attachFileToClient, getFileOpenUrl (secure URL). Audit CLIENT_FILE_ATTACHED, CLIENT_FILE_VIEWED. GET `/:id/clients/:clientId/files/:fileAssetId/open` returns signed URL via file-access flow.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `entity-file-links.service.ts`; `file-access.service.ts`; table: `entity_links`; migration 029 for secure access.

### 25. Activity timeline
- **Status:** DONE
- **What exists:** Table `activity_timeline` (013); timeline.service getTimelineForEntity; addTimelineEvent used from clients.service. GET `/:id/clients/:clientId/timeline`.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `timeline.service.ts`; table: `activity_timeline`.

### 26. Search foundation
- **Status:** DONE
- **What exists:** Table `entity_search_index` (013); search-index.service: buildClientSearchText, upsertClientSearchIndex, searchClients, searchClientsWithData (permission-aware). GET `/:id/clients/search?q=...&full=true`. Used on create/update/archive client.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `search-index.service.ts`; table: `entity_search_index`.

### 27. Object-level access for shared entities
- **Status:** DONE
- **What exists:** All client routes enforce `req.params.id === req.context!.organizationId` and services use `ctx.organizationId` and `.eq('organization_id', orgId)`. getClientById, getClientCardData, contacts/notes/tags/timeline/files all scoped by org and clientId; client must belong to org. Permissions: clients:read, clients:write, clients:view_sensitive, clients:archive per route.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `clients.service.ts`, `client-card.service.ts`, `client-contacts.service.ts`, `client-notes.service.ts`, `tags.service.ts`, `timeline.service.ts`, `entity-file-links.service.ts`.

### 28. Secure file access for shared entities
- **Status:** DONE
- **What exists:** file-access.service: validateFileAccessForEntity, getSecureOpenUrl; entity-file-links getFileOpenUrl uses it. Migration 029 file_assets storage_bucket, archived_at; signed URLs with expiry. Audit FILE_OPENED, FILE_ACCESS_DENIED.
- **What is missing:** Nothing.
- **Files/routes:** `file-access.service.ts`, `entity-file-links.service.ts`; routes GET open for client files; table: `file_assets`; migration 029.

### 29. Audit for sensitive shared object views
- **Status:** DONE
- **What exists:** CLIENT_VIEWED, CLIENT_SENSITIVE_NOTE_VIEWED, CLIENT_FILE_VIEWED written from client-card, client-notes, entity-file-links. Sensitive view requires clients:view_sensitive and is audited.
- **What is missing:** Nothing.
- **Files/routes:** `client-card.service.ts`, `client-notes.service.ts`, `entity-file-links.service.ts`; `audit-events.ts`.

### 30. Archive instead of hard delete
- **Status:** DONE
- **What exists:** Clients: is_archived, archived_at, archived_by; archiveClient() sets them; listClients has includeArchived. No DELETE for clients. Same pattern for documents (is_archived, archiveDocument).
- **What is missing:** Nothing.
- **Files/routes:** `clients.service.ts` (archiveClient, listClients includeArchived); `documents.service.ts` (archiveDocument); tables: `clients`, `documents`.

### 31. Cross-tenant protection for shared entities
- **Status:** DONE
- **What exists:** Every client/document/contact/note/tag/timeline/file query uses organization_id from context and .eq('organization_id', orgId). Route layer checks req.params.id === req.context!.organizationId. RLS on clients, client_contacts, client_notes, tags, entity_tag_links, activity_timeline, entity_links (013, 014). No API allows passing another org’s id with same token.
- **What is missing:** Nothing.
- **Files/routes:** All clients/documents services and routes; migrations 013, 014, 002.

---

## PHASE 4

### 32. Document is separate from file asset
- **Status:** DONE
- **What exists:** Table `documents` (016) is business record; `document_versions` references `file_assets`; document_versions.file_asset_id. Upload creates document + file_asset + document_version. Tables: documents, document_versions, file_assets.
- **What is missing:** Nothing.
- **Files/routes:** `document-upload.service.ts`, `documents.service.ts`; tables: `documents`, `document_versions`, `file_assets` (016, 018).

### 33. Document versions model
- **Status:** DONE
- **What exists:** Table `document_versions` (016): document_id, version_number, file_asset_id, original_file_name, mime_type, file_size, is_current, etc. Unique (document_id, version_number); one current per document. listVersions, uploadNewVersion; GET `/:id/documents/:documentId/versions`.
- **What is missing:** Nothing.
- **Files/routes:** `document-versions.service.ts`, `document-upload.service.ts`; table: `document_versions`.

### 34. Documents list
- **Status:** DONE
- **What exists:** GET `/:id/documents` with includeArchived, documentType, primaryClientId, linkedToClientId; listDocuments() in documents.service.ts; scoped by organization_id.
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `documents.service.ts` listDocuments; `Documents.tsx` (web).

### 35. Document card
- **Status:** DONE
- **What exists:** GET `/:id/documents/:documentId?full=true` returns documentCardService.getDocumentCardData (document, versions, links, activity). DocumentCard.tsx (web).
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `document-card.service.ts`; `DocumentCard.tsx`.

### 36. Structured document metadata
- **Status:** DONE
- **What exists:** Table `document_metadata` (016): document_id, metadata_scope, metadata_key, metadata_value_* (text, number, date, json). document_type_code, lifecycle_state, status, sensitivity_level, issue_date, document_date, amount_total, currency on documents table.
- **What is missing:** Nothing.
- **Files/routes:** Table: `document_metadata`; documents columns in 016.

### 37. Document type taxonomy
- **Status:** DONE
- **What exists:** documents.document_type_code check: invoice, receipt, contract, statement, payroll_document, tax_document, other (016). Used in list filter and upload.
- **What is missing:** Nothing.
- **Files/routes:** `documents.service.ts` DOCUMENT_TYPES; migration 016.

### 38. Document lifecycle / status model
- **Status:** DONE
- **What exists:** documents.lifecycle_state: uploaded, pending_classification, classified, linked, reviewed, approved, rejected, archived, superseded. status: active, inactive, draft. document_status_history table; status change recorded in updateDocument and archiveDocument.
- **What is missing:** Nothing.
- **Files/routes:** `documents.service.ts`; table: `document_status_history` (016).

### 39. Document ↔ client linking
- **Status:** DONE
- **What exists:** documents.primary_client_id (FK to clients); document_links table (target_entity_type, target_entity_id, relation_type). listDocuments filter by primaryClientId, linkedToClientId. document-links.service addLink, removeLink, listLinks.
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `document-links.service.ts`; tables: `documents.primary_client_id`, `document_links`.

### 40. Secure preview/download
- **Status:** DONE
- **What exists:** GET `/:id/documents/:documentId/open?versionId=...` returns signed URL via documentVersionsService.getDocumentOpenUrl; checks document and version belong to org; documents:view_sensitive for sensitive docs; audit DOCUMENT_VERSION_VIEWED / DOCUMENT_SENSITIVE_VIEWED. file_assets checked for organization_id.
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `document-versions.service.ts` getDocumentOpenUrl; bucket document-files; table: `file_assets`.

### 41. Object-level permissions for documents
- **Status:** DONE
- **What exists:** All document routes require req.params.id === req.context!.organizationId and documents:read/write/archive/view_sensitive. getDocumentById, listDocuments, getDocumentActivity, archiveDocument, versions, links all .eq('organization_id', orgId). Sensitivity masking for list/get when not documents:view_sensitive.
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `documents.service.ts`, `document-versions.service.ts`, `document-links.service.ts`, `document-card.service.ts`, `document-upload.service.ts`.

### 42. Document activity timeline
- **Status:** DONE
- **What exists:** Table `document_activity_timeline` (016); getDocumentActivity() in documents.service; GET `/:id/documents/:documentId/activity`. Events written from upload/update/link (document-upload, document-links).
- **What is missing:** Nothing.
- **Files/routes:** `documents.routes.ts`, `documents.service.ts` getDocumentActivity; table: `document_activity_timeline`.

### 43. Audit for sensitive document actions
- **Status:** DONE
- **What exists:** DOCUMENT_CREATED, DOCUMENT_UPDATED, DOCUMENT_ARCHIVED, DOCUMENT_VIEWED, DOCUMENT_SENSITIVE_VIEWED, DOCUMENT_VERSION_UPLOADED, DOCUMENT_VERSION_VIEWED, DOCUMENT_LINKED, DOCUMENT_UNLINKED written from documents.service, document-versions.service, document-links.service, document-upload.service, document-card.service.
- **What is missing:** Nothing.
- **Files/routes:** `documents.service.ts`, `document-versions.service.ts`, `document-links.service.ts`, `document-upload.service.ts`, `document-card.service.ts`; `audit-events.ts`.

### 44. Document search foundation
- **Status:** PARTIAL
- **What exists:** Table `document_search_index` (016); upsert on upload in document-upload.service (title, filename, document_type_code). No API endpoint that queries document_search_index to search documents by text.
- **What is missing:** GET `/:id/documents/search?q=...` (or equivalent) that queries document_search_index and returns matching document ids/docs scoped by org.
- **Files/routes:** `document-upload.service.ts` (writes index); table: `document_search_index`. Missing: search endpoint and service function.

### 45. Cross-tenant protection for documents
- **Status:** DONE
- **What exists:** All document/version/link/metadata/activity queries use organization_id from context; .eq('organization_id', orgId) on documents, document_versions, document_links, etc. Route checks req.params.id === req.context!.organizationId. RLS on document tables (016, 017).
- **What is missing:** Nothing.
- **Files/routes:** All document services and routes; migrations 016, 017.

---

## NEW FEATURE REQUESTS

### 46. CSV import of clients
- **Status:** DONE
- **What exists:** POST `/:id/clients/import/preview` (body.csv) and POST `/:id/clients/import`; client-import-export.service: parseCsv, previewImport, executeImport; validation, duplicate detection (email/phone/tax_id), audit CLIENTS_IMPORT. Migration 028 (address, city, notes, indexes). Frontend Clients.tsx: Import CSV UI, file picker, preview, confirm import.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `client-import-export.service.ts`; `Clients.tsx`; migration 028.

### 47. CSV export of clients
- **Status:** DONE
- **What exists:** GET `/:id/clients/export` returns CSV (Content-Type text/csv, attachment filename); client-import-export.service exportClientsCsv(); scoped to org. Frontend: Export button and download in Clients.tsx.
- **What is missing:** Nothing.
- **Files/routes:** `clients.routes.ts`, `client-import-export.service.ts` exportClientsCsv; `Clients.tsx` export button.

---

## SUMMARY

### A. Phase 1 overall status
**PARTIAL** — 8 DONE, 1 PARTIAL (audit: USER_LOGGED_OUT / MEMBERSHIP_UPDATED not written), 1 NOT DONE (tenant isolation tests).

### B. Phase 2 overall status
**DONE** — All 9 items DONE.

### C. Phase 3 overall status
**DONE** — All 12 items DONE.

### D. Phase 4 overall status
**PARTIAL** — 13 DONE, 1 PARTIAL (document search: index exists, no search API).

### E. New feature requests overall status
**DONE** — CSV import and export of clients both DONE.

### F. Top 5 missing items to finish next
1. **Tenant isolation tests** — Add automated tests (e.g. in apps/api or shared) that assert cross-tenant access is denied for clients, documents, and other org-scoped resources.
2. **Document search API** — Add GET `/:id/documents/search?q=...` (and optional filters) that queries `document_search_index` and returns matching documents scoped by organization_id.
3. **Audit USER_LOGGED_OUT** — Call writeAudit(..., AUDIT_ACTIONS.USER_LOGGED_OUT, ...) in POST /auth/logout (auth.routes.ts) when token is present and user is known.
4. **Audit MEMBERSHIP_UPDATED (optional)** — Either use MEMBERSHIP_UPDATED for role change in addition to or instead of ROLE_ASSIGNED, or document that ROLE_ASSIGNED is the canonical event for membership updates and leave MEMBERSHIP_UPDATED unused.
5. **Keep document search index in sync** — Ensure document_search_index is updated when document title/metadata changes (currently only on upload); add updates in updateDocument if needed for search consistency.
