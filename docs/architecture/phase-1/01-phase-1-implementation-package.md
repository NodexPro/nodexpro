# Phase 1: Core Skeleton — Implementation Package

**Document type:** Phase 1 — Implementation specification  
**Depends on:** Phase 0 (all artifacts).  
**Mandatory:** Implementation must follow this package; no business modules in Core.

---

## 1. FINAL ARCHITECTURE SUMMARY

- **Backend:** Single Node.js/TypeScript service (Express). Uses Supabase for Auth (JWT verification only); uses Postgres (via `pg` or Supabase server client) for all application data in `public` schema. Backend is the only writer to application data for API-driven flows; RLS is defense-in-depth. No business logic on frontend.
- **Frontend:** SPA (React + Vite or Next.js) that only calls backend API, renders responses, and displays UI state from backend. No computation of permissions, entitlements, or module visibility; all from `/me` or resource endpoints.
- **Auth:** Supabase Auth issues JWT; backend verifies JWT and resolves `public.users` + `organization_users` + active organization. Application user and membership are in `public` schema only.
- **Tenant isolation:** Every tenant-scoped request carries `X-Organization-Id` (or equivalent); backend validates membership and injects `organization_id` into all queries. RLS enforces same.
- **Modules:** Registry in `modules`; activation in `organization_modules`; subscription in `subscriptions` + `plans`. No CRM/payroll/VAT tables in Phase 1.
- **Audit:** All systemic actions (auth, org create, membership, role assign, module/subscription view) written to `audit_log` by backend.

---

## 2. FOLDER STRUCTURE

### 2.1 Backend (Node.js + TypeScript)

```
apps/api/
├── src/
│   ├── index.ts                    # Express app, routes
│   ├── config.ts                   # env, constants
│   ├── db/
│   │   ├── client.ts               # Postgres/Supabase client
│   │   └── migrations/             # (optional; Supabase handles SQL)
│   ├── middleware/
│   │   ├── auth.ts                 # JWT verify, attach user + org context
│   │   ├── requireOrg.ts           # require active organization
│   │   ├── requirePermission.ts    # check permission for current role
│   │   └── audit.ts                # audit middleware helper
│   ├── domains/
│   │   ├── auth/
│   │   │   ├── auth.service.ts
│   │   │   └── auth.routes.ts
│   │   ├── users/
│   │   │   ├── users.service.ts
│   │   │   └── users.routes.ts
│   │   ├── organizations/
│   │   │   ├── organizations.service.ts
│   │   │   └── organizations.routes.ts
│   │   ├── memberships/
│   │   │   ├── memberships.service.ts
│   │   │   └── memberships.routes.ts
│   │   ├── roles/
│   │   │   ├── roles.service.ts
│   │   │   └── roles.routes.ts
│   │   ├── permissions/
│   │   │   └── permissions.service.ts
│   │   ├── modules/
│   │   │   ├── modules.service.ts
│   │   │   └── modules.routes.ts
│   │   ├── subscriptions/
│   │   │   ├── subscriptions.service.ts
│   │   │   └── subscriptions.routes.ts
│   │   ├── audit/
│   │   │   ├── audit.service.ts
│   │   │   └── audit.routes.ts
│   │   ├── notifications/
│   │   │   └── notifications.service.ts   # foundation only
│   │   └── files/
│   │       └── files.service.ts           # metadata + storage abstraction
│   ├── shared/
│   │   ├── context.ts              # request context (user, org, role, permissions)
│   │   ├── errors.ts               # HTTP errors
│   │   └── audit-events.ts         # audit event codes + writer
│   └── types/
│       └── api.ts                 # DTOs, request/response types
├── package.json
├── tsconfig.json
└── .env.example
```

### 2.2 Frontend (React + Vite or Next.js)

```
apps/web/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   ├── client.ts              # HTTP client (base URL, auth header)
│   │   └── endpoints.ts           # endpoint paths only; no logic
│   ├── contexts/
│   │   ├── AuthContext.tsx       # holds: user, org, permissions, modules (from API)
│   │   └── OrganizationContext.tsx  # active org id + setter (calls API)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # sidebar + topbar + outlet
│   │   │   ├── Sidebar.tsx       # nav items from props (from backend)
│   │   │   └── TopBar.tsx        # org switcher, user menu
│   │   ├── ui/                   # dumb UI primitives
│   │   └── guards/
│   │       └── RequireAuth.tsx   # redirect if no user
│   ├── pages/
│   │   ├── login/
│   │   ├── register/
│   │   ├── onboarding/
│   │   │   └── CreateOrganization.tsx
│   │   ├── select-org/
│   │   ├── dashboard/
│   │   ├── settings/
│   │   ├── users-roles/
│   │   ├── modules/
│   │   └── billing/
│   └── routes.tsx                # route config; guards only
├── package.json
├── vite.config.ts
└── .env.example
```

