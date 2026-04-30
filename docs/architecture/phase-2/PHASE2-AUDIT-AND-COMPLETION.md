# Phase 2 (Module Framework) — Audit and Completion

**Date:** 2025-03-08  
**Scope:** Audit Phase 2 against the required specification; implement missing parts to fully close Phase 2.

---

## 1. Phase 2 Audit Summary

### DONE (with evidence)

| Requirement | Evidence |
|-------------|----------|
| **Module Registry** — modules table with full metadata | `supabase/migrations/006_phase2_module_framework.sql`: `modules` has `version`, `category`, `schema_version`, `migration_version`, `nav_label`, `nav_path`, `nav_order`; `001_core_schema.sql` + `008_module_commerce_schema.sql`: `code`, `name`, `description`, `scope_type`, `country_code`, `is_active`, `is_sellable`, `default_visibility`, `is_system`. |
| **Module scope types** | `006`: check `scope_type in ('global', 'country', 'system')`. |
| **Module dependencies** | `006`: table `module_dependencies(module_id, depends_on_module_id)` with unique and no self-reference. `dependency.service.ts`: `getDependencyCodes`, `getDependencyModuleIds`, `getMissingActiveDependencies`, `topologicalSort` (cycle detection). |
| **Module Entitlement Engine** | `entitlement.service.ts`: `resolveEntitlement` returns `not_entitled` \| `entitled` \| `trial` \| `expired`; source = `organization_module_subscriptions` + `hasValidTrial`; system modules always entitled. Type `EntitlementStatus` in `api.ts` includes `restricted`. |
| **Module Activation Engine** | `activation.service.ts`: entitlement check → dependency check → init hook → insert/update `organization_modules` → audit. Statuses in DB: `inactive`, `activating`, `active`, `suspended`, `deactivated` (006). |
| **Deactivation** | `activation.service.ts`: `deactivateModule` — system module protected; update `organization_modules` to `deactivated`, set `deactivated_at`; audit `MODULE_DEACTIVATED`. |
| **Default settings on activation** | `init-hooks.ts`: `runModuleActivateHook`; example hook creates `organization_module_settings` row (key `initialized`). |
| **module_settings / organization_module_settings** | `006`: both tables exist with `module_id`, `key`, `value_json`; org-scoped table has `organization_id`. |
| **Module Loader (build-time)** | Routes wired in `index.ts`: `registerExampleModuleHook()`, `app.use('/api/v1/m/example', exampleModuleRouter)`. No runtime plugin loading; modules are code paths at build time. |
| **Module route guard** | `requireModuleActive.ts`: checks org context, module exists, `organization_modules.status === 'active'`; writes `MODULE_ACCESS_DENIED` on failure. `example-module.routes.ts`: uses `authMiddleware`, `requireOrg`, `requireModuleActive('example')`. |
| **Nav from backend** | `auth.routes.ts` GET `/me`: loads active `organization_modules` with `modules(nav_path, nav_label, nav_order)`; builds `navItems`; returns `enabledModules` and `navItems`. |
| **Sidebar from backend** | `AppShell.tsx`: uses `me.navItems` from `/me` (fallback `buildNavItemsFallback` only core routes when no navItems). |
| **Modules page data** | `GET /organizations/:id/modules/state` — `modules-state.service.ts`: returns per module: `moduleId`, `code`, `name`, `version`, `scopeType`, `category`, `dependencies`, `entitlementStatus`, `activationStatus`, `canActivate`, `canDeactivate`, `blockReason`, `availablePlans`, `currentSubscription`, etc. |
| **Modules page UI** | `Modules.tsx`: displays name, code, **version**, **scope**, **dependencies**, entitlement status, activation status, plans, current plan; actions use `canActivate`/`canDeactivate`/`blockReason` from API only (no client-side entitlement/activation logic). |
| **Activation API** | `modules.routes.ts`: `POST /:id/modules/:moduleId/activate` (requireOrg, modules:write); calls `activationService.activateModule`. |
| **Deactivation API** | `POST /:id/modules/:moduleId/deactivate`; calls `activationService.deactivateModule`. |
| **Audit events** | `audit-events.ts`: `MODULE_ACTIVATED`, `MODULE_DEACTIVATED`, `MODULE_INIT_RUN`, `MODULE_DEPENDENCY_CHECK_FAILED`, `MODULE_ENTITLEMENT_CHECK_FAILED`, `MODULE_ACCESS_DENIED`, `MODULE_ACTIVATION_BLOCKED`, `SYSTEM_MODULE_PROTECTED`, plus commerce/trial events. |
| **Versioning** | `modules` has `version`, `schema_version`, `migration_version` (006). |
| **Registry API** | `GET /api/v1/modules`: `modulesService.listRegistryWithDependencies()` — modules with dependency codes. |

