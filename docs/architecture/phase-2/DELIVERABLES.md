# Phase 2 — Deliverables Checklist

## Docs
- [ ] `01-phase-2-implementation-package.md` — 18 sections
- [ ] `DELIVERABLES.md` — this file

## DB
- [ ] `006_phase2_module_framework.sql` — modules new columns, module_dependencies, module_settings, organization_module_settings, organization_modules status, modules:write permission
- [ ] `007_phase2_example_module_seed.sql` — example module + plan_modules

## Backend
- [ ] `entitlement.service.ts` — resolveEntitlement, resolveEntitlementsForOrganization
- [ ] `dependency.service.ts` — getDependencyCodes, getDependencyModuleIds, getMissingActiveDependencies
- [ ] `init-hooks.ts` — registerModuleActivateHook, runModuleActivateHook, registerExampleModuleHook
- [ ] `activation.service.ts` — activateModule, deactivateModule
- [ ] `modules-state.service.ts` — getModulesState
- [ ] `modules.service.ts` — listRegistryWithDependencies
- [ ] `modules.routes.ts` — GET /state, POST activate, POST deactivate
- [ ] `requireModuleActive.ts` middleware
- [ ] `example-module.routes.ts` — GET / guarded by requireModuleActive('example')
- [ ] Audit events: MODULE_ACTIVATED, MODULE_DEACTIVATED, MODULE_ACTIVATION_FAILED, MODULE_ACCESS_DENIED, MODULE_DEPENDENCY_CHECK_FAILED, MODULE_ENTITLEMENT_CHECK_FAILED, MODULE_INIT_RUN
- [ ] /me extended with navItems (core + active modules with nav_path)
- [ ] index.ts — registerExampleModuleHook(), mount /api/v1/m/example

## Frontend
- [ ] MeData.navItems; AppShell uses me.navItems for sidebar
- [ ] Endpoints: orgModulesState, orgModuleActivate, orgModuleDeactivate (under /modules/:id/...)
- [ ] Modules page: table from state API, entitlement/activation status, Activate/Deactivate, blockReason
- [ ] ExampleModulePage + route /m/example

## Verification
- [ ] Activate example module → org_modules active, sidebar shows Example
- [ ] Deactivate → sidebar hides Example, GET /m/example returns 403
- [ ] Audit log has module.activated, module.deactivated
- [ ] Entitlement/dependency block reason shown when Activate disabled
