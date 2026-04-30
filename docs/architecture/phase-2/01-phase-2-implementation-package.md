# Phase 2: Module Framework — Implementation Package

**Document type:** Phase 2 — Module Framework specification  
**Depends on:** Phase 1 (Core). Frontend remains dumb; backend/DB authoritative.

---

## 1. FINAL PHASE 2 ARCHITECTURE SUMMARY

- **Module Registry:** Single source of truth in `modules` table; extended with version, category, schema_version, migration_version. Dependencies in `module_dependencies` (normalized table for FK and cycle prevention).
- **Entitlement Engine:** Resolves from subscription (org) → plan → plan_modules. States: not_entitled | entitled | trial | expired | restricted. Resolved server-side only; never from frontend.
- **Activation Engine:** organization_modules stores activation; status: inactive | activating | active | suspended | deactivated. Activate: entitlement check → dependency check → init hook contract → insert/update organization_modules → audit.
- **Module Loader:** On API startup: load registry, validate dependencies (no cycles), register module route prefixes and permission requirements. No runtime plugin loading; modules are code paths wired at build time.
- **Isolation:** Modules access only Core public contracts (organizations, users, organization_users, permissions) and their own tables. No direct access to another module’s private tables. Enforced by convention and module guard (activation + entitlement + permission) on every module API route.
- **Nav/Routes:** Backend returns `enabledModules` and `navItems` (or equivalent) from /me or dedicated endpoint; frontend renders sidebar and routes from that. Module routes protected by requireModuleActive middleware.
- **Settings:** `module_settings` (global per module), `organization_module_settings` (per org per module). Activation init can create default org settings; contract only in Phase 2, minimal schema.

---

## 2. REQUIRED SCHEMA CHANGES / MIGRATIONS

**Migration 006_phase2_module_framework.sql:**

- **modules:** Add `version text not null default '1.0.0'`, `category text`, `schema_version text default '1'`, `migration_version text default '0'`. Add check for `scope_type in ('global', 'country', 'system')`. Add `system` to existing check via alter.
- **module_dependencies:** New table. `id uuid PK`, `module_id uuid not null references modules(id) on delete cascade`, `depends_on_module_id uuid not null references modules(id) on delete cascade`, `created_at`, unique(module_id, depends_on_module_id). No self-reference. Cycle prevention in application layer.
- **organization_modules:** Extend status check to `('inactive', 'activating', 'active', 'suspended', 'deactivated')`. Default remains 'active' for existing rows; new activations use 'active' after init.
- **module_settings:** `id uuid PK`, `module_id uuid not null references modules(id) on delete cascade`, `key text not null`, `value_json jsonb`, `created_at`, `updated_at`, unique(module_id, key). Global per-module config.
- **organization_module_settings:** `id uuid PK`, `organization_id uuid not null references organizations(id) on delete cascade`, `module_id uuid not null references modules(id) on delete cascade`, `key text not null`, `value_json jsonb`, `created_at`, `updated_at`, unique(organization_id, module_id, key). Per-org per-module config; init hook can insert defaults.

**Rationale for normalized module_dependencies:** FK enforces referential integrity; we can resolve dependency order and detect cycles in one place; no JSON parsing in DB for dependency checks.

---

## 3. MODULE DEFINITION CONTRACT

Each module is defined by:

- **In DB (modules + module_dependencies):** code, name, version, description, category, scope_type, country_code, is_active, is_sellable, default_visibility, schema_version, migration_version; dependencies as rows in module_dependencies.
- **In code (contract):** Module descriptor object: `{ code, name, version, schemaVersion, migrationVersion, category?, scopeType, countryCode?, dependencies: string[] }`. Optional init hook: `onActivate?(ctx: ModuleActivateContext): Promise<void>`, `onDeactivate?(ctx: ModuleDeactivateContext): Promise<void>`.
- **ModuleActivateContext:** `{ organizationId, moduleId, moduleCode }`. Hook may create rows in organization_module_settings; must not fail if defaults already exist (idempotent).
- **No business tables in Phase 2:** Init hook contract only; no CRM/payroll tables.

---

## 4. REGISTRY MODEL

- **Source of truth:** `modules` table. All available modules are rows; `is_active` gates visibility.
- **List registry:** API returns modules with resolved dependency codes (from module_dependencies join). Order: topological sort for display; no cycle (enforced at insert/update of module_dependencies in app).
- **Versioning:** version, schema_version, migration_version stored and returned; used for future upgrades and compatibility checks.

---

## 5. DEPENDENCY RESOLVER MODEL

