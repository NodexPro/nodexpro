# Country Pack Command Catalog (Phase 7 - Step 7)

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

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Writes only through commands
- Reads only through aggregates
- After command -> full refreshed aggregate/case
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

Access rule (hard constraint):
- Only `platform_owner` / product owner may execute country pack, ruleset, legal value, pricing, and owner metadata commands.
- Tenant roles (`owner`, `admin`, `staff`, `viewer`) must never be allowed to change legal values or country rules.

---

## Command response contract (mandatory)

Every command returns:

```json
{
  "ok": true,
  "command": "<name>",
  "refreshed": {
    "aggregate_key": "<aggregate_key>",
    "aggregate": {}
  }
}
```

No partial truth response is allowed as final command output.

---

## PART 1 - Country Pack commands

All commands in this section are conceptual and backend-only.

### 1) `create_country`

- Purpose: register new country identity in platform country registry.
- Who can execute: `platform_owner` only.
- Required input: `country_code`, `display_name`, optional metadata.
- Backend validations:
  - unique `country_code`
  - valid code format
  - no conflict with existing active country identity
- Lifecycle preconditions:
  - country not already registered as active identity
- Side effects:
  - country record created
- Audit event:
  - `COUNTRY_CREATED`
- Required aggregate refresh:
  - `country_pack_registry_aggregate`
- Forbidden behavior:
  - implicit pack/ruleset creation in same command
  - tenant/org user execution

### 2) `create_country_pack`

- Purpose: create pack container for one country.
- Who can execute: `platform_owner` only.
- Required input: `country_code`, `pack_code`, `pack_name`, optional capabilities.
- Backend validations:
  - country exists
  - pack code unique within country
- Lifecycle preconditions:
  - no conflicting pack identity
- Side effects:
  - pack created in disabled/draft-compatible state
- Audit event:
  - `COUNTRY_PACK_CREATED`
- Required aggregate refresh:
  - `country_pack_registry_aggregate`
- Forbidden behavior:
  - automatic activation without explicit enable/assign flow

### 3) `enable_country_pack`

- Purpose: mark pack as eligible for assignment/operation.
- Who can execute: `platform_owner` only.
- Required input: `country_pack_id`
- Backend validations:
  - pack exists
  - pack country is valid
- Lifecycle preconditions:
  - pack currently disabled
- Side effects:
  - pack status -> enabled
- Audit event:
  - `COUNTRY_PACK_ENABLED`
- Required aggregate refresh:
  - `country_pack_registry_aggregate`
- Forbidden behavior:
  - enabling archived/invalid pack without diagnostics

### 4) `disable_country_pack`

- Purpose: disable pack from future activation/assignment.
- Who can execute: `platform_owner` only.
- Required input: `country_pack_id`, optional reason.
- Backend validations:
  - pack exists
  - deactivation is safe under policy (or controlled blocked state)
- Lifecycle preconditions:
  - pack currently enabled
- Side effects:
  - pack status -> disabled
  - dependent org bindings may enter warning/inactive state (policy-driven)
- Audit event:
  - `COUNTRY_PACK_DISABLED`
- Required aggregate refresh:
  - `country_pack_registry_aggregate`
- Forbidden behavior:
  - silent disable that leaves bindings inconsistent without surfaced warnings

### 5) `create_ruleset`

- Purpose: create ruleset version container for country pack.
- Who can execute: `platform_owner` only.
- Required input:
  - `country_pack_id`
  - `ruleset_version`
  - `effective_from`
  - optional `effective_to`
  - metadata
- Backend validations:
  - pack exists
  - ruleset version unique per pack
  - date format valid
  - no overlap with active range policy
- Lifecycle preconditions:
  - pack eligible for ruleset creation
- Side effects:
  - ruleset created in `draft`
- Audit event:
  - `COUNTRY_RULESET_CREATED`
- Required aggregate refresh:
  - `country_pack_ruleset_aggregate`