### 2.3 Supabase / DB (repo root)

```
supabase/
├── migrations/
│   ├── 001_core_schema.sql
│   ├── 002_rls_core.sql
│   ├── 003_seed_roles_permissions.sql
│   ├── 004_seed_plans_modules.sql
│   └── 005_auth_hooks.sql        # trigger: sync auth.users -> public.users
└── config.toml
```

---

## 3. DATABASE DESIGN

### 3.1 Ownership and Conventions

- **Schema:** All application tables in `public`. No application tables in `auth` schema.
- **Tenant scope:** Every tenant table has `organization_id` (FK to `organizations`). Exceptions: `users` (global identity), `audit_log` (organization_id nullable for global events).
- **Identity:** `users.id` is UUID, primary. `users.auth_user_id` references `auth.users.id` (nullable until we sync). One row in `users` per application user; created on first sign-up or via trigger from auth.
- **Naming:** snake_case; tables plural where logical (users, organizations, organization_users).

### 3.2 Core Tables (Exact)

**users**  
- id uuid PK default gen_random_uuid()  
- auth_user_id uuid unique references auth.users(id) on delete set null  
- email text not null  
- full_name text  
- status text not null default 'active'  
- email_verified_at timestamptz  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  
- last_login_at timestamptz  

**organizations**  
- id uuid PK default gen_random_uuid()  
- name text not null  
- legal_name text  
- country_code char(2) not null  
- timezone text not null default 'UTC'  
- status text not null default 'active'  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  

**organization_users**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid not null references organizations(id) on delete cascade  
- user_id uuid not null references users(id) on delete cascade  
- role_id uuid not null references roles(id)  
- membership_status text not null default 'active'  
- joined_at timestamptz not null default now()  
- invited_by uuid references users(id)  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  
- unique(organization_id, user_id)  

**roles**  
- id uuid PK default gen_random_uuid()  
- code text not null unique  
- name text not null  
- scope text not null default 'organization'  
- is_system boolean not null default true  
- created_at timestamptz not null default now()  

**permissions**  
- id uuid PK default gen_random_uuid()  
- code text not null unique  
- name text not null  
- domain text not null  
- created_at timestamptz not null default now()  

**role_permissions**  
- id uuid PK default gen_random_uuid()  
- role_id uuid not null references roles(id) on delete cascade  
- permission_id uuid not null references permissions(id) on delete cascade  
- unique(role_id, permission_id)  

**plans** (needed for subscription)  
- id uuid PK default gen_random_uuid()  
- code text not null unique  
- name text not null  
- is_active boolean not null default true  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  

**plan_modules** (which modules a plan includes)  
- id uuid PK default gen_random_uuid()  
- plan_id uuid not null references plans(id) on delete cascade  
- module_id uuid not null references modules(id) on delete cascade  
- unique(plan_id, module_id)  

**modules**  
- id uuid PK default gen_random_uuid()  
- code text not null unique  
- name text not null  
- description text  
- scope_type text not null default 'global'  
- country_code char(2)  
- is_active boolean not null default true  
- is_sellable boolean not null default true  
- default_visibility text not null default 'hidden'  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  

**organization_modules**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid not null references organizations(id) on delete cascade  
- module_id uuid not null references modules(id) on delete cascade  
- status text not null default 'active'  
- activated_at timestamptz not null default now()  
- deactivated_at timestamptz  
- source_subscription_id uuid references subscriptions(id)  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  
- unique(organization_id, module_id)  

**subscriptions**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid not null references organizations(id) on delete cascade  
- plan_code text not null  
- status text not null default 'active'  
- started_at timestamptz not null default now()  
- ends_at timestamptz  
- trial_ends_at timestamptz  
- cancelled_at timestamptz  
- billing_state text  
- created_at timestamptz not null default now()  
- updated_at timestamptz not null default now()  

