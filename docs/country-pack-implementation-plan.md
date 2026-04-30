# Country Pack Implementation Plan (Phase 7 - Step 12)

Status: Documentation-only implementation plan.  
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
- `docs/country-pack-minimal-complete-foundation.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- frontend is dumb
- writes only through commands
- reads only through aggregates
- after command -> full refreshed aggregate/case
- no PATCH / no hidden GET / no stitched reads
- Financial truth -> Accounting Base only
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Plan summary

This plan defines a safe and strict implementation order for Phase 7 Country Pack Foundation.  
The order is mandatory to avoid architectural debt and future rewrites.

---

## Strict phase order (mandatory)

## 1) Core/owner access preparation

Implement first:
- platform_owner access model baseline
- owner-only permission guard baseline
- audit event base model for owner/country/ruleset/legal actions

Exit criteria:
- governance boundary between platform owner and tenant RBAC is explicit and testable.

---

## 2) Database schema / migrations

Implement schema in this order:
1. `countries`
2. `country_packs`
3. `country_pack_rulesets`
4. `organization_country_settings`
5. `country_extension_capabilities`
6. `country_legal_values`
7. `country_legal_value_versions`

Exit criteria:
- schema supports versioned legal values and organization binding without module coupling.

---

## 3) Internal services

Implement internal-only services:
- country registry service
- country pack registry service
- ruleset resolver
- legal value resolver
- organization country settings service
- owner legal values service
- pricing values service

Exit criteria:
- service layer provides deterministic resolver behavior and tenant/country-safe operations.

---

## 4) Commands

Implement command handlers (no generic PATCH model):
- country/pack commands
- ruleset commands
- organization binding commands
- legal value commands
- owner metadata commands (`owner_note`, `usage_hint`, `module_scope`)
- pricing commands

Exit criteria:
- all writes go through commands with validation + audit + refreshed aggregate response contract.

---

## 5) Aggregates

Implement read models:
- `owner_country_pack_admin_aggregate`
- `owner_legal_values_aggregate`
- `owner_platform_pricing_aggregate`
- `organization_country_settings_aggregate`
- `country_pack_diagnostics_aggregate`
- `active_ruleset_context_aggregate` (internal)

Exit criteria:
- each aggregate is ready-to-render and removes need for frontend business logic.

---

## 6) Security and audit

Enforce:
- platform_owner-only governance command access
- country eligibility checks (including IL eligibility boundary)
- tenant isolation checks
- full audit event coverage
- explicit guarantee: no client data mutation in Country Pack governance flows

Exit criteria:
- command-level and aggregate-level security policy passes negative cases.

---

## 7) Owner Legal Control Panel backend/API

Allowed only after phases 1-6 are done.

Rules:
- command endpoint only for writes
- aggregate reads only
- no generic PATCH
- no direct table mutation path

Exit criteria:
- backend contract matches command/aggregate architecture and owner-only access rules.

---

## 8) Owner Legal Control Panel UI

Allowed only after phase 7 backend contract is stable.

Rules:
- dumb renderer only
- tables/actions/statuses from aggregate
- `owner_note` visible next to value/version
- no frontend ruleset/date/value calculations

Exit criteria:
- UI acts as command trigger + aggregate renderer only.

---

## 9) Organization settings integration

Integrate after owner panel core is stable:
- reuse existing Organization Profile Country field
- add Country Configuration block later/adjacent
- never place legal values in organization profile identity payload

Exit criteria:
- organization settings display country binding truth without exposing owner-only legal payloads.

---

## 10) Tests / QA

Required verification suite:
- ruleset overlap rejection
- legal value version date resolution
- owner-only access enforcement
- non-IL cannot activate IL pack
- no client data mutation in governance flows
- command response returns full refreshed aggregate contract
- required audit emitted for all governance commands/auth actions

Exit criteria:
- durable tests cover architecture invariants and negative isolation/security cases.

---

## 11) Explicitly deferred

Deferred after foundation stability:
- Israel VAT module
- real due-date engine implementation
- payroll logic
- module integrations
- client data migration
- public tenant UI beyond organization settings diagnostics

Exit criteria for deferred start:
- Country Pack foundation is stable and validated by security/audit/QA gates.

---

## Strict ordering rules (non-negotiable)

1. No UI before aggregates.
2. No API before commands.
3. No commands before schema.
4. No Israel-specific logic before framework foundation is stable.
5. No module integration before Country Pack foundation is stable.

Any violation means phase is not complete.

---

## What to implement first

Immediate first milestone:
1. Phase 1 (core/owner access prep)
2. Phase 2 (schema/migrations)
3. Phase 3 (internal services)

These three phases establish the non-negotiable platform foundation for all later steps.

---

## Risks and mitigation

1. Risk: leaking tenant RBAC into owner governance access.
   - Mitigation: explicit platform_owner guards + negative tests.
2. Risk: overlap/gap bugs in ruleset/legal value effective-date model.
   - Mitigation: strict resolver validations + QA overlap matrix.
3. Risk: frontend begins legal calculations due to incomplete aggregates.
   - Mitigation: aggregate completeness gate before UI work.
4. Risk: premature country-specific module logic (e.g., IL logic) bypassing framework.
   - Mitigation: strict deferred policy + architecture enforcer checks.
5. Risk: unaudited governance mutations.
   - Mitigation: audit event requirements as command completion precondition.

---

## Open questions / UNKNOWN

1. UNKNOWN: SMS provider selection/failover strategy for platform owner auth flows.
2. UNKNOWN: secure storage and rotation model for owner private access key.
3. UNKNOWN: final one-time recovery code expiration and lockout policy.
4. UNKNOWN: legal value delete policy (forbid vs archive-only vs constrained delete).
5. UNKNOWN: approval workflow requirement for sensitive activation commands.
6. UNKNOWN: rollback strategy for production ruleset/value activation errors.
7. UNKNOWN: bulk operations/import policy and safety guard requirements.

