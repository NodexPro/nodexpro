# Phase 4 Document Hub — Deliverable

## 1. Phase 4 Audit Summary

| Requirement | Status | Notes |
|-------------|--------|-------|
| Document entity (separate from file) | DONE | documents table; file_assets unchanged |
| Document versions | DONE | document_versions with is_current, version_number |
| Document links | DONE | document_links; primary_client_id on documents |
| Document status history | DONE | document_status_history |
| Document metadata | DONE | document_metadata (structured key-value) |
| Document activity timeline | DONE | document_activity_timeline |
| Document search index | DONE | document_search_index |
| Upload pipeline | DONE | Upload creates document + first version |
| Secure preview/download | DONE | Signed URL via GET .../open |
| Document types taxonomy | DONE | invoice, receipt, contract, statement, payroll_document, tax_document, other |
| Lifecycle model | DONE | uploaded, pending_classification, classified, linked, reviewed, approved, rejected, archived, superseded |
| Documents list UI | DONE | /documents with filters |
| Document card UI | DONE | /documents/:id with details, versions, links, activity |
| Client card documents section | DONE | Shows documents linked to client |
| Role/access (owner, admin_manager, staff) | PARTIALLY DONE | admin/member/viewer retained; owner/staff split deferred |
| Email invite/revoke | NOT DONE | addMember uses userId; invite-by-email deferred |
| Settings/Billing owner-only | NOT DONE | No owner_user_id on organizations; deferred |
| Delete file safe policy | PARTIALLY DONE | Archive document implemented; version delete deferred |

## 2. Architecture Decisions

- **Document ≠ File:** document is business object; file_asset is physical storage. One document, many versions; each version points to one file_asset.
- **Current version:** documents.current_version_id; only one version per document has is_current=true (partial unique index).
- **Links:** document_links for flexible entity linking; primary_client_id for convenient primary client.
- **Storage:** Separate bucket `document-files` for document uploads; private, access via signed URL only.
- **Sensitivity:** documents:view_sensitive required for sensitive/restricted documents.

## 3. Schema / Migrations

- **016_phase4_documents_schema.sql:** documents, document_versions, document_links, document_status_history, document_metadata, document_activity_timeline, document_search_index; RLS; triggers.
- **017_phase4_documents_permissions.sql:** documents:read, documents:write, documents:view_sensitive, documents:archive.
- **018_phase4_document_files_bucket.sql:** storage bucket `document-files`.

## 4. Constraints / Indexes

- documents: unique document_type_code check; lifecycle_state check; indexes on org, archived, primary_client, type, lifecycle.
- document_versions: unique(document_id, version_number); partial unique index for is_current.
- document_links: unique(org, document_id, target_entity_type, target_entity_id).
- document_metadata: unique(document_id, metadata_scope, metadata_key).
- document_search_index: unique(organization_id, document_id); GIN on normalized_search_text.

## 5. Backend Services and Files

| File | Purpose |
|------|---------|
| documents.service.ts | listDocuments, getDocumentById, updateDocument, archiveDocument, getDocumentActivity |
| document-versions.service.ts | listVersions, getDocumentOpenUrl (signed URL) |
| document-upload.service.ts | uploadDocument, uploadNewVersion |
| document-links.service.ts | listLinks, addLink, removeLink |
| documents.routes.ts | All document API routes |

## 6. API Contracts

| Method | Path | Permission |
|--------|------|------------|
| GET | /organizations/:id/documents | documents:read |
| POST | /organizations/:id/documents/upload | documents:write |
| GET | /organizations/:id/documents/:documentId | documents:read |
| PATCH | /organizations/:id/documents/:documentId | documents:write |
| POST | /organizations/:id/documents/:documentId/archive | documents:archive |
| POST | /organizations/:id/documents/:documentId/versions | documents:write |
| GET | /organizations/:id/documents/:documentId/versions | documents:read |
| GET | /organizations/:id/documents/:documentId/open | documents:read |
| GET | /organizations/:id/documents/:documentId/links | documents:read |
| POST | /organizations/:id/documents/:documentId/links | documents:write |
| DELETE | /organizations/:id/documents/:documentId/links/:linkId | documents:write |
| GET | /organizations/:id/documents/:documentId/activity | documents:read |

Query params: includeArchived, documentType, primaryClientId, linkedToClientId.

## 7. Frontend UI Changes

- **Documents.tsx:** List with filters (type, archived); upload form; table with title, type, status, date, amount.
- **DocumentCard.tsx:** Details (editable); current version + Open; version history + add version; links (add/remove client); activity timeline; archive.
- **ClientCard.tsx:** Documents section (when documents:read); lists documents linked to client; links to document card.
- **App.tsx:** Routes /documents, /documents/:documentId.
- **AppShell / auth:** Documents nav item when documents:read.

## 8. Secure File Access Model

- Preview/download: GET .../documents/:id/open returns { url } (signed URL, 60s).
- Backend checks: auth, org, documents:read, sensitivity (documents:view_sensitive for sensitive/restricted).
- No public storage URLs; bucket is private.
- Audit: DOCUMENT_VERSION_VIEWED, DOCUMENT_SENSITIVE_VIEWED for sensitive docs.

## 9. Role/Access Model Changes

- New permissions: documents:read, documents:write, documents:view_sensitive, documents:archive.
- admin, member: full document access.
- viewer: documents:read only.
- owner/admin_manager/staff split: DEFERRED (admin/member/viewer retained).

## 10. Email Invite/Revoke Flow

- DEFERRED. addMember still uses userId; no invite-by-email. organization_users.membership_status supports 'invited' for future use.

## 11. Audit/Security Implications

- Audit events: DOCUMENT_CREATED, DOCUMENT_UPDATED, DOCUMENT_ARCHIVED, DOCUMENT_VIEWED, DOCUMENT_SENSITIVE_VIEWED, DOCUMENT_VERSION_UPLOADED, DOCUMENT_VERSION_VIEWED, DOCUMENT_LINKED, DOCUMENT_UNLINKED.
- Object-level: document access checked by org + permission; sensitivity gated by documents:view_sensitive.
- Cross-tenant: all queries filter by organization_id.

## 12. Deferred Items

| Item | Rationale |
|------|-----------|
| owner/admin_manager/staff roles | Current admin/member/viewer sufficient; owner restriction later |
| Settings/Billing owner-only | Requires owner_user_id on organizations |
| Email invite flow | Supabase inviteUserByEmail + UI; out of scope |
| Document search API | document_search_index populated; search endpoint deferred |
| Delete version / remove file | Archive document implemented; version-level delete policy deferred |
| Malware scan | Architecture compatible; implementation deferred |

## 13. QA Checklist

1. Upload document → document + version created ✓
2. Document appears in list ✓
3. Open document card ✓
4. Link to client ✓
5. Set type, amount, date ✓
6. Upload new version ✓
7. Old version preserved ✓
8. Open/preview current version ✓
9. Document visible from client card ✓
10. Archive document ✓
11. Cross-org document access → 403 ✓
12. Sensitive doc without permission → 403 ✓

## 14. Final Verdict

**Phase 4 is substantially complete** for the Document Hub core:

- Document is a full business object, separate from file.
- Versioning works; secure preview/download works.
- Document types and lifecycle are structured.
- Document links to clients; visible from client card.
- Activity timeline and audit cover key actions.
- Object-level permissions enforced.

**Not complete** for: owner/staff access model, email invite, Settings/Billing owner restriction, document search API. These are explicitly deferred.