**audit_log**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid references organizations(id)  
- actor_user_id uuid references users(id)  
- actor_session_id text  
- module_code text  
- entity_type text not null  
- entity_id text  
- action text not null  
- payload_json jsonb  
- ip_address inet  
- user_agent text  
- created_at timestamptz not null default now()  

**notifications**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid not null references organizations(id) on delete cascade  
- user_id uuid references users(id) on delete set null  
- type text not null  
- title text not null  
- body text  
- status text not null default 'unread'  
- created_at timestamptz not null default now()  
- read_at timestamptz  

**file_assets**  
- id uuid PK default gen_random_uuid()  
- organization_id uuid not null references organizations(id) on delete cascade  
- storage_provider text not null default 'supabase'  
- storage_key text not null  
- file_name text not null  
- mime_type text  
- file_size bigint  
- uploaded_by uuid not null references users(id)  
- access_level text not null default 'organization'  
- created_at timestamptz not null default now()  
- unique(organization_id, storage_key) within scope  

### 3.3 Key Constraints

- FK from organization_users to roles: every membership has a role.
- FK from subscriptions to organization; plan_code references plans.code (logical; optional FK to plans.id).
- audit_log: no FK that would prevent logging after user/org delete; use actor_user_id/organization_id as historical reference.
- RLS: all tenant tables use a consistent helper (e.g. current_organization_id() or request.jwt.claim) set by backend or by Supabase when using service role with context.

---

## 4. SUPABASE INTEGRATION MODEL

### 4.1 auth.users vs public.users

- **auth.users:** Supabase-managed. Used only for: sign-up, sign-in, password reset, email verification. Do not use auth.users as the application user model.
- **public.users:** Application user. One row per human; linked by `auth_user_id = auth.users.id`. Created:
  - **Option A (recommended):** Database trigger on `auth.users` insert: insert into public.users (id, auth_user_id, email, full_name, status) values (gen_random_uuid(), new.id, new.email, new.raw_user_meta_data->>'full_name', 'active'). Use `new.id` as foreign key from public.users to auth.users; so public.users.id can be same as auth.users.id for simplicity, or separate UUID. **Decision:** public.users.id = gen_random_uuid(); public.users.auth_user_id = auth.users.id. Trigger creates row on signup.
  - **Option B:** Backend creates public.users on first successful login (by auth_user_id) if missing.
- **Usage:** Backend verifies JWT, reads `sub` (auth.users.id), looks up public.users by auth_user_id, loads organization_users + role + permissions for active org. All API logic uses public.users.id and organization_id.

### 4.2 Linking Auth Identity to public.users

- JWT `sub` = auth.users.id. Backend: `SELECT * FROM public.users WHERE auth_user_id = $1`. If no row, either reject or create (Option B). Session and “current user” in API = public.users row + current organization_user row.

### 4.3 Storage Foundation

- Bucket: e.g. `file-assets`. Private. No public list.  
- Policy: (auth.role() = 'authenticated' or service_role) and application checks. Backend generates signed URLs for download/upload after validating org membership and permission. Metadata in public.file_assets; backend writes metadata on upload, enforces organization_id and uploaded_by.

### 4.4 RLS Foundation

- Enable RLS on all tenant tables. Policies: allow select/update/delete/insert only where organization_id = current_setting('app.current_organization_id')::uuid (or equivalent). Backend sets this in transaction when using service role, or use Supabase client with RPC that sets context. **Alternative:** Backend uses single DB user (e.g. app backend) and never relies on RLS for tenant filter; backend always passes organization_id in WHERE. Then RLS can still require app backend role for extra safety. **Decision for Phase 1:** Backend always sends organization_id in every query; RLS policies require that row.organization_id is in (select organization_id from organization_users where user_id = current_user_id and membership_status = 'active'). For that we need “current user” in DB: either JWT custom claim (current_organization_id, user_id) set by backend after login, or backend uses service role and RLS is not used for tenant filter. **Simpler:** Backend uses service_role key for DB; backend enforces tenant in code (require X-Organization-Id header, validate membership, inject in all queries). RLS as second layer: policy “allow if organization_id in (select organization_id from organization_users where user_id = request.jwt.claim('app_user_id')::uuid)”. So we need to pass app_user_id in JWT or in request. Supabase JWT only has sub = auth id. So: backend verifies JWT, resolves app user and org, then uses Supabase client with service_role for queries, and always adds WHERE organization_id = $activeOrg. RLS can be “allow service_role” for backend, and “allow authenticated only via RPC that checks org” for direct client use if we ever use client-side Supabase. For Phase 1: **backend-only API; backend uses service_role; tenant enforced in application code.** RLS still created for future direct-PostgREST use: policy for authenticated role that restricts by organization_id from a table that stores session’s current org (e.g. app_sessions or JWT custom claim set by backend).

