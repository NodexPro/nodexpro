# Phase 1 — Deliverables Checklist

**After Phase 1 the following must exist.**

## Database

- [ ] `supabase/migrations/001_core_schema.sql` — applied
- [ ] `supabase/migrations/002_rls_core.sql` — applied
- [ ] `supabase/migrations/003_seed_roles_permissions.sql` — applied
- [ ] `supabase/migrations/004_seed_plans_modules.sql` — applied
- [ ] `supabase/migrations/005_auth_sync_public_users.sql` — applied (optional trigger; backend sync by default)

## Backend (`apps/api`)

- [ ] Express app, CORS, helmet, JSON body
- [ ] Config and Supabase client (service role + anon for auth)
- [ ] Middleware: auth (JWT + resolve public user + membership), requireOrg, requirePermission
- [ ] Shared: context, errors, audit-events
- [ ] Auth: register, login, logout, GET /me, PUT /me/active-organization
- [ ] Organizations: POST /, GET /, GET /:id
- [ ] Members: GET /:id/members, POST /:id/members, PATCH /:id/members/:memberId
- [ ] Roles: GET /:id/roles
- [ ] Modules: GET /modules, GET /:id/modules
- [ ] Subscriptions: GET /:id/subscription
- [ ] Audit: GET /:id/audit
- [ ] All tenant routes require X-Organization-Id and membership; permissions enforced
- [ ] Audit log written for: user created, login, organization created, membership created, role assigned, modules viewed, subscription viewed

## Frontend (`apps/web`)

- [ ] Vite + React + TypeScript
- [ ] API client: token and X-Organization-Id from sessionStorage
- [ ] AuthContext: me (user, organizations, activeOrganizationId, permissions, enabledModules), setActiveOrg, signOut, refetchMe
- [ ] App shell: Sidebar (nav from permissions), TopBar (org switcher, user menu)
- [ ] Guards: RequireAuth, RequireOrg
- [ ] Pages: Login, Register, CreateOrganization, SelectOrganization, Dashboard, Settings, UsersRoles, Modules, Billing
- [ ] No business logic on frontend; all data from API

## Config

- [ ] `apps/api/.env.example` — SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PORT
- [ ] `apps/web/.env.example` — VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

## Docs

- [ ] `docs/architecture/phase-1/01-phase-1-implementation-package.md` — 16 sections
- [ ] `docs/architecture/phase-1/DELIVERABLES.md` — this file
