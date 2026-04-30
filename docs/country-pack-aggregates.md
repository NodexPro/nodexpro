# Country Pack Aggregates (Phase 7 - Step 8)

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

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Reads only through aggregates
- Writes only through commands
- After command -> full refreshed aggregate/case
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only
- Frontend is render-only

---

## Aggregate contract principles

1. Every aggregate is backend-resolved truth; frontend must not compute legal meaning.
2. Aggregate output is ready-to-render and includes backend-evaluated action availability.
3. No hidden side-read is allowed as UI truth source for one screen.
4. Owner aggregates never include client data payload.
5. Tenant-facing aggregates must not expose owner-only legal edit data.
6. Internal aggregates are not directly exposed to frontend.

---

## Access model

- `owner_*` aggregates: platform owner/product owner only.
- `organization_country_settings_aggregate`: can be visible to allowed organization/admin views for binding status, but no owner legal value editing payload.
- `country_pack_diagnostics_aggregate`: platform owner by default; optional restricted admin diagnostic visibility if policy allows and data scope is safe.
- `active_ruleset_context_aggregate`: backend/internal only, never direct frontend response.

Tenant roles (`owner/admin/staff/viewer`) must never receive owner-only legal management surface.

---

## 1) `owner_country_pack_admin_aggregate`

### Purpose
Platform-owner administration workspace for countries, packs, rulesets, lifecycle status, and governance diagnostics.

### Allowed caller
- `platform_owner` / product owner only.

### Source tables (conceptual)
- `countries`
- `country_packs`
- `country_pack_rulesets`
- `organization_country_settings` (for usage/impact diagnostics only)
- audit source for country/pack/ruleset actions

### Input parameters
- optional country filter (`country_code`)
- optional status filter
- optional effective date probe
- pagination/sort options

### Returned sections
1. countries table
2. country packs table
3. rulesets table
4. status summary (active/disabled/draft/deprecated counts)
5. warnings/errors panel
6. audit summary panel
7. available actions

### Table model (minimum columns)
- Countries: `country_code`, `display_name`, `status`, `created_at`
- Packs: `pack_id`, `country_code`, `pack_code`, `code_version`, `status`, `updated_at`
- Rulesets: `ruleset_id`, `pack_id`, `ruleset_version`, `status`, `effective_from`, `effective_to`, `updated_at`

### Returned actions
- create country
- create/enable/disable pack
- create/update/activate/deactivate ruleset
- inspect overlap/conflict diagnostics

### Permission/access rules
- strict platform-owner access
- no tenant role fallback

### What UI must NOT calculate
- ruleset overlap validity
- status transition legality
- effective-date conflict logic

### Command refresh behavior
- country/pack/ruleset commands refresh this aggregate after success.

---

## 2) `owner_legal_values_aggregate`

### Purpose
Platform-owner workspace for legal/system values and their versions, including owner governance metadata.

### Allowed caller
- `platform_owner` / product owner only.

### Source tables (conceptual)
- `country_legal_values`
- `country_legal_value_versions`
- `country_pack_rulesets` (for ruleset context)
- audit source for legal value actions

### Input parameters
- country/pack/ruleset filters
- category filter
- module scope filter
- status filter
- effective date probe
- pagination/sort options

### Returned sections
1. legal values table
2. legal value versions table
3. current active value summary
4. validation warnings panel
5. audit summary panel
6. available actions

### Table model (minimum columns)
- Legal values:
  - `legal_value_id`
  - `code`
  - `category`
  - `module_scope`
  - `usage_hint`
  - `owner_note`
  - `status`
- Legal value versions:
  - `legal_value_version_id`
  - `ruleset_id`
  - `effective_from`
  - `effective_to`
  - `status`
  - `is_current_active`
  - `value_preview`

### Returned actions
- create/update legal value definition metadata
- create/update/activate/deactivate legal value version
- update owner note/usage hint/module scope
- run overlap/coverage diagnostics

### Permission/access rules
- strict platform-owner access
- owner metadata fields must never be exposed to tenant UIs

### What UI must NOT calculate
- active value selection logic
- effective-date resolution
- overlap detection
- lifecycle transition rules

### Command refresh behavior
- all legal value/pricing/owner metadata commands refresh this aggregate after success.

---

## 3) `owner_platform_pricing_aggregate`

### Purpose
Platform-owner workspace for module/package pricing values managed as legal/system value contract.

### Allowed caller
- `platform_owner` / product owner only.

### Source tables (conceptual)
- pricing-scoped legal values in:
  - `country_legal_values`
  - `country_legal_value_versions`
- module/package registry references (for identifiers only, no tenant client data)
- audit source for pricing commands

### Input parameters
- module/package scope filters
- currency filter
- country/ruleset/effective date filters
- pagination/sort options

### Returned sections
1. modules/packages table
2. current price summary
3. version/effective date table
4. audit summary panel
5. available actions

### Table model (minimum columns)
- `scope_type` (`module`/`package`)
- `scope_id`
- `scope_label`
- `current_price`
- `currency`
- `effective_from`
- `effective_to`
- `owner_note`
- `status`

### Returned actions
- update module price
- update package price
- inspect effective-date conflicts

### Permission/access rules
- strict platform-owner access

### What UI must NOT calculate
- active pricing selection
- currency fallback rules
- effective-date conflict handling