### 4.5 Not Mixing Auth and Application Model

- Never SELECT from auth.users in application code for business logic. Use public.users. Never store application profile (full_name, org membership, role) in auth.users.raw_user_meta_data as source of truth; only as cache for display. Source of truth: public.users + organization_users + roles.

---

## 5. AUTH / USER / MEMBERSHIP MODEL

- **User (global):** One row in public.users per identity. Identified by auth_user_id (auth.users.id). Has email, full_name, status. No organization_id on users.
- **Organization user (membership):** organization_users(organization_id, user_id, role_id, membership_status). One user can have many memberships; each has exactly one role per org. Role is per membership, not global.
- **Active organization context:** Chosen by user (or first org if one). Stored in frontend (in memory/sessionStorage) and sent as header (e.g. X-Organization-Id) on every tenant-scoped request. Backend validates: user has active membership in that org; then uses that org for the request. Backend does not trust frontend for “which org I’m in”; it validates membership and then uses that org_id.
- **Flow:** Login → Supabase Auth returns JWT. Frontend calls GET /me with JWT. Backend resolves public user, returns user + list of organizations (ids + names) + current active org if stored server-side (optional). If we don’t store active org on server, frontend sends X-Organization-Id; backend validates and uses it. Setting active org: POST /me/active-organization { organizationId }. Backend checks membership, then returns 200 and optionally stores in app_sessions. Frontend then uses that org in header for all tenant requests.

---

## 6. ROLE / PERMISSION MODEL

- **Roles:** Stored in roles (code, name, scope, is_system). Seed: admin, member, viewer (or equivalent). role_permissions links role to permissions.
- **Permissions:** Stored in permissions (code, name, domain). Seed: organizations:read, organizations:write, members:read, members:write, roles:read, modules:read, subscriptions:read, audit:read, settings:read, settings:write, etc.
- **Resolving for request:** Backend loads role for (user_id, organization_id) from organization_users → roles → role_permissions → permissions. Returns list of permission codes to frontend for UI (e.g. in /me). On each action endpoint, backend checks required permission (e.g. requirePermission('members:write')).

---

## 7. MODULE / SUBSCRIPTION MODEL

- **modules:** Registry. code, name, scope_type (global | country), country_code (if country), is_active, is_sellable, default_visibility.
- **plans:** plan_code, name. plan_modules: which modules are included in plan.
- **subscriptions:** organization_id, plan_code, status, started_at, ends_at, trial_ends_at. One active subscription per org (or we allow multiple; for Phase 1: one active per org).
- **organization_modules:** Which modules are “on” for the org. status (active/disabled), activated_at, source_subscription_id. Entitlement: org can use module M if (subscription active and plan includes M) and organization_modules has row for (org, M) with status active. Backend computes “enabled modules” for org and returns in /me or GET /organizations/:id/modules.
- **No billing provider integration in Phase 1.** Subscription state is manual or seed; no payment gateway.

---

## 8. AUDIT EVENT CATALOG

All written by backend; entity_type + action + payload_json. organization_id and actor_user_id set when applicable.

| action (code) | entity_type | When |
|---------------|-------------|------|
| user.created | user | After creating public.users (or trigger) |
| user.logged_in | user | After successful login |
| user.logged_out | user | Logout |
| organization.created | organization | After creating organization |
| organization.updated | organization | After updating organization |
| membership.created | organization_user | After adding member |
| membership.updated | organization_user | After role change / status change |
| membership.deleted | organization_user | After removing member |
| role.assigned | organization_user | When role_id is set (can be same as membership.updated) |
| modules.viewed | - | When listing modules for org (optional; or only sensitive) |
| subscription.viewed | subscription | When subscription state is read (optional) |
| subscription.updated | subscription | When subscription is changed |

