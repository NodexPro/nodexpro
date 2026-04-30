# Country Pack Organization Binding (Phase 7 - Step 6)

Status: Contract definition only.  
No migrations, no DB changes, no code, no API, no UI, no module integration in this step.

References:
- `docs/country-pack-boundary.md`
- `docs/country-pack-domain-model.md`
- `docs/country-pack-schema-design.md`
- `docs/country-pack-ruleset-effective-date-model.md`
- `docs/country-pack-extension-contract.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Financial truth -> Accounting Base only
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only
- Frontend is render-only

---

## Binding model summary

Organization country binding has two separate layers:

1. Identity layer (Core / Organization Profile): organization `country_code`  
2. Configuration layer (Country Pack): organization-country operational binding to active pack and active ruleset

These layers are intentionally separated:
- `country_code` identifies organization country identity and eligibility base.
- `organization_country_settings` controls pack/ruleset activation state.
- legal values stay in ruleset/legal value tables only.
- client data is never stored in country binding records.

---

## 1) Organization country identity

### Definition
- Organization has a base `country_code` field in Core identity context.
- Existing Organization Settings Country field is the source for this identity.

### Contract
- `country_code` belongs to Core organization identity model.
- `country_code` is not legal configuration and not a legal value container.
- Changing `country_code` may affect eligibility and active configuration validity.

### Explicit non-goal
- `country_code` must not store legal rates, due-date rules, local report schemas, or client operational state.

---

## 2) Organization country settings

`organization_country_settings` (conceptual contract):

- `organization_id` (required)
- `country_code` (required)
- `active_country_pack_id` (nullable only when not configured/disabled)
- `active_ruleset_id` (nullable only when not configured/disabled)
- `settings_status` (required; lifecycle-managed)
- `created_at` (required)
- `updated_at` (required)

### Purpose
Store organization-level operational activation of Country Pack context, separate from identity profile and separate from legal value source tables.

### Notes
- `country_code` here mirrors effective configuration scope and must be consistent with organization identity policy.
- this table is configuration state, not legal source truth.

---

## 3) Separation rules

1. Organization Profile stores identity fields only (including `country_code`).
2. Country Configuration stores active pack/ruleset and settings lifecycle state.
3. Legal values remain in ruleset/legal value structures managed by Owner Legal Control Panel.
4. Client data must not be stored in organization country settings.
5. Financial truth is never moved into country settings; remains in Accounting Base.

---

## 4) Eligibility model

Eligibility is resolved on backend only.

### Required rules
1. IL pack is eligible only when `organization.country_code = IL`.
2. Non-IL organization cannot activate IL pack.
3. Disabled country pack cannot be activated.
4. Missing or unresolved ruleset must cause controlled failure.
5. Active pack/ruleset must match organization country scope.

### Implications
- eligibility must be re-evaluated when organization `country_code` changes.
- previously active pack may become invalid and require explicit status transition.

---

## 5) Activation flow (conceptual)

1. Set organization `country_code` in Core identity context.
2. Resolve/list eligible country packs for this organization country.
3. Assign active country pack (if eligible and enabled).
4. Resolve active ruleset by ruleset-effective-date policy.
5. Create/update `organization_country_settings`.
6. Emit audit event for binding/configuration change.
7. Return full refreshed aggregate/case (no partial frontend stitching).

### Flow guarantees
- command-only writes
- aggregate-only reads
- no frontend legal decisions
- no hidden side-read as source of truth

---

## 6) Commands implied (conceptual only, not implemented here)

1. `set_organization_country`
2. `assign_country_pack_to_organization`
3. `change_active_ruleset`
4. `update_country_settings_status`

### Command principles
- each command validates tenant/org context
- each command validates country/pack/ruleset eligibility
- each command emits audit event
- each command returns refreshed aggregate truth

---

## 7) Aggregates implied (conceptual only, not implemented here)

1. `organization_country_settings_aggregate`
2. `country_pack_diagnostics_aggregate`

### Required aggregate payload
- organization country
- eligible packs
- active pack
- active ruleset
- status
- warnings/errors
- available actions

### Aggregate policy
- ready-to-render backend truth only
- no frontend recomputation of eligibility/ruleset resolution

---

## 8) Relation to current Organization Settings UI

Future placement model:

1. Organization Profile section shows Country identity field (`country_code`).
2. Country Configuration block is shown below/near profile field for pack/ruleset status and actions.

UI rule:
- UI renders aggregate truth only.
- UI does not decide eligibility, ruleset, or legal values.
- UI triggers commands; backend returns full refreshed truth.

---

## 9) Forbidden behavior

Explicitly forbidden:

1. Hardcoding IL activation behavior in frontend.
2. Showing IL-specific country configuration UI for non-IL organizations based on frontend assumptions.
3. Activating country pack without backend eligibility checks.
4. Storing legal values in organization profile.
5. Storing client data in organization country settings.
6. Direct module-to-pack activation bypassing Core + commands + audit flow.
7. Frontend-side ruleset resolution or fallback guessing.

---

## 10) Open questions / UNKNOWN

1. UNKNOWN: final enum/lifecycle for `settings_status` and exact transition rules.
2. UNKNOWN: whether country change auto-disables previous active pack or requires explicit command confirmation.
3. UNKNOWN: conflict handling UX when active ruleset becomes disabled/deprecated.
4. UNKNOWN: minimum diagnostics payload for `country_pack_diagnostics_aggregate`.
5. UNKNOWN: cross-organization operational policy for shared/global packs with local overrides.
6. UNKNOWN: required backward compatibility behavior for organizations with country set but no existing binding record.

