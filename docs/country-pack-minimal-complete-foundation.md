# Country Pack Minimal Complete Foundation (Phase 7 - Step 10)

Status: Documentation-only contract.  
No code, no DB changes, no API, no UI, no module integration in this step.

References:
- `docs/country-pack-boundary.md`
- `docs/country-pack-domain-model.md`
- `docs/country-pack-schema-design.md`
- `docs/country-pack-ruleset-effective-date-model.md`
- `docs/country-pack-extension-contract.md`
- `docs/country-pack-organization-binding.md`
- `docs/owner-legal-control-panel-model.md`
- `docs/country-pack-command-catalog.md`
- `docs/country-pack-aggregates.md`
- `docs/country-pack-security-audit-isolation.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- frontend is dumb
- writes only through commands
- reads only through aggregates
- after command -> full refreshed aggregate/case
- Financial truth -> Accounting Base only
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Foundation summary

This is the minimal **professional** Country Pack foundation, not a throwaway MVP.  
Goal: establish stable platform-level contracts that avoid future architecture rewrite.

---

## 1) Included in first implementation

The first implementation must include:

1. `countries` registry
2. `country_packs` registry
3. `country_pack_rulesets`
4. `organization_country_settings`
5. `country_extension_capabilities` (at least minimal capability model if needed for safe extension gating)
6. `country_legal_values`
7. `country_legal_value_versions`
8. ruleset effective-date resolver
9. legal value resolver
10. organization country binding flow
11. platform_owner-only Owner Legal Control Panel backend model
12. command-only write model
13. aggregate-only read model
14. mandatory audit events for all governance changes
15. country isolation checks (eligibility + no cross-country leakage)

---

## 2) Explicitly NOT included yet

Not part of first implementation:

1. full Israel VAT module
2. real VAT calculations
3. payroll tax rules
4. full compliance calendar automation
5. automatic report generation
6. complex multi-country organization model
7. public UI for normal users
8. module integrations
9. client data migration

---

## 3) First supported country

- IL may be seeded as first country in registry.
- Framework must remain country-agnostic.
- No Israel-specific tax logic may be hardcoded into framework contracts.

---

## 4) First owner-managed value categories

Initial categories supported by Owner Legal Control Panel:

1. `VAT / מע"מ`
2. `Income Tax / מס הכנסה`
3. `National Insurance / ביטוח לאומי`
4. `Credit Points / נקודות זיכוי`
5. `Reports / דוחות`
6. `Pricing / מחירים`
7. `Calendar / מועדים`
8. `Modules / מודולים`

Category support is metadata/governance support, not full domain automation.

---

## 5) Required owner metadata for every legal/system value

Every legal/system value definition/version must support:

1. `key`
2. `label`
3. `category`
4. `module_scope`
5. `usage_hint`
6. `owner_note`
7. `value_type`
8. `effective_from`
9. `effective_to`
10. `status`
11. `audit trail`

Rules:
- `owner_note`, `usage_hint`, `module_scope` are governance metadata only.
- metadata must not affect legal calculations directly.
- owner metadata is owner-visible only.

---

## 6) First aggregates (required)

First implementation must include these aggregate contracts:

1. `owner_country_pack_admin_aggregate`
2. `owner_legal_values_aggregate`
3. `owner_platform_pricing_aggregate`
4. `organization_country_settings_aggregate`
5. `country_pack_diagnostics_aggregate`
6. `active_ruleset_context_aggregate` (backend/internal)

Access baseline:
- all `owner_*` aggregates: platform_owner only
- `organization_country_settings_aggregate`: restricted tenant/admin settings display only (no owner legal edit payload)
- `active_ruleset_context_aggregate`: internal only

---

## 7) First commands (required now vs future)

### Required in first implementation

Country/pack/ruleset/binding:

1. `create_country`
2. `create_country_pack`
3. `enable_country_pack`
4. `disable_country_pack`
5. `create_ruleset`
6. `update_ruleset_metadata`
7. `activate_ruleset`
8. `deactivate_ruleset`
9. `assign_country_pack_to_organization`
10. `change_active_ruleset_for_organization`
11. `update_organization_country_settings`

Legal values/pricing/owner metadata:

12. `create_legal_value`
13. `update_legal_value_metadata`
14. `create_legal_value_version`
15. `update_legal_value_version`
16. `activate_legal_value_version`
17. `deactivate_legal_value_version`
18. `update_module_price`
19. `update_package_price`
20. `update_owner_note`
21. `update_usage_hint`
22. `update_module_scope`

Security access rule:
- only `platform_owner` / product owner may execute legal/country truth commands.
- tenant roles (`owner/admin/staff/viewer`) must never modify legal/country truth.

### Future-phase commands (not required now)

1. `delete_legal_value` (policy currently unresolved/likely forbidden-by-default)
2. bulk import/apply commands with preview/approval
3. advanced workflow/approval/rollback orchestration commands

---

## 8) Acceptance criteria (foundation complete when all true)

Phase 7 foundation is complete only when all criteria below are met:

1. country registry exists.
2. IL country can exist as registry entry.
3. country pack can exist.
4. ruleset can be created and activated.
5. organization can be bound to eligible pack/ruleset.
6. non-IL organization cannot activate IL pack.
7. legal values can be created and versioned.
8. active legal value resolves by date.
9. `owner_note` / `usage_hint` / `module_scope` are stored and visible in owner aggregate.
10. platform_owner is the only actor allowed to manage legal truth.
11. audit exists for all required governance changes.
12. no client data is modified by foundation flows.
13. no Israel-specific logic is added to Core, Accounting Base, or global modules.

---

## 9) Future extension points

Planned extension points after foundation:

1. Israel VAT module integration (outside framework core boundaries)
2. compliance calendars
3. due-date engines
4. obligation generation
5. payroll/local tax packs
6. module pricing automation

All extensions must consume Country Pack contracts and must not move legal truth into modules/frontend.

---

## 10) Open questions / UNKNOWN

1. UNKNOWN: final delete policy for legal values (forbid vs archive-only vs limited hard delete).
2. UNKNOWN: pricing versioning depth (ruleset-only vs additional commercial version dimensions).
3. UNKNOWN: approval workflow requirement for high-risk activation commands.
4. UNKNOWN: rollback strategy for ruleset/value activation errors.
5. UNKNOWN: bulk operations safety policy (preview, dry-run, conflict handling).
6. UNKNOWN: final capability model minimum set for first implementation.
7. UNKNOWN: operational policy for orgs with country identity set but missing binding record.