**Mandatory to log:** user.created, user.logged_in, organization.created, membership.created, membership.updated (role assign). **Optional for Phase 1:** viewed events. **Immutable:** insert only; no update/delete.

---

## 9. SECURITY BASELINE (Phase 1)

- **Auth:** Supabase Auth; password hashing by Supabase; no secrets in code; env for SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET for verification.
- **Session:** JWT in Authorization header; backend verifies on every request. Session lifetime = Supabase JWT expiry (e.g. 1h); refresh token flow via Supabase (frontend refreshes, backend accepts new JWT). **Logout:** Frontend signs out via Supabase; invalidates session; no server-side token blacklist in Phase 1 (optional DEFERRED).
- **Tenant isolation:** Every tenant API requires X-Organization-Id (or equivalent). Backend validates user has active membership in that org; then uses only that organization_id in queries. No cross-tenant data returned.
- **Authorization:** Backend checks permission for endpoint (e.g. requirePermission('members:write')). Frontend does not enforce; only hides UI.
- **Audit:** Log systemic actions to audit_log; append-only.
- **Files:** No public URLs; signed URLs generated by backend after org/permission check.
- **Secrets:** In env only; not in code. .env.example without values.
- **Session lifetime:** Supabase default (e.g. 3600). **Token refresh:** Frontend uses Supabase getSession/refreshSession; retry with new token on 401. **Logout:** Supabase signOut. **Inactive session:** Supabase handles expiry. **Email verification:** Optional; config in Supabase. **Password reset:** Supabase. **Abuse protection:** DEFERRED (rate limit, lockout) to later phase; document as roadmap.

---

## 10. API CONTRACTS

Base URL: /api/v1 (or /v1). All tenant endpoints except auth/me require valid JWT + valid X-Organization-Id (membership check).

| Method | Path | Description | Auth | Org |
|--------|------|-------------|------|-----|
| POST | /auth/register | Body: { email, password, fullName }. Create auth user + trigger creates public.users | No | No |
| POST | /auth/login | Delegates to Supabase signIn; returns session (or 401) | No | No |
| POST | /auth/logout | Supabase signOut | Yes | No |
| GET | /me | Returns { user, organizations, activeOrganizationId, permissions, enabledModules } | Yes | No |
| PUT | /me/active-organization | Body: { organizationId }. Sets active org; validates membership | Yes | No |
| POST | /organizations | Body: { name, legalName?, countryCode, timezone? }. Create org + membership (current user as admin) | Yes | No |
| GET | /organizations | List orgs where user is member | Yes | No |
| GET | /organizations/:id | Get org by id (must be member) | Yes | No |
| GET | /organizations/:id/members | List organization_users with user + role (permission: members:read) | Yes | Yes (id = active) |
| POST | /organizations/:id/members | Body: { userId, roleId }. Add membership (permission: members:write) | Yes | Yes |
| PATCH | /organizations/:id/members/:memberId | Body: { roleId? }. Update role (permission: members:write) | Yes | Yes |
| GET | /organizations/:id/roles | List roles (permission: roles:read) | Yes | Yes |
| GET | /modules | List modules (registry) | Yes | No |
| GET | /organizations/:id/modules | List organization_modules for org (permission: modules:read) | Yes | Yes |
| GET | /organizations/:id/subscription | Get current subscription (permission: subscriptions:read) | Yes | Yes |
| GET | /organizations/:id/audit | List audit_log for org (permission: audit:read) | Yes | Yes |

All responses: JSON. Errors: 4xx/5xx with body { code, message }. Permissions checked in middleware or route handler.

---

## 11. UI SHELL SPEC

- **AppShell:** Receives from backend (via /me or context): currentUser, activeOrganization, organizations, permissions, enabledModules. Renders Sidebar + TopBar + main content area. Sidebar nav items: derived from permissions + enabledModules (e.g. Dashboard always; Settings if settings:read; Users & Roles if members:read; Modules if modules:read; Billing if subscriptions:read). **No logic:** list of nav items is either from backend (e.g. /me returns { navItems: [...] }) or from a static map permission_code -> nav item; frontend only filters by permissions array from backend.
- **TopBar:** Displays activeOrganization.name; org switcher (dropdown of organizations from backend); current user (user.full_name, user.email); logout. Data from context (from /me).
- **Sidebar:** Renders list of links; which links shown = from backend permissions/enabledModules. No “if (user.role === 'admin')” business logic; only “if (permissions.includes('members:read')) show Users & Roles”.
- **Guards:** RequireAuth: if no user, redirect to /login. RequireOrg: if no active org, redirect to /select-org or /onboarding. Routes use these guards; no permission-based route guard (backend rejects anyway); optional hide sidebar item if no permission.