### Command refresh behavior
- pricing update commands refresh this aggregate and may also refresh `owner_legal_values_aggregate`.

---

## 4) `organization_country_settings_aggregate`

### Purpose
Organization settings read model for country binding and pack/ruleset operational state.

### Allowed caller
- platform owner (full diagnostics)
- allowed organization/admin settings views (restricted fields, no owner legal edit payload)

### Source tables (conceptual)
- organization identity source (`country_code`)
- `organization_country_settings`
- `country_packs`
- `country_pack_rulesets`
- diagnostics derived from resolver policy

### Input parameters
- `organization_id`
- optional effective date probe

### Returned sections
1. organization country code
2. eligible packs list
3. active country pack
4. active ruleset
5. settings status
6. diagnostics/warnings
7. available actions

### Table/list model
- eligible packs:
  - `pack_id`
  - `pack_code`
  - `status`
  - `is_eligible`
  - `ineligible_reason` (if any)

### Returned actions
- set organization country (if permitted in current context)
- assign pack
- change active ruleset
- update settings status

### Permission/access rules
- tenant-facing version must not expose owner legal values, owner notes, or editing controls for legal definitions

### What UI must NOT calculate
- eligibility logic
- ruleset resolution
- diagnostics severity/status

### Command refresh behavior
- organization binding commands refresh this aggregate after success.

---

## 5) `country_pack_diagnostics_aggregate`

### Purpose
Operational diagnostic read model for validating resolved country context and configuration health.

### Allowed caller
- platform owner by default
- optional restricted admin diagnostics if policy allows

### Source tables (conceptual)
- organization identity country source
- `organization_country_settings`
- `country_packs`
- `country_pack_rulesets`
- capability metadata sources
- resolver diagnostics source

### Input parameters
- `organization_id`
- `effective_date` test probe

### Returned sections
1. organization country
2. resolved pack
3. resolved ruleset
4. effective-date test result
5. enabled capabilities
6. missing ruleset warnings
7. isolation status
8. available actions (diagnostic/action suggestions)

### Table/list model
- diagnostics rows:
  - `code`
  - `severity`
  - `message`
  - `context`
  - `recommended_action`

### Returned actions
- open binding aggregate context
- propose allowed corrective commands

### Permission/access rules
- no client data payload
- diagnostics visibility constrained by governance policy

### What UI must NOT calculate
- capability enablement rules
- effective-date resolution diagnostics
- isolation pass/fail determination

### Command refresh behavior
- refresh on organization binding, pack enable/disable, and ruleset activation/deactivation commands.

---

## 6) `active_ruleset_context_aggregate` (internal)

### Purpose
Internal backend read model for module aggregate builders/commands to consume resolved country ruleset context without owning country logic.

### Allowed caller
- backend internal services only (aggregate builders, validators, command handlers)
- never direct frontend call

### Source tables (conceptual)
- organization identity country source
- `organization_country_settings`
- `country_packs`
- `country_pack_rulesets`
- `country_legal_values`
- `country_legal_value_versions`

### Input parameters
- `organization_id`
- `effective_date`
- optional capability/module scope key

### Returned sections
1. organization id
2. country code
3. active pack
4. active ruleset
5. resolved legal values (scoped)
6. effective date context
7. warnings/errors

### Returned actions
- none for UI; internal consumers may receive backend hints for command eligibility.

### Permission/access rules
- internal service boundary only
- must enforce tenant-safe org scoping

### What UI must NOT calculate
- all of it; this model is not for direct UI consumption

### Command refresh behavior
- refreshed/recomputed after relevant country/ruleset/legal value/binding command commits and then consumed by public aggregates.

---

## Command -> aggregate refresh mapping (required)

### Country/pack/ruleset commands
- refresh `owner_country_pack_admin_aggregate`
- refresh `country_pack_diagnostics_aggregate` where org impact exists
- refresh internal `active_ruleset_context_aggregate` cache/context as needed

### Legal value + pricing + owner metadata commands
- refresh `owner_legal_values_aggregate`
- refresh `owner_platform_pricing_aggregate` for pricing scopes
- refresh internal `active_ruleset_context_aggregate` for affected scope/date windows

### Organization binding commands
- refresh `organization_country_settings_aggregate`
- refresh `country_pack_diagnostics_aggregate`
- refresh internal `active_ruleset_context_aggregate`

All refreshes follow full aggregate truth replacement pattern.

---

## Forbidden read patterns

Explicitly forbidden:

1. Frontend resolving active ruleset.
2. Frontend calculating due dates/rates/legal limits.
3. Hidden GET endpoints for legal values as side-truth for same screen.
4. Stitched reads from multiple country tables as frontend-owned truth.
5. Exposing owner legal values metadata to tenant users.
6. Returning client data inside owner aggregates.
7. Returning partial legal context that forces frontend business logic reconstruction.

---

## Open questions / UNKNOWN

1. UNKNOWN: final schema for `audit summary` block across all owner aggregates.
2. UNKNOWN: exact diagnostics severity taxonomy and standard codes.
3. UNKNOWN: pagination/sorting defaults and max page sizes for owner tables.
4. UNKNOWN: caching/TTL strategy for internal `active_ruleset_context_aggregate`.
5. UNKNOWN: whether restricted non-owner diagnostic visibility is required and under which policy.
6. UNKNOWN: standard action descriptor format shared across owner and organization aggregates.

