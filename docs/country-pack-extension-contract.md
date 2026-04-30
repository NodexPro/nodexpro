# Country Pack Extension Contract (Phase 7 - Step 5)

Status: Contract definition only.  
No migrations, no DB changes, no code, no API, no UI, no module integration in this step.

References:
- `docs/country-pack-boundary.md`
- `docs/country-pack-domain-model.md`
- `docs/country-pack-schema-design.md`
- `docs/country-pack-ruleset-effective-date-model.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Financial truth -> Accounting Base only
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only
- Frontend is render-only

---

## Contract summary

Country Pack Framework exposes backend extension hooks for country-specific legal behavior.  
Modules may consume resolved legal outcomes via commands/aggregates, but may not own country logic as source of truth.

---

## Global hook contract rules

Applies to every Country Pack hook:

1. Hooks execute backend-side only.
2. Caller must provide org/country/date context.
3. Hook must resolve active ruleset via framework policy (never frontend).
4. Hook output must be deterministic for given context and ruleset.
5. Hook must not mutate business state unless explicitly defined as command-side generator.
6. Hook failures are explicit and typed; no silent fallback to wrong country/ruleset.
7. Hook output should be aggregate-ready where relevant (no frontend business calculation).

---

## Hook 1: Validators

### Purpose
Validate legal-country constraints for module command/aggregate preparation.

### Input contract
- organization context
- country context
- requested date/effective date
- hook-specific payload to validate
- resolved ruleset reference (or resolver context)

### Output contract
- `valid: boolean`
- `errors[]` (typed legal validation codes/messages)
- optional `warnings[]`

### Who may call
- backend command handlers
- backend aggregate builders

### May read
- resolved ruleset metadata
- legal values/versions via framework resolvers

### Must NOT read
- client private business logic tables as legal source
- frontend state

### Can mutate state
- No

### Required tenant/country checks
- org eligibility and country binding required
- ruleset resolvable for date required

### Failure behavior
- controlled validation failure (typed)
- no implicit fallback to different ruleset/country

---

## Hook 2: Ruleset resolver

### Purpose
Resolve active country pack ruleset for organization + date context.

### Input contract
- organization id
- country id/code (or infer from organization settings)
- requested date

### Output contract
- resolved `country_pack`
- resolved `country_pack_ruleset`
- effective window metadata

### Who may call
- backend command handlers
- backend aggregate builders
- other Country Pack hooks

### May read
- `organization_country_settings`
- `country_packs`
- `country_pack_rulesets`

### Must NOT read
- client operational data as legal source

### Can mutate state
- No

### Required tenant/country checks
- organization-country binding must exist and be valid
- no overlap ambiguity

### Failure behavior
- explicit `ruleset_not_resolved` / `ruleset_overlap_conflict`
- behavior disabled for caller flow

---

## Hook 3: Legal values resolver

### Purpose
Resolve concrete legal value versions for a ruleset and date.

### Input contract
- resolved ruleset id
- requested date
- legal value key(s)

### Output contract
- map of `legal_value_key -> legal_value_version + value_payload`
- value metadata (version/effective range)

### Who may call
- validators
- due-date engine
- obligation generator
- aggregate builders

### May read
- `country_legal_values`
- `country_legal_value_versions`

### Must NOT read
- client data rows
- accounting entries/summaries as legal values

### Can mutate state
- No

### Required tenant/country checks
- ruleset-country consistency required
- effective-date validity required

### Failure behavior
- explicit missing/ambiguous value failure
- no default hardcoded substitution

---

## Hook 4: Due-date engine

### Purpose
Produce due-date outcomes from resolved legal values/ruleset context.

### Input contract
- organization/country context
- resolved ruleset
- requested date period/context
- optional module task context key

### Output contract
- due date(s)
- due date source references (ruleset/value versions)
- optional status metadata (upcoming/overdue window descriptors)

### Who may call
- backend aggregate builders
- backend command precondition logic

### May read
- ruleset + legal values via resolvers
- calendar metadata via compliance hook

### Must NOT read
- frontend draft state
- client private workaround configs

### Can mutate state
- No

### Required tenant/country checks
- organization eligibility + country binding required

### Failure behavior
- controlled failure, caller receives explicit unresolved state

---

## Hook 5: Obligation generator

### Purpose
Generate backend obligation definitions from country ruleset context.

### Input contract
- organization/country context
- resolved ruleset
- period/time context
- module capability key

### Output contract
- obligation descriptors (typed)
- legal source references
- action descriptors for commands

### Who may call
- backend command orchestration
- backend aggregate builders

### May read
- ruleset/legal values
- compliance calendar outputs

### Must NOT read
- client private legal tables outside framework contracts

### Can mutate state
- Yes, only when called inside explicit command flow with audit
- No mutation in pure read/aggregate context

### Required tenant/country checks
- org/country/ruleset validity required

### Failure behavior
- controlled generator failure + no partial silent obligations

---

## Hook 6: Document type extensions

### Purpose
Provide country-scoped legal document type descriptors.

### Input contract
- organization/country context
- resolved ruleset
- module/document scope key

### Output contract
- legal document type list
- labels/descriptions/required flags
- legal metadata references

### Who may call
- backend aggregate builders
- backend validation layer

### May read
- ruleset/legal values and country metadata

### Must NOT read
- module-local hardcoded legal doc definitions as truth

### Can mutate state
- No

### Required tenant/country checks
- organization eligibility required

### Failure behavior
- explicit unresolved extension error

---

## Hook 7: Metadata extensions

### Purpose
Provide country-scoped metadata dictionaries for backend presentation semantics.

### Input contract
- resolved ruleset
- metadata domain key

### Output contract
- typed metadata map
- version/effective references

### Who may call
- backend aggregate builders

### May read
- ruleset/legal value versions

### Must NOT read
- frontend-owned metadata stores

### Can mutate state
- No

### Required tenant/country checks
- context and ruleset validity required

### Failure behavior
- explicit metadata-unavailable state

---

## Hook 8: Reporting extensions

### Purpose
Provide country-scoped reporting definitions/constraints (not report financial truth).

### Input contract
- organization/country/ruleset context
- report capability key
- period context

### Output contract
- reporting constraint descriptors
- legal field definitions
- compliance flags

### Who may call
- backend report aggregate builders
- backend report command validation

### May read
- ruleset/legal values/capabilities

### Must NOT read
- accounting financial truth as legal-rule source

### Can mutate state
- No (except explicit command-side controlled generation events)

### Required tenant/country checks
- required before any report legal behavior is returned

### Failure behavior
- controlled failure, no silent non-country fallback

---

## Hook 9: Compliance calendar

### Purpose
Resolve legal compliance calendar semantics for country context.

### Input contract
- org/country/ruleset context
- date range
- optional obligation/report scope

### Output contract
- compliance calendar windows
- legal milestone descriptors
- source references

### Who may call
- due-date engine
- obligation generator
- aggregate builders

### May read
- ruleset/legal values

### Must NOT read
- frontend local calendars
- module-local hardcoded calendars as truth

### Can mutate state
- No

### Required tenant/country checks
- org-country eligibility + ruleset resolution required

### Failure behavior
- explicit unresolved calendar state

---

## Hook 10: Local settings schema

### Purpose
Provide country-scoped backend schema descriptors for legal settings fields (owner panel/backend forms).

### Input contract
- country/ruleset context
- schema domain key

### Output contract
- field descriptors (types, requiredness, constraints, labels)
- default/legal metadata references

### Who may call
- Owner Legal Control Panel backend layer
- backend validators

### May read
- legal values and capability metadata

### Must NOT read
- client workspace settings as legal schema truth

### Can mutate state
- No

### Required tenant/country checks
- owner governance context + country pack eligibility checks

### Failure behavior
- explicit schema-unavailable error

---

## Hook 11: Allowed UI section descriptors

### Purpose
Provide backend-prepared, aggregate-safe UI section descriptors for country-dependent displays.

### Input contract
- module aggregate context key
- org/country/ruleset context

### Output contract
- section descriptors:
  - section keys
  - labels
  - visibility flags
  - action availability (backend evaluated)
  - disabled reasons

### Who may call
- backend aggregate builders only

### May read
- ruleset/legal values
- module capability metadata

### Must NOT read
- frontend local state as truth

### Can mutate state
- No

### Required tenant/country checks
- required before returning country-dependent section descriptors

### Failure behavior
- controlled unresolved-section state; no frontend-side guessing

---

## Module integration rule (mandatory before implementation/change)

Before any module is implemented or changed, classify:

1. Financial truth? -> Accounting Base  
2. Country-specific logic? -> Country Pack Framework  
3. Client/shared entity? -> Core/shared entity  
4. Write? -> Command  
5. Read? -> Aggregate

If classification is unclear, implementation is blocked until classification is explicit.

---

## Forbidden module behavior

1. Hardcoding legal dates/rates/limits in module logic.
2. Storing country-specific legal rules as module source of truth.
3. Calculating due dates on frontend.
4. Calling Country Pack private tables directly from module code.
5. Activating country logic without organization eligibility checks.
6. Leaking country-specific logic from one country context to another.
7. Resolving ruleset on frontend.

---

## Allowed module behavior

1. Request resolved legal values from backend Country Pack service.
2. Receive `due_date` and legal statuses from aggregate payload.
3. Receive obligation definitions from Country Pack hooks.
4. Receive backend-prepared UI section descriptors where allowed.
5. Consume resolved ruleset outputs only; never author legal values.

---

## Owner Legal Control Panel relation

Owner panel:
- edits legal values and rulesets
- controls activation/deprecation/disable lifecycle
- handles conflicts (overlap/gap visibility)

Modules:
- consume resolved legal outputs only
- must not modify legal values/rulesets directly
- must not bypass Country Pack governance flow

---

## Example flow (country-agnostic, no Israel implementation)

1. Module aggregate builder starts with org + date context.
2. Calls Country Pack ruleset resolver.
3. Resolver returns active pack + active ruleset.
4. Module asks legal values resolver for needed legal value key(s).
5. Resolver returns value versions and payload.
6. Aggregate builder composes ready field/status/action descriptors.
7. Aggregate returns full ready-to-render truth to UI.
8. UI renders only; does not resolve ruleset or compute legal meaning.

---

## Open questions / UNKNOWN

1. UNKNOWN: final typed error taxonomy shared across all hooks.
2. UNKNOWN: hook execution ordering guarantees when multiple hooks are chained.
3. UNKNOWN: cache invalidation policy for ruleset/legal-value changes.
4. UNKNOWN: strict timeout/retry policy for hook resolver failures.
5. UNKNOWN: capability negotiation model for modules with partial hook support.
6. UNKNOWN: formal compatibility matrix between hook contract versions and pack code versions.