- Forbidden behavior:
  - auto-activation by creation

### 6) `update_ruleset_metadata`

- Purpose: edit non-effective-date metadata of ruleset.
- Who can execute: `platform_owner` only.
- Required input: `ruleset_id`, metadata patch contract.
- Backend validations:
  - ruleset exists
  - metadata schema valid
- Lifecycle preconditions:
  - ruleset not in immutable historical policy state
- Side effects:
  - metadata updated
- Audit event:
  - `COUNTRY_RULESET_METADATA_UPDATED`
- Required aggregate refresh:
  - `country_pack_ruleset_aggregate`
- Forbidden behavior:
  - hidden date window mutation via metadata command

### 7) `activate_ruleset`

- Purpose: set ruleset to active under effective-date policy.
- Who can execute: `platform_owner` only.
- Required input: `ruleset_id`
- Backend validations:
  - ruleset exists
  - overlap checks pass
  - referenced legal values/version constraints pass minimum completeness policy
- Lifecycle preconditions:
  - ruleset status in activatable state (`draft`/`deprecated` per policy)
- Side effects:
  - ruleset status -> active
  - conflicting active rulesets rejected (no auto replace)
- Audit event:
  - `COUNTRY_RULESET_ACTIVATED`
- Required aggregate refresh:
  - `country_pack_ruleset_aggregate`
- Forbidden behavior:
  - silent replacement of currently active ruleset

### 8) `deactivate_ruleset`

- Purpose: controlled deactivation of active ruleset.
- Who can execute: `platform_owner` only.
- Required input: `ruleset_id`, reason.
- Backend validations:
  - ruleset exists
  - deactivation allowed by lifecycle policy
- Lifecycle preconditions:
  - ruleset currently active (or policy-allowed transitional state)
- Side effects:
  - ruleset status -> deactivated/disabled according to lifecycle model
  - diagnostics generated for affected bindings
- Audit event:
  - `COUNTRY_RULESET_DEACTIVATED`
- Required aggregate refresh:
  - `country_pack_ruleset_aggregate`
- Forbidden behavior:
  - hidden fallback to arbitrary latest ruleset

### 9) `assign_country_pack_to_organization`

- Purpose: bind eligible organization to country pack.
- Who can execute: `platform_owner` only.
- Required input: `organization_id`, `country_pack_id`
- Backend validations:
  - organization exists
  - organization `country_code` eligible for selected pack
  - pack enabled
- Lifecycle preconditions:
  - org binding in assignable status
- Side effects:
  - organization country settings updated with active pack
- Audit event:
  - `ORG_COUNTRY_PACK_ASSIGNED`
- Required aggregate refresh:
  - `organization_country_settings_aggregate`
- Forbidden behavior:
  - assigning non-eligible country pack
  - bypassing organization country identity checks

### 10) `change_active_ruleset_for_organization`

- Purpose: change organization-level active ruleset within assigned pack.
- Who can execute: `platform_owner` only.
- Required input: `organization_id`, `ruleset_id`
- Backend validations:
  - organization has assigned pack
  - ruleset belongs to assigned pack
  - ruleset active/eligible for target date policy
- Lifecycle preconditions:
  - org settings status allows ruleset change
- Side effects:
  - org settings active ruleset changed
- Audit event:
  - `ORG_ACTIVE_RULESET_CHANGED`
- Required aggregate refresh:
  - `organization_country_settings_aggregate`
- Forbidden behavior:
  - assigning ruleset from different country/pack

### 11) `update_organization_country_settings`

- Purpose: update settings status and allowed config fields for org-country binding.
- Who can execute: `platform_owner` only.
- Required input: `organization_id`, allowed settings payload.
- Backend validations:
  - org binding exists
  - payload schema valid
  - country/pack/ruleset consistency preserved
- Lifecycle preconditions:
  - status transition valid
- Side effects:
  - settings updated