- **Storage:** module_dependencies(module_id, depends_on_module_id). Each row = “module_id depends on depends_on_module_id”.
- **Resolve order:** Topological sort (Kahn or DFS). If cycle detected, return error (activation blocked, or registry invalid).
- **At activation:** For module M, resolve all dependencies; check each dependency is active for the org (organization_modules.status = 'active'). If any missing, activation fails with explicit reason (e.g. “Missing: employees”).
- **No circular dependencies:** Enforced when adding module_dependencies (application checks before insert).

---

## 6. ENTITLEMENT RESOLUTION MODEL

- **Inputs:** organization_id.
- **Steps:** (1) Get current subscription (subscriptions where organization_id, order by started_at desc, limit 1). (2) If no subscription or status not in ('active','trialing') → not_entitled or expired. (3) plan_code → plans.id → plan_modules → list of module_ids. (4) For a given module_id: if in plan_modules and subscription active → entitled; if subscription trial_ends_at in future → trial; if subscription ended → expired; else not_entitled.
- **Output:** Per module: `{ status: 'not_entitled' | 'entitled' | 'trial' | 'expired' | 'restricted', reason?: string }`. Cached per request or short TTL; not stored in DB as separate table.
- **restricted:** Reserved for future (e.g. feature flag or org-level restriction).

---

## 7. ACTIVATION / DEACTIVATION MODEL

**Activate(organizationId, moduleId):**

1. Resolve entitlement for module; if not entitled (and not trial), return 403 with reason.
2. Resolve dependencies; if any dependency not active for org, return 400 with list of missing.
3. Optional: run module init hook (onActivate) — create default organization_module_settings if any; catch errors and log; do not block activation if hook fails (or make hook optional and document).
4. Insert or update organization_modules: organization_id, module_id, status = 'active', activated_at = now(), deactivated_at = null, source_subscription_id = current subscription id.
5. Write audit: module.activated.

**Deactivate(organizationId, moduleId):**

1. Require permission (e.g. modules:write or admin).
2. Update organization_modules set status = 'deactivated', deactivated_at = now() where organization_id and module_id.
3. Optional: run onDeactivate hook (cleanup optional).
4. Write audit: module.deactivated.

**No cascade deactivation of dependents:** If module A is deactivated, modules that depend on A are not auto-deactivated; they may break at runtime until we add dependency checks on use. Phase 2: document as known limitation; optional check in module guard “if this module’s dependency is inactive, return 503”.

---

## 8. MODULE SECURITY MODEL

- **Every module API route** must pass: (1) authMiddleware, (2) requireOrg, (3) requireModuleActive(moduleCode), (4) requirePermission(modulePermission if any).
- **requireModuleActive(moduleCode):** Load organization_modules join modules for current org and module code; if no row or status != 'active', return 403. Optionally re-check entitlement on sensitive operations.
- **Entitlement:** Checked at activation time and optionally at first use; not on every request if activation is the gate (activation implies entitlement was checked).
- **Frontend:** Does not decide; only displays state from backend (e.g. “Activate” disabled with reason from API).

---

## 9. ROUTE / NAV INTEGRATION MODEL

