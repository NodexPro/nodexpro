# Country Pack Security, Audit, and Isolation Model (Phase 7 - Step 9)

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

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Writes only through commands
- Reads only through aggregates
- After command -> full refreshed aggregate/case
- Country-specific logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Security summary

Country Pack and Owner Legal Control Panel are governance-sensitive domains.  
Security model is based on strict role boundary, country eligibility checks, tenant isolation, explicit auditability, and controlled failure behavior.

---

## 1) Platform owner access model

Hard requirements:

1. Only `platform_owner` / product owner may manage:
   - country packs
   - rulesets
   - legal values
   - pricing values
   - owner notes / owner metadata
2. Tenant roles (`owner`, `admin`, `staff`, `viewer`) must never modify legal/country truth.
3. Owner access is separate from tenant RBAC.
4. Owner authentication model:
   - configured allowed owner email
   - login via `email + password` OR private access key OR SMS code (per owner model contract)
5. All owner login attempts and security/profile changes must be audited.

Implementation note (Prompt 1 - Core/owner access preparation):
- Internal platform-owner guard foundation exists via `assertPlatformOwner(ctx)`.
- Core audit action constants now include owner auth/security base events (`owner_login_success`, `owner_login_failed`, `owner_access_key_rotated`, `owner_phone_updated`, `owner_email_updated`, `owner_password_updated`, `owner_security_check_failed`).

---

## 2) Country isolation rules

Mandatory rules:

1. IL pack eligible only when `organization.country_code = IL`.
2. Non-IL organizations cannot activate IL pack.
3. IL hooks/validators/UI section descriptors must not run for non-IL organizations.
4. Country-private legal/ruleset data must not leak across country scopes.
5. Global modules must continue working without local country pack (controlled neutral behavior).

No country-specific behavior may be activated without explicit eligibility and resolved active context.

---

## 3) Tenant isolation

Mandatory rules:

1. `organization_country_settings` is strictly scoped by `organization_id`.
2. No cross-tenant organization pack assignment.
3. No cross-tenant diagnostics reads.
4. Tenant users must not read owner legal values payloads (owner notes, owner-only metadata, governance internals).
5. Owner aggregates must never return client data.

Tenant-safe scoping must be enforced in both commands and aggregate reads.

---

## 4) Audit catalog

### Event list

- `country_created`
- `country_pack_created`
- `country_pack_enabled`
- `country_pack_disabled`
- `ruleset_created`
- `ruleset_activated`
- `ruleset_deactivated`
- `organization_country_pack_assigned`
- `active_ruleset_changed`
- `organization_country_settings_updated`
- `legal_value_created`
- `legal_value_metadata_updated`
- `legal_value_version_created`
- `legal_value_version_updated`
- `legal_value_version_activated`
- `legal_value_version_deactivated`
- `owner_note_updated`
- `usage_hint_updated`
- `module_scope_updated`
- `module_price_updated`
- `package_price_updated`
- `owner_login_success`
- `owner_login_failed`
- `owner_access_key_rotated`
- `owner_phone_updated`
- `owner_email_updated`
- `owner_password_updated`

### Audit payload contract (applies to all events)

Required fields:

- `event_type`
- `actor_type` (e.g., `platform_owner`, `system`)
- `actor_id`
- `timestamp`
- `target_entity_type`
- `target_entity_id`
- `country_code` (if relevant)
- `ruleset_id` (if relevant)
- `result` (`success` / `failure`)
- `reason` or error category (for failures)

Before/after payload policy:

- Include `before` and `after` snapshots for mutating commands where feasible.
- Use field-level diff for large payloads to reduce sensitive exposure.
- Never log secrets.

Sensitive data redaction policy:

- redact access keys, passwords, one-time codes, SMS payload internals
- mask phone/email where required by policy
- avoid raw legal payload dumps if they contain protected internal metadata

### Per-event audit applicability summary

For each event above:

- Actor type: `platform_owner` (or `system` for system-triggered maintenance only)
- Actor id: required, must map to authenticated identity/service identity
- Timestamp: required UTC server timestamp
- Target entity: required (country/pack/ruleset/org setting/legal value/version/owner account)
- `country_code`: required for country-pack/ruleset/legal-value events when scoped by country
- `ruleset_id`: required for ruleset-bound and legal-value-version-bound events
- Before/after policy: required for update/activate/deactivate/assignment/password/profile changes
- Redaction policy: always enforced

---

## 5) Security by command

Command security mapping (from command catalog):

- `create_country`
  - required actor: `platform_owner`
  - validation: unique country code, format checks
  - audit: `country_created`
  - forbidden: tenant execution

- `create_country_pack`
  - required actor: `platform_owner`
  - validation: country exists, unique pack code
  - audit: `country_pack_created`
  - forbidden: auto-activation

- `enable_country_pack`
  - required actor: `platform_owner`
  - validation: pack exists, lifecycle allows enable
  - audit: `country_pack_enabled`
  - forbidden: enabling ineligible/invalid state without diagnostics

- `disable_country_pack`
  - required actor: `platform_owner`
  - validation: pack exists, controlled deactivation checks
  - audit: `country_pack_disabled`
  - forbidden: silent disable without impact diagnostics

- `create_ruleset`
  - required actor: `platform_owner`
  - validation: date validity, no overlap, pack consistency
  - audit: `ruleset_created`
  - forbidden: creation with hidden activation side effect

- `update_ruleset_metadata`
  - required actor: `platform_owner`
  - validation: schema + lifecycle constraints
  - audit: `ruleset_created` (metadata updates should be tracked as ruleset audit family; exact event naming remains policy-bound)
  - forbidden: hidden effective-date mutation