- Audit event:
  - `ORG_COUNTRY_SETTINGS_UPDATED`
- Required aggregate refresh:
  - `organization_country_settings_aggregate`
- Forbidden behavior:
  - writing legal value payloads into org settings
  - writing client data into org settings

---

## PART 2 - Legal value commands (Owner Panel)

All commands in this section: `platform_owner` only.

### 1) `create_legal_value`

- Purpose: create legal value definition key under country/ruleset domain.
- Required input:
  - `country_code` or `country_pack_id` context
  - `legal_value_code`
  - metadata (`name`, `type`, optional descriptors)
- Validation:
  - unique code in scope
  - valid type and metadata schema
- Effective-date constraints:
  - N/A at definition level (applies on versions)
- No-overlap rule:
  - version overlap checked in version commands
- Audit event:
  - `LEGAL_VALUE_CREATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - embedding concrete effective values in definition without versioning

### 2) `update_legal_value_metadata`

- Purpose: update definition metadata only.
- Required input:
  - `legal_value_id`
  - metadata payload (including owner metadata fields where allowed)
- Validation:
  - legal value exists
  - metadata schema valid
  - cannot violate immutable fields policy
- Effective-date constraints:
  - no direct historical value mutation
- No-overlap rule:
  - unchanged (version-level)
- Audit event:
  - `LEGAL_VALUE_METADATA_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - updating versioned numeric/legal payload through metadata endpoint

### 3) `create_legal_value_version`

- Purpose: create effective-dated value payload.
- Required input:
  - `legal_value_id`
  - `ruleset_id`
  - `effective_from`
  - optional `effective_to`
  - value payload
- Validation:
  - legal value exists
  - ruleset exists and country-compatible
  - payload type-compatible
  - date format valid
  - no effective-date overlap for same legal value scope
- Effective-date constraints:
  - `effective_from` required
  - `effective_to` optional but if present >= from
- No-overlap rule:
  - strict no overlap in active ranges
- Audit event:
  - `LEGAL_VALUE_VERSION_CREATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - implicit overwrite of existing active version

### 4) `update_legal_value_version`

- Purpose: update version payload or metadata under lifecycle policy.
- Required input:
  - `legal_value_version_id`
  - allowed update payload
- Validation:
  - version exists
  - editability by status/date policy
  - no overlap introduced
- Effective-date constraints:
  - cannot rewrite historical active values without versioning policy
- No-overlap rule:
  - must still pass after update
- Audit event:
  - `LEGAL_VALUE_VERSION_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - silent historical recalculation by editing old active versions directly

### 5) `activate_legal_value_version`

- Purpose: mark specific value version as active under effective-date policy.
- Required input:
  - `legal_value_version_id`
- Validation:
  - version exists
  - ruleset/lifecycle eligibility valid
  - no overlap with other active versions for same scope
- Effective-date constraints:
  - current/target date compatibility required
- No-overlap rule:
  - mandatory
- Audit event:
  - `LEGAL_VALUE_VERSION_ACTIVATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - auto-deactivating conflicting versions without explicit surfaced policy

### 6) `deactivate_legal_value_version`

- Purpose: controlled deactivation of active legal value version.
- Required input:
  - `legal_value_version_id`
  - reason
- Validation:
  - version exists
  - deactivation allowed by lifecycle policy
- Effective-date constraints:
  - cannot leave mandatory scope with silent null fallback
- No-overlap rule:
  - N/A on deactivation, but coverage diagnostics required
- Audit event:
  - `LEGAL_VALUE_VERSION_DEACTIVATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - silent replacement with latest version

### 7) `delete_legal_value`

- Policy: currently **forbidden by default** (soft lifecycle strategy preferred).
- If ever allowed:
  - only for never-used, non-versioned, non-referenced draft records
  - must pass strict dependency checks
- Suggested command stance:
  - reject by policy; use deactivate/archive semantics instead.