- **Backend:** /me (or GET /organizations/:id/modules/state) returns: for each module visible to org — code, name, activationStatus, entitlementStatus, navLabel?, navPath?, order. Nav metadata can live in modules table (nav_path, nav_label, nav_order) or in a small config; Phase 2: add nav_label, nav_path, nav_order to modules table.
- **Frontend:** Receives list of active modules with nav info; builds sidebar from that list. No hardcoded module list for “which modules show in sidebar”; only Dashboard, Settings, Users & Roles, Modules, Billing can remain as core routes; any extra nav items come from backend (active modules with nav_path).
- **Module route:** e.g. /module/:moduleCode/* or /m/employees. Guard: requireModuleActive(moduleCode). If inactive, 403.

---

## 10. SUPABASE / POSTGRES IMPLICATIONS

- All new tables in public schema. RLS: same pattern as Phase 1 (organization_module_settings scoped by organization_id; module_settings readable by authenticated or service_role).
- No change to auth flow. organization_modules already has organization_id; existing RLS policies apply.
- Init hooks run in API process; no Supabase Edge Functions required for Phase 2.

---

## 11. API CONTRACTS

- **GET /modules** — List registry (all active modules with dependencies, version, category). Auth required.
- **GET /modules/:id/modules/state** — For org (id = organizationId): list modules with entitlementStatus, activationStatus, dependencies, canActivate, canDeactivate, blockReason. Permission: modules:read. (Mounted under /api/v1/modules.)
- **POST /modules/:id/modules/:moduleId/activate** — Activate module for org. Permission: modules:write. Body: optional {}.
- **POST /modules/:id/modules/:moduleId/deactivate** — Deactivate. Permission: modules:write.
- **GET /me** — Extend: navItems[] from backend (active modules with nav_path, nav_label, nav_order); or keep enabledModules and have frontend map code → nav from a static table that mirrors backend. **Decision:** Backend returns navItems: { path, label, order }[] so frontend is dumb.
- **GET /module/:moduleCode/* (or /m/:moduleCode)** — Module routes; guard requireModuleActive(moduleCode).

---

## 12. UI MODULES SCREEN SPEC

- **Data source:** GET /organizations/:id/modules/state. No client-side entitlement or activation logic.
- **Display per module:** name, code, version, scope, dependencies (list of codes), entitlementStatus, activationStatus, actions: Activate (if entitled and inactive, else disabled with reason), Deactivate (if active).
- **Block reason:** When Activate disabled, show blockReason from API (e.g. “Not in plan”, “Missing dependencies: employees”).

---

## 13. AUDIT / OBSERVABILITY CATALOG

- module.registered (when module row created; optional for Phase 2).
- module.loaded (at startup when registry loaded; optional).
- module.activated — organization_id, module_id, actor_user_id.
- module.deactivated — same.
- module.dependency_check_failed — payload: { moduleCode, missingDependencies[] }.
- module.entitlement_check_failed — payload: { moduleCode, reason }.
- module.init_run — payload: { moduleCode, organizationId, success }.
- module.activation_failed — payload: { moduleCode, reason }.
- module.access_denied — when API guard blocks access (inactive or no entitlement).

---

## 14. DEFERRED DECISIONS

- **Cascade deactivation of dependents:** Deferred; document that deactivating a module does not deactivate dependents.
- **on_module_upgrade hook:** Deferred to upgrade story.
- **Background jobs registration in init:** Deferred.
- **Rate limit per module API:** Deferred.
- **Country Pack loading order:** Deferred to Country Pack phase.

---

## 15. DEFINITION OF DONE (Phase 2)

- [ ] Migration 006 applied; modules extended; module_dependencies, module_settings, organization_module_settings exist; organization_modules status extended.
- [ ] Registry API returns modules with dependencies; dependency resolver implemented; no cycles allowed.
- [ ] Entitlement resolver implemented; used in activation and in modules/state API.
- [ ] Activate/Deactivate APIs implemented; init hook contract called (example module has no-op or default settings insert).
- [ ] requireModuleActive middleware in place; example module route protected.
- [ ] /me or equivalent returns navItems for sidebar; frontend builds sidebar from navItems only (core + module items).
- [ ] Modules screen shows entitlement, activation, dependencies, block reason, Activate/Deactivate from API.
- [ ] Audit events written for activation, deactivation, access_denied, activation_failed.
- [ ] Example test module registered, activatable, route reachable when active and blocked when inactive.

---

## 16. QA CHECKLIST

1. Activate example module → organization_modules row active.  
2. Entitlement checked (e.g. change plan or subscription and verify canActivate).  
3. Dependency check: add dependency to example module; activate dependency first then module; try activate without dependency → block reason.  
4. Init: after activation, organization_module_settings has default row if hook implements it.  
5. Open module screen (placeholder) → 200 when active.  
6. Deactivate → module disappears from nav; organization_modules status deactivated.  
7. Open module URL manually when inactive → 403.  
8. Audit: module.activated, module.deactivated present.  
9. Call module API without entitlement (e.g. different plan) → 403.  
10. Call module API without permission → 403.  
11. organization_modules and organization_module_settings data correct.  
12. Sidebar shows/hides module entry based on backend navItems.

---

## 17. ARCHITECTURAL PROHIBITIONS

- Do not treat modules table alone as sufficient; use entitlement + activation + dependencies.  
- Do not enforce module access only on frontend.  
- Do not conflate entitlement and activation.  
- Do not skip dependency check on activation.  
- Do not hardcode module list for nav in frontend; use backend navItems.  
- Do not allow modules to read another module’s private tables.  
- Do not add CRM/payroll/VAT business logic in Phase 2.  
- Do not break Core schema for a single module.  
- Do not make activation a UI-only toggle without backend enforcement.

---

## 18. EXACT DELIVERABLES

- **Docs:** This document; DELIVERABLES.md checklist.
- **DB:** 006_phase2_module_framework.sql.
- **Backend:** Module registry service (list with deps); dependency resolver; entitlement resolver; activation service; deactivation service; requireModuleActive middleware; audit events; GET /organizations/:id/modules/state; POST activate/deactivate; extend /me with navItems; module route mount and guard.
- **Frontend:** Modules page with table/cards from modules/state (name, code, version, scope, deps, entitlement, activation, actions, blockReason); sidebar built from navItems from /me.
- **Example module:** One module (e.g. code `example`) in registry with dependency optional; init hook that creates one organization_module_setting; one GET route /m/example that returns placeholder; guard on that route.