- `activate_ruleset`
  - required actor: `platform_owner`
  - validation: overlap checks, lifecycle checks, completeness checks
  - audit: `ruleset_activated`
  - forbidden: silent replacement of active ruleset

- `deactivate_ruleset`
  - required actor: `platform_owner`
  - validation: controlled deactivation checks
  - audit: `ruleset_deactivated`
  - forbidden: hidden fallback to arbitrary ruleset

- `assign_country_pack_to_organization`
  - required actor: `platform_owner`
  - validation: org exists, country eligibility, pack enabled
  - audit: `organization_country_pack_assigned`
  - forbidden: cross-tenant or ineligible assignment

- `change_active_ruleset_for_organization`
  - required actor: `platform_owner`
  - validation: ruleset belongs to assigned pack/country and is eligible
  - audit: `active_ruleset_changed`
  - forbidden: cross-country/cross-pack assignment

- `update_organization_country_settings`
  - required actor: `platform_owner`
  - validation: status transition + consistency checks
  - audit: `organization_country_settings_updated`
  - forbidden: storing legal values/client data in org settings

- `create_legal_value`
  - required actor: `platform_owner`
  - validation: unique code + metadata schema
  - audit: `legal_value_created`
  - forbidden: non-versioned effective-value insertion as truth

- `update_legal_value_metadata`
  - required actor: `platform_owner`
  - validation: schema + immutable constraints
  - audit: `legal_value_metadata_updated`
  - forbidden: direct historical value rewrite

- `create_legal_value_version`
  - required actor: `platform_owner`
  - validation: type/date/ruleset/country consistency + no overlap
  - audit: `legal_value_version_created`
  - forbidden: implicit overwrite of active value

- `update_legal_value_version`
  - required actor: `platform_owner`
  - validation: editable state + no overlap + historical policy
  - audit: `legal_value_version_updated`
  - forbidden: rewriting historical active versions without versioning

- `activate_legal_value_version`
  - required actor: `platform_owner`
  - validation: lifecycle + no overlap + ruleset consistency
  - audit: `legal_value_version_activated`
  - forbidden: silent conflict auto-resolution

- `deactivate_legal_value_version`
  - required actor: `platform_owner`
  - validation: controlled deactivation + coverage diagnostics
  - audit: `legal_value_version_deactivated`
  - forbidden: silent fallback to latest value

- `update_owner_note`
  - required actor: `platform_owner`
  - validation: target exists, metadata size/schema policy
  - audit: `owner_note_updated`
  - forbidden: exposing notes to tenant/client users

- `update_usage_hint`
  - required actor: `platform_owner`
  - validation: target exists, metadata policy
  - audit: `usage_hint_updated`
  - forbidden: treating usage hint as calculation source

- `update_module_scope`
  - required actor: `platform_owner`
  - validation: target exists, valid scope vocabulary
  - audit: `module_scope_updated`
  - forbidden: scope update granting runtime write rights

- `update_module_price`
  - required actor: `platform_owner`
  - validation: pricing payload type + date/ruleset/country compatibility + no overlap
  - audit: `module_price_updated`
  - forbidden: direct module runtime price mutation outside legal value flow

- `update_package_price`
  - required actor: `platform_owner`
  - validation: pricing payload + effective-date/no-overlap checks
  - audit: `package_price_updated`
  - forbidden: ad-hoc non-versioned package pricing truth writes

---

## 6) Aggregate access control

Mandatory rules:

1. `owner_*` aggregates are `platform_owner` only.
2. `organization_country_settings_aggregate` can be shown in limited tenant/admin settings views but without owner legal edit payloads.
3. `active_ruleset_context_aggregate` is backend/internal only.
4. Frontend must never make legal decisions (ruleset selection, legal value resolution, due-date/rate calculation).

Additional safeguards:

- no owner panel aggregate to org users
- no owner notes in tenant aggregates
- no client data returned in owner aggregates

---

## 7) Fallback and error safety model

Controlled behavior requirements:

1. Missing ruleset
   - return explicit unresolved-context warning/error
   - disable country-specific action set safely
2. Disabled pack
   - block activation/use paths
   - return diagnostics + allowed remediation actions
3. Ineligible country
   - reject assignment/activation commands
   - return explicit eligibility failure
4. Overlapping ruleset
   - reject command
   - return overlap diagnostics, no silent auto-fix
5. Failed legal value resolution
   - return controlled unresolved legal context
   - no hidden fallback to unrelated/latest value
6. SMS provider unavailable
   - owner login/recovery via SMS fails safely with explicit retryable error
   - no insecure bypass to authenticated state
7. Owner recovery attempt failed
   - explicit failure response
   - audit failure event
   - apply lockout/rate-limit policy when implemented

---

## 8) Forbidden behavior

Explicitly forbidden:

1. Tenant admin (or any tenant role) modifying legal values/country rules.
2. Frontend choosing/overriding active ruleset.
3. Direct DB edits from owner UI path.
4. Exposing owner panel to organization users.
5. Returning raw owner legal values payloads inside client workspace payloads unless resolved and safe.
6. Placing country-specific logic in Core, Accounting Base, or global modules as source truth.
7. Unaudited legal/ruleset/country governance changes.

---

## 9) Open questions / UNKNOWN

1. UNKNOWN: SMS provider selection and reliability/failover policy.
2. UNKNOWN: secure storage implementation for owner access key.
3. UNKNOWN: one-time code expiration length and retry budget.
4. UNKNOWN: lockout/rate-limit policy for owner auth and recovery.
5. UNKNOWN: audit retention duration and archival policy.
6. UNKNOWN: emergency recovery process when owner credentials and phone are unavailable.
7. UNKNOWN: exact event naming normalization for ruleset metadata update (`ruleset_metadata_updated` vs ruleset family events).