- Audit event (if attempted):
  - `LEGAL_VALUE_DELETE_REJECTED` or `LEGAL_VALUE_DELETED` (policy dependent)
- Aggregate refresh:
  - `legal_values_workspace_aggregate`

### 8) `update_module_price`

- Purpose: update module price legal/system value through versioned legal values flow.
- Who can execute: `platform_owner` only.
- Required input:
  - module identifier
  - currency/value payload
  - ruleset/effective date context
- Validation:
  - module scope valid
  - payload type valid
  - country/ruleset compatibility valid
  - no overlap with existing active price version in same scope
- Effective-date constraints:
  - version-based; no direct mutable current overwrite without versioning
- No-overlap rule:
  - mandatory
- Audit event:
  - `MODULE_PRICE_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate` (and optionally diagnostics aggregate)
- Forbidden behavior:
  - price override directly in module runtime config bypassing legal values

### 9) `update_package_price`

- Purpose: update package price legal/system value via versioned policy.
- Who can execute: `platform_owner` only.
- Required input:
  - package identifier
  - currency/value payload
  - ruleset/effective date context
- Validation:
  - package scope valid
  - payload schema valid
  - country/ruleset compatibility valid
  - no overlap in effective windows
- Effective-date constraints:
  - version-based; historical integrity preserved
- No-overlap rule:
  - mandatory
- Audit event:
  - `PACKAGE_PRICE_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`
- Forbidden behavior:
  - writing package prices as ad-hoc non-versioned mutable fields

---

## PART 3 - Owner note commands

All commands in this section: `platform_owner` only.

### 1) `update_owner_note`

- Purpose: update private owner note for legal value definition/version.
- Required input:
  - target identifier (definition/version)
  - `owner_note`
- Rules:
  - does not affect calculations
  - owner-visible only
  - never visible to clients
- Audit event:
  - `LEGAL_VALUE_OWNER_NOTE_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`

### 2) `update_usage_hint`

- Purpose: update usage explanation metadata.
- Required input:
  - target identifier
  - `usage_hint`
- Rules:
  - governance metadata only
  - no impact on legal math/results
- Audit event:
  - `LEGAL_VALUE_USAGE_HINT_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`

### 3) `update_module_scope`

- Purpose: update module/domain consumption scope metadata.
- Required input:
  - target identifier
  - `module_scope`
- Rules:
  - metadata only
  - does not grant runtime module write access
- Audit event:
  - `LEGAL_VALUE_MODULE_SCOPE_UPDATED`
- Aggregate refresh:
  - `legal_values_workspace_aggregate`

---

## PART 4 - Global validation rules

Mandatory backend rules:

1. No overlap for rulesets in same country pack effective-date scope.
2. No overlap for legal value versions in same legal value scope.
3. `effective_from` is required.
4. `effective_to` is optional.
5. Controlled deactivation only (with explicit lifecycle checks).
6. No silent replacement of active values/rulesets.
7. No editing historical active values without explicit versioning policy.
8. Country eligibility enforcement for organization binding and pack assignment.
9. Tenant isolation enforcement for organization-level settings and reads.
10. No cross-country leakage (e.g., IL-only logic to non-IL organizations).

---

## PART 5 - Command -> aggregate mapping

### Country pack commands refresh
- `create_country` -> `country_pack_registry_aggregate`
- `create_country_pack` -> `country_pack_registry_aggregate`
- `enable_country_pack` -> `country_pack_registry_aggregate`
- `disable_country_pack` -> `country_pack_registry_aggregate`

### Ruleset commands refresh
- `create_ruleset` -> `country_pack_ruleset_aggregate`
- `update_ruleset_metadata` -> `country_pack_ruleset_aggregate`
- `activate_ruleset` -> `country_pack_ruleset_aggregate`
- `deactivate_ruleset` -> `country_pack_ruleset_aggregate`

