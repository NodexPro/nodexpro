# Phase 4 Completion Report

## 1. Performance Bottlenecks Found

| Area | Bottleneck | Impact |
|------|------------|--------|
| **DocumentCard** | Full `load()` after every mutation (save, addLink, removeLink, uploadNewVersion) | 5 parallel requests × N mutations = excessive refetches |
| **DocumentCard** | Clients fetched on every load for link dropdown | Extra request even when user never adds links |
| **documents.service** | `listDocuments` with `linkedToClientId`: 2 sequential queries (links + primary) | Waterfall instead of parallel |
| **DocumentCard** | PATCH response not used; full refetch instead | Unnecessary doc refetch after save |

## 2. Exact Optimizations Made

### A. DocumentCard (`apps/web/src/pages/DocumentCard.tsx`)

- **Partial refetch after mutations:**
  - `saveDocument`: Uses PATCH response to update local state; falls back to `refetchDoc()` only if API doesn't return doc
  - `addLink` / `removeLink`: Call `refetchLinks()` instead of full `load()`
  - `uploadNewVersion`: Call `refetchVersions()` instead of full `load()`
- **Lazy-load clients:** Clients no longer fetched in initial `Promise.all`. Fetched in a separate `useEffect` when `doc && canWrite`, using `clientsLoadedRef` to avoid duplicate requests.
- **Initial load:** Reduced from 5 to 4 requests (doc, versions, links, activity). Clients load in background when needed.

### B. documents.service (`apps/api/src/domains/documents/documents.service.ts`)

- **Parallel queries for `linkedToClientId`:** `document_links` and `documents` (primary_client_id) queries now run with `Promise.all` instead of sequentially.

## 3. Role Model Implemented

### Roles and Permissions

| Role | Permissions | Access |
|------|-------------|--------|
| **owner** | All (billing, settings, members:write, members:revoke, modules:write, etc.) | Full control |
| **admin_manager** | org, members:read, roles, modules:read, clients:*, documents:*, audit, settings:read | No billing, no members management, no module activation |
| **staff** | org:read, modules:read, clients:*, documents:* | Operational only; no Settings, Billing, Users & Roles, module management |
| **viewer** | Read-only (org, members, roles, modules, clients:read, documents:read, settings:read, subscriptions:read) | View only |

### Backend Enforcement

- **members:write** – Add/update members (owner only; admin_manager has members:read only)
- **members:revoke** – Revoke access (owner only; enforced in `removeMember` + `organizations.owner_user_id` check)
- **subscriptions:read** – Billing (owner, viewer)
- **settings:read/write** – Settings (owner has write; admin_manager has read only)
- **modules:write** – Module activation (owner only)

### Revoke Flow

- `DELETE /organizations/:id/members/:memberId` requires `members:revoke`
- Service checks `organizations.owner_user_id === ctx.user.id`
- Owner cannot revoke themselves

## 4. Exact Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/pages/DocumentCard.tsx` | Partial refetch, lazy clients, refetchDoc/refetchLinks/refetchVersions helpers |
| `apps/api/src/domains/documents/documents.service.ts` | Parallel queries for linkedToClientId |
| `supabase/migrations/019_organizations_owner_user_id.sql` | New: add owner_user_id to organizations |
| `supabase/migrations/020_role_model_owner_admin_staff_viewer.sql` | New: owner, admin_manager, staff roles; members:revoke; data migration |
| `apps/api/src/domains/organizations/organizations.service.ts` | Set owner_user_id on create; use owner role for creator |
| `apps/api/src/domains/memberships/memberships.service.ts` | addMember/updateMember/listMembers permission checks; removeMember (owner-only) |
| `apps/api/src/domains/memberships/memberships.routes.ts` | DELETE /members/:memberId with members:revoke |
| `apps/web/src/pages/UsersRoles.tsx` | Members table, Revoke button (when members:revoke) |

## 5. How to Test Owner/Admin/Staff/Viewer in ~10 Minutes

1. **Run migrations** (requires Docker for local Supabase):
   ```bash
   npx supabase db reset
   ```
   Or apply 019 and 020 manually if using hosted Supabase.

2. **Create org as owner:**
   - Register user A → create org → user A gets `owner` role and `owner_user_id` is set.

3. **Create staff/admin_manager/viewer:**
   - Register users B, C, D.
   - As owner (user A), go to Users & Roles.
   - Add members: B → staff, C → admin_manager, D → viewer (requires members:write; use API or DB to assign role_ids for owner, admin_manager, staff, viewer).

4. **Verify nav visibility:**
   - **Owner:** Settings, Billing, Users & Roles, Modules, Clients, Documents.
   - **Admin_manager:** Users & Roles (read-only list), Modules (read), Clients, Documents. No Settings, no Billing.
   - **Staff:** Clients, Documents only. No Settings, Billing, Users & Roles.
   - **Viewer:** Same as staff but read-only (no create/edit).

5. **Test revoke:**
   - As owner, open Users & Roles → Revoke a non-owner member.
   - As admin_manager, Revoke button should not appear (no members:revoke).

6. **Test API 403s:**
   - As staff: `GET /organizations/:id/subscription` → 403 (no subscriptions:read).
   - As staff: `POST /organizations/:id/members` → 403 (no members:write).
   - As owner: `DELETE /organizations/:id/members/:memberId` → 204.

## 6. Final Verdict: Is Phase 4 Now Actually Complete?

**Yes**, with these conditions:

- **Performance:** DocumentCard and documents list are optimized. Before: 5 requests per load + full refetch after each mutation. After: 4 requests per load, partial refetch after mutations, lazy clients.
- **Role model:** owner/admin_manager/staff/viewer are defined with correct permissions. Backend enforces members:revoke (owner-only), members:write (owner for add/update), and route-level permission checks. Nav items are permission-driven.
- **Remaining:** Invite-by-email flow (add member by email instead of userId) is not implemented; current flow requires userId. This can be a follow-up.

**Phase 4 is complete** for performance and role/access distribution as specified.