---

## 12. DEFERRED DECISIONS

| Item | Reason | Target phase |
|------|--------|--------------|
| organization_settings | Not required for first shell | Phase 2 |
| user_preferences | Not required for first shell | Phase 2 |
| invitations | Invite flow out of scope Phase 1 | Phase 2 |
| sessions / refresh tokens (server-side) | Supabase handles refresh; no blacklist yet | Phase 2 if needed |
| module_settings_foundation | No module-specific config yet | When first module needs it |
| Rate limiting / lockout | Abuse protection | Phase 2 |
| Email verification required | Can enable in Supabase later | Config |
| Server-side active_organization storage | Frontend can send header only | Phase 2 if we want multi-device sync |

---

## 13. DEFINITION OF DONE (Phase 1)

- [ ] All Phase 1 migrations applied; schema matches this document.
- [ ] Backend: register, login, logout, /me (with orgs, permissions, enabled modules), set active org, create organization, list/get organizations, list/add/update members, list roles, list modules, list org modules, get subscription, list audit (with permission).
- [ ] Frontend: login, register, create organization, select organization, app shell (sidebar from backend context), dashboard placeholder, settings placeholder, users & roles page, modules page, billing page. All data from API only.
- [ ] Security: JWT verified on every request; tenant validated for tenant endpoints; permission checked where specified; audit log has required events.
- [ ] No business logic on frontend; no CRM/payroll/VAT tables or features.
- [ ] All 20 functional + security + audit + UI checks from QA checklist pass (or documented exception).

---

## 14. QA CHECKLIST

**Functional:**  
1. Register new user → user in DB (public.users).  
2. Login → JWT; GET /me returns user + orgs.  
3. Create organization → org in DB; user is member.  
4. Organization appears in “my organizations”.  
5. User is member with a role.  
6. Assign role to member → role persists in organization_users.  
7. Open Modules → list from API.  
8. Open Billing → subscription state from API.  
9. Open Users & Roles → members from API.  

**Security:**  
10. Request with another org’s id (where user is not member) → 403.  
11. No membership → no access to tenant endpoints.  
12. Open route without permission → backend returns 403.  
13. Active organization required for tenant endpoints; missing or invalid → 403.  

**Audit:**  
14. user.created / user.logged_in / organization.created / membership.created / role assigned present in audit_log.  

**UI:**  
15. Sidebar built from context (permissions/modules).  
16. TopBar shows current org and user.  
17. App shell works with empty modules list.  

**Data integrity:**  
18. No orphan organization_user (user exists).  
19. No orphan organization_module (module exists).  
20. No cross-tenant data in response.  

---

## 15. ARCHITECTURAL PROHIBITIONS (Phase 1)

- Do not add business modules (CRM, payroll, VAT) to Core.  
- Do not store tenant context only on frontend without backend validation.  
- Do not enforce permissions only by hiding UI; backend must enforce.  
- Do not mix user identity and organization membership (users vs organization_users).  
- Do not expose public file URLs without access control.  
- Do not use subscription as the only access model (role/permissions separate).  
- Do not implement modules registry as a list of strings without DB table and metadata.  
- Do not skip audit for systemic operations (create org, add member, assign role, login).  
- Do not put secrets in code.  
- Do not use auth.users as the application user model for business logic.

---

## 16. DELIVERABLES

| Deliverable | Description |
|-------------|-------------|
| SQL migrations | 001_core_schema.sql through 005_auth_hooks.sql in supabase/migrations/ |
| Backend app | Express app with auth middleware, domains (auth, users, organizations, memberships, roles, modules, subscriptions, audit), /me and API contracts above |
| Frontend app | Login, register, onboarding (create org), select org, app shell (sidebar, topbar), dashboard, settings, users-roles, modules, billing pages; API client; AuthContext with user/org/permissions/modules from /me |
| Config | .env.example for API and Web (SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, etc.) |
| Seed data | roles, permissions, role_permissions, plans, modules, plan_modules (minimal seed) |
| Docs | This document; optional README in apps/api and apps/web for run instructions |