### Legal value commands refresh
- `create_legal_value` -> `legal_values_workspace_aggregate`
- `update_legal_value_metadata` -> `legal_values_workspace_aggregate`
- `create_legal_value_version` -> `legal_values_workspace_aggregate`
- `update_legal_value_version` -> `legal_values_workspace_aggregate`
- `activate_legal_value_version` -> `legal_values_workspace_aggregate`
- `deactivate_legal_value_version` -> `legal_values_workspace_aggregate`
- `delete_legal_value` -> `legal_values_workspace_aggregate` (if policy ever allows)
- `update_module_price` -> `legal_values_workspace_aggregate`
- `update_package_price` -> `legal_values_workspace_aggregate`
- `update_owner_note` -> `legal_values_workspace_aggregate`
- `update_usage_hint` -> `legal_values_workspace_aggregate`
- `update_module_scope` -> `legal_values_workspace_aggregate`

### Organization binding commands refresh
- `assign_country_pack_to_organization` -> `organization_country_settings_aggregate`
- `change_active_ruleset_for_organization` -> `organization_country_settings_aggregate`
- `update_organization_country_settings` -> `organization_country_settings_aggregate`

---

## PART 6 - Forbidden command patterns

Explicitly forbidden:

1. Generic PATCH endpoints for legal/country truth changes.
2. Batch "save all values" operations as primary model.
3. Frontend writing legal values directly.
4. Partial update responses without full aggregate refresh.
5. Commands bypassing audit.
6. Commands bypassing effective-date/no-overlap logic.
7. Module-private command paths that bypass Country Pack governance.

---

## Audit mapping summary

Minimum conceptual audit map:

- Country:
  - `COUNTRY_CREATED`
- Country Pack:
  - `COUNTRY_PACK_CREATED`
  - `COUNTRY_PACK_ENABLED`
  - `COUNTRY_PACK_DISABLED`
- Ruleset:
  - `COUNTRY_RULESET_CREATED`
  - `COUNTRY_RULESET_METADATA_UPDATED`
  - `COUNTRY_RULESET_ACTIVATED`
  - `COUNTRY_RULESET_DEACTIVATED`
- Organization binding:
  - `ORG_COUNTRY_PACK_ASSIGNED`
  - `ORG_ACTIVE_RULESET_CHANGED`
  - `ORG_COUNTRY_SETTINGS_UPDATED`
- Legal values:
  - `LEGAL_VALUE_CREATED`
  - `LEGAL_VALUE_METADATA_UPDATED`
  - `LEGAL_VALUE_VERSION_CREATED`
  - `LEGAL_VALUE_VERSION_UPDATED`
  - `LEGAL_VALUE_VERSION_ACTIVATED`
  - `LEGAL_VALUE_VERSION_DEACTIVATED`
  - `LEGAL_VALUE_DELETE_REJECTED` (or policy-specific delete event)
- Pricing:
  - `MODULE_PRICE_UPDATED`
  - `PACKAGE_PRICE_UPDATED`
- Owner metadata:
  - `LEGAL_VALUE_OWNER_NOTE_UPDATED`
  - `LEGAL_VALUE_USAGE_HINT_UPDATED`
  - `LEGAL_VALUE_MODULE_SCOPE_UPDATED`

---

## PART 7 - Open questions / UNKNOWN

1. UNKNOWN: final delete policy for legal values (hard delete vs always-forbid vs archive-only).
2. UNKNOWN: definitive pricing versioning model (per ruleset only vs dual dimension with commercial plan version).
3. UNKNOWN: approval workflow necessity for sensitive legal value/ruleset activation.
4. UNKNOWN: rollback strategy for activated rulesets/legal values (forward-fix vs controlled rollback).
5. UNKNOWN: bulk operations policy and safety guards (import/apply-many with preview and conflict checks).
6. UNKNOWN: whether some organization binding commands may be system-automated and under what strict constraints.