### PARTIALLY DONE (gaps addressed in this pass)

| Requirement | Status | Gap | Resolution |
|-------------|--------|-----|------------|
| **Module route security** — validate entitlement + activation | Guard only checked activation. | Spec: "Access to module functionality must validate: permission, entitlement, activation." | Add entitlement check in `requireModuleActive`: after activation check, resolve entitlement; if not entitled/trial → 403 and audit. |
| **onDeactivate hook** | Only `onActivate` existed. | Spec: "on_module_deactivate" in activation process. | Add `registerModuleDeactivateHook` / `runModuleDeactivateHook` and call from `deactivateModule`. |
| **Observability — module_loaded** | Not logged. | Spec: "System should log … module_loaded". | Add `MODULE_LOADED` (and `MODULE_REGISTERED` for future); log `MODULE_LOADED` at API startup when module framework is ready. |

### NOT DONE (and deferred)

| Item | Reason |
|------|--------|
| **module_registered** | Fired when a module row is created; no API for creating modules in Phase 2. **DEFERRED:** add when admin module creation exists. |
| **on_module_upgrade** | Per implementation package §14, deferred to upgrade story. |
| **Cascade deactivation of dependents** | Documented as known limitation; optional guard check deferred. |

---

## 2. Root Gaps (addressed)

- **API guard did not re-check entitlement** — If entitlement was revoked (e.g. trial ended) but the row stayed `active`, the module API could still be called. Fixed by resolving entitlement in `requireModuleActive` and denying access when not entitled/trial.
- **onDeactivate hook contract missing** — Deactivation did not run a module hook. Fixed by adding deactivate hook registration and execution in `deactivateModule`.
- **module_loaded not logged** — No observability event when the module framework is ready. Fixed by adding `MODULE_LOADED` and logging it at startup (and `MODULE_REGISTERED` for future use).

**Architectural risks:** None introduced. Backend remains authoritative; frontend unchanged.

**Deferred:** `module_registered` (until module creation API exists); `on_module_upgrade`; cascade deactivation of dependents.

---

## 3. Implementation Plan

| Area | Change |
|------|--------|
| **Backend — security** | In `requireModuleActive`: after confirming module is active for org, call `resolveEntitlement(organizationId, moduleId)`; if status not `entitled` or `trial`, return 403 and write `module.access_denied` with reason. |
| **Backend — hooks** | In `init-hooks.ts`: add `ModuleDeactivateContext`, `registerModuleDeactivateHook`, `runModuleDeactivateHook`. In `activation.service.ts`: after updating `organization_modules` to deactivated, call `runModuleDeactivateHook`. |
| **Backend — observability** | In `audit-events.ts`: add `MODULE_LOADED`, `MODULE_REGISTERED`. At API startup (e.g. in `index.ts` after registering hooks): load registry (e.g. list modules count), then `writeAudit({ organizationId: null, actorUserId: null, action: MODULE_LOADED, … })`. |
| **Schema** | None. |
| **Frontend** | None. |
| **API contracts** | No new endpoints; behavior of existing module routes becomes stricter (403 when entitlement lost). |

---

## 4. Files Changed

| File | Change |
|------|--------|
| `apps/api/src/shared/audit-events.ts` | Add `MODULE_LOADED`, `MODULE_REGISTERED` to `AUDIT_ACTIONS`. |
| `apps/api/src/domains/modules/init-hooks.ts` | Add `ModuleDeactivateContext`, `registerModuleDeactivateHook`, `runModuleDeactivateHook`. Export and call from activation.service. |
| `apps/api/src/domains/modules/activation.service.ts` | After updating `organization_modules` in `deactivateModule`, call `runModuleDeactivateHook(ctx)`. |
| `apps/api/src/middleware/requireModuleActive.ts` | After activation check, resolve entitlement; if not entitled/trial, 403 and audit `MODULE_ACCESS_DENIED` (reason: entitlement). |
| `apps/api/src/index.ts` | After `registerExampleModuleHook()`, run async bootstrap: load module registry (e.g. listModules), then writeAudit MODULE_LOADED (null org, null actor). |
| `apps/web/src/pages/Modules.tsx` | Display version, scope, and dependencies per commercial module (data already from API). |

---

## 5. DB / Migration Changes

