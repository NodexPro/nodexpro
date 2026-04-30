# Country Pack Boundary (Phase 7 - Step 1)

Status: Boundary definition only.  
No code, no schema/migrations, no API, no UI, no module integration in this step.

Architecture contract (non-negotiable):
- Core -> Commands -> Aggregate -> UI
- Frontend is dumb (render-only)
- Writes only through commands
- Reads only through aggregates
- After command -> full refreshed aggregate/case
- No PATCH / hidden GET / stitched reads / frontend business logic
- Financial truth -> Accounting Base only
- Country-specific legal logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Boundary summary

Country Pack Framework is a platform capability for hosting country-specific legal/ruleset behavior behind stable extension points.  
It is not a country implementation itself, not a client workspace, and not a replacement for Core or Accounting Base.

---

## 1) Country Pack Framework != Country Module

Country Pack Framework:
- infrastructure layer for country-aware rule plugins
- shared contract for rule registration, rule execution, and legal-value ownership
- stable integration surface for future country modules

Country Module (future, concrete):
- implementation of one jurisdiction (example: future Israel pack)
- actual legal dates, validators, filing constraints, and legal classifications

Rule:
- framework must stay country-agnostic
- country-specific behavior must live only in country modules

---

## 2) Legal values != Client data

Legal values:
- platform/ruleset-level legal definitions
- owned by Ruleset / Owner Legal Control Panel
- not tied to one client record as source truth

Client data:
- workspace/module data per client
- belongs to operational client domains
- never reclassified as legal ruleset ownership

Rule:
- legal values and client data must never share ownership semantics
- no client workspace can become legal-rules source of truth

---

## 3) Owner Panel != Client Workspace

Owner Legal Control Panel:
- manages legal/ruleset/platform values
- controls legal-effective ranges, rule activation metadata, policy versions
- no client operational state rendering

Client Workspace:
- renders client-specific state only
- applies already-resolved backend truth
- does not author legal rules

Rule:
- owner panel writes legal/ruleset state
- client workspace consumes resolved outcomes only

---

## 4) Country rules != Core

Core responsibilities:
- users, organizations, memberships, permissions
- tenant isolation and security boundaries
- common platform contracts

Core forbidden:
- country law logic
- VAT/tax filing specifics
- local legal calendars/threshold semantics

Rule:
- Core hosts permissions/scoping, not legal meaning

---

## 5) Country rules != Accounting Base

Accounting Base:
- canonical financial facts (entries, periods, categories, links, derived summaries)
- no local-country legal interpretation

Country Pack:
- local legal calendars, due-date engines, validators, legal classification rules
- localized legal explanation catalogs and constraints

Rule:
- Accounting Base stores financial truth only
- Country Pack interprets local legal rules only
- Accounting Base must not embed VAT/local tax law semantics

---

## Allowed responsibilities inside Country Pack Framework

1. Define country-pack extension contracts (interfaces, lifecycle, versioning model).
2. Provide rule execution orchestration boundary (command-triggered, backend-only).
3. Define legal-value ownership contract with Owner Legal Control Panel.
4. Define ruleset packaging model (metadata, activation policy, capability map).
5. Define legal calendar/validator provider contract shape (country-agnostic interface).
6. Define audit expectations for legal-value/ruleset changes (not client operational writes).
7. Define compatibility strategy between ruleset versions and aggregate read models.

---

## Forbidden responsibilities inside Country Pack Framework

1. Implement country law directly in framework layer.
2. Store/own client operational data as legal values.
3. Duplicate Core auth/org/permission/tenant logic.
4. Replace Accounting Base as financial truth owner.
5. Expose frontend-calculated legal decisions.
6. Add hidden read paths for legal truth outside aggregate flow.
7. Introduce direct PATCH/save-all mutation model for legal behavior.
8. Couple framework internals to one specific country implementation.

---

## Allowed extension points

1. Country pack registration point (country code, module metadata, capabilities).
2. Legal ruleset provider point (effective dates, legal configuration versions).
3. Validator engine point (input contract -> legal validation result contract).
4. Calendar/due-date provider point (rule context -> legal date outputs).
5. Legal labeling/explanation provider point (localized legal copy from backend catalog).
6. Aggregate enrichment point (backend-side legal status blocks, no UI calculation).

---

## Future relation to Israel Pack (without implementing it)

- Future Israel pack is a concrete consumer of this framework.
- Israel VAT/tax specifics must be implemented only in Israel pack layer.
- Framework must remain neutral so other countries can follow same contract.
- No Israel-specific constants, enums, thresholds, forms, or due-date rules belong in framework boundary definition.

---

## Guardrails for command/read flow

1. Any legal/ruleset write must be command-driven.
2. Any legal/ruleset read for screens must be aggregate-driven.
3. After legal command, backend must return refreshed aggregate/case.
4. UI must render returned truth only; no local legal calculation.

---

## Open questions / UNKNOWN

1. UNKNOWN: final country-pack registration schema (capabilities, semantic versioning fields).
2. UNKNOWN: ruleset version conflict policy across concurrent owner edits.
3. UNKNOWN: rollout model for legal-effective date transitions (instant vs staged activation).
4. UNKNOWN: multi-country organization policy (single active pack vs scoped-by-client context).
5. UNKNOWN: contract for legal explanation localization fallback when translation is missing.
6. UNKNOWN: long-term backward compatibility policy for deprecated rule signatures.
7. UNKNOWN: baseline audit retention policy for legal-value changes.