None. All required schema (modules, module_dependencies, organization_modules, module_settings, organization_module_settings) and status values already exist.

---

## 6. API Contracts

- **Existing endpoints unchanged:** `GET /modules`, `GET /organizations/:id/modules/state`, `POST .../activate`, `POST .../deactivate`, `GET /me`, `GET /api/v1/m/example`.
- **Behavior change:** Any route protected by `requireModuleActive(moduleCode)` now returns **403** when the organization has lost entitlement for that module (e.g. trial expired, subscription ended), in addition to when the module is not active. Response body remains `{ code: 'FORBIDDEN', message: '…' }`.

---

## 7. Phase 2 Completion Checklist

| Spec item | Implemented evidence |
|-----------|----------------------|
| Registry exists | `modules` table; `GET /modules`; `listRegistryWithDependencies`; dependency codes from `module_dependencies`. |
| Entitlement engine works | `resolveEntitlement`; states not_entitled, entitled, trial, expired (restricted in type); used in activation and in modules/state; **and** in `requireModuleActive`. |
| Activation engine works | `activateModule`: entitlement → dependencies → init hook → upsert organization_modules → audit. |
| Module loader works | Build-time registration in `index.ts`; hooks registered; routes mounted; **MODULE_LOADED** logged at startup. |
| Module isolation | Modules use own tables and Core contracts; no cross-module private DB access; guard on every module route. |
| Dependency resolver works | `getDependencyCodes`, `getMissingActiveDependencies`; activation blocks when dependencies missing; cycle detection in `topologicalSort`. |
| Sidebar builds dynamically | `/me` returns `navItems` from active modules + core; frontend uses `me.navItems`. |
| API is protected | `requireModuleActive`: auth + org + **entitlement** + activation; permission on module routes where required. |
| Audit works | `MODULE_ACTIVATED`, `MODULE_DEACTIVATED`, `MODULE_INIT_RUN`, `MODULE_ACCESS_DENIED`, `MODULE_DEPENDENCY_CHECK_FAILED`, `MODULE_ENTITLEMENT_CHECK_FAILED`, `MODULE_LOADED`. |
| onActivate hook | `runModuleActivateHook` in activation; example creates `organization_module_settings`. |
| onDeactivate hook | `runModuleDeactivateHook` in deactivation; contract in `init-hooks.ts`. |

---

## 8. QA Checklist

1. **Activate a test module** — e.g. example; confirm `organization_modules` row is `active`.
2. **Confirm entitlement is checked** — Activate only when entitled or trial; block with message when not.
3. **Confirm dependencies are checked** — Add dependency to example; activate dependency first, then module; try activating without dependency → block reason.
4. **Confirm default settings are created** — After activating example, check `organization_module_settings` for key `initialized`.
5. **Open module screen** — With module active, open `/m/example` (or frontend route) → 200.
6. **Deactivate module** — Deactivate → sidebar entry disappears; `organization_modules.status` = `deactivated`.
7. **Try opening route directly** — With module inactive, call `GET /api/v1/m/example` with org header → 403.
8. **Confirm audit records exist** — `module.activated`, `module.deactivated`, `module.init_run`, and after this pass `module.loaded` at startup.
9. **Call inactive module API** — Module deactivated for org → 403.
10. **Call module API without entitlement** — E.g. trial ended or subscription ended for that module but row still active → 403 (after this implementation).
11. **Call module API without permission** — Remove modules:read / appropriate permission → 403.
12. **Verify organization_module record** — After activate: row exists, status active; after deactivate: status deactivated, deactivated_at set.
13. **Verify module_settings / organization_module_settings** — Example hook creates org_module_setting; no direct verification of global module_settings required for Phase 2.
14. **Sidebar** — Entries for active modules with nav_path from backend; no hardcoded module list.

---

## 9. Before / After Notes

**Before (gaps):**

- Module API guard only checked activation; if entitlement was revoked later, access was still allowed until someone deactivated the module.
- No onDeactivate hook; modules could not run cleanup or teardown on deactivation.
- No `module_loaded` (or `module_registered`) audit event for observability.

**After (complete):**

- Module API access requires both activation and current entitlement (entitled or trial); otherwise 403 and audit.
- Deactivation runs `runModuleDeactivateHook` so modules can register cleanup logic.
- At startup, the API logs `MODULE_LOADED` to the audit log (system event, null org/actor); `MODULE_REGISTERED` is defined for future use when module creation is implemented.

Phase 2 is **closed** per the specification and implementation package, with the listed deferred items documented.
