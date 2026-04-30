# Country Pack Schema Design (Phase 7 - Step 3)

Status: Proposed schema design only.  
No migrations, no DB changes, no runtime code, no API, no UI, no module integration in this step.

References:
- `docs/country-pack-boundary.md`
- `docs/country-pack-domain-model.md`

Architecture constraints:
- Core -> Commands -> Aggregate -> UI
- Financial truth -> Accounting Base only
- Country-specific legal logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Schema summary

This schema defines Country Pack Framework + Owner Legal Control Panel data boundaries:
- global legal catalog (`countries`, `country_packs`, `country_pack_rulesets`, capabilities, legal values/versions)
- organization binding (`organization_country_settings`) to country + active pack + active ruleset
- legal value versioning with effective ranges
- explicit separation of:
  - `ruleset_version` (legal policy revision)
  - `code_version` (technical package build)

No client data, no financial truth rows, no country-specific tax fields are stored here.

---

## Table list

1. `countries`
2. `country_packs`
3. `country_pack_rulesets`
4. `organization_country_settings`
5. `country_extension_capabilities`
6. `country_legal_values`
7. `country_legal_value_versions`

---

## Global principles

1. Ownership:
   - Country Pack catalog and legal values are global governance data.
   - Organization binding is tenant-owned (`organization_id` scoped).

2. Versioning:
   - legal-value identity separated from legal-value version.
   - ruleset identity separated from technical code version.

3. Effective-date model:
   - legal artifacts use `effective_from` / `effective_to` (nullable open end).
   - overlap control must prevent ambiguous active ranges where policy requires uniqueness.

4. Prohibitions:
   - no client-level data
   - no accounting entry/summary truth
   - no Israel/VAT/local hardcoded legal columns in framework schema

---

## 1) `countries`

### Purpose
Global jurisdiction catalog used by Country Pack Framework.

### Fields (conceptual)
- `id` (required)
- `country_code` (required)
- `display_name` (required)
- `status` (required; active/inactive)
- `default_locale` (nullable)
- `default_timezone` (nullable)
- `metadata_json` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- `country_code`: stable jurisdiction key (e.g. ISO-like code).
- `status`: whether country is available for pack binding.
- `metadata_json`: non-legal display/registry metadata only.

### Key constraints
- PK: `id`
- UNIQUE: `country_code`
- CHECK: `status` in allowed enum

### Tenant/global ownership rules
- global table, not tenant-owned.

### Important indexes
- `idx_countries_status` (`status`)

### Must NOT be stored here
- client/org binding data
- legal value payloads
- financial truth

---

## 2) `country_packs`

### Purpose
Global registry of framework-compatible country packs.

### Fields (conceptual)
- `id` (required)
- `country_id` (required)
- `pack_code` (required)
- `display_name` (required)
- `status` (required; draft/active/deprecated/retired)
- `code_version` (required)
- `owner_team` (nullable)
- `metadata_json` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- `code_version`: technical package/build version.
- `status`: lifecycle state of pack artifact.

### Key constraints
- PK: `id`
- FK: `country_id -> countries.id`
- UNIQUE: (`country_id`, `pack_code`)
- CHECK: allowed `status` enum

### Tenant/global ownership rules
- global table, owner/legal governance controlled.

### Important indexes
- `idx_country_packs_country_status` (`country_id`, `status`)
- `idx_country_packs_pack_code` (`pack_code`)

### Must NOT be stored here
- ruleset legal values
- organization-specific selected pack/ruleset
- client data

---

## 3) `country_pack_rulesets`

### Purpose
Legal-policy version tracks for a country pack.

### Fields (conceptual)
- `id` (required)
- `country_pack_id` (required)
- `ruleset_code` (required)
- `ruleset_version` (required)
- `code_version` (required)
- `status` (required; draft/active/retired)
- `effective_from` (required)
- `effective_to` (nullable)
- `published_at` (nullable)
- `published_by` (nullable)
- `notes` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- `ruleset_version`: legal/policy revision identifier.
- `code_version`: technical build compatible with this ruleset.
- `effective_from`/`effective_to`: legal effective window.

### Key constraints
- PK: `id`
- FK: `country_pack_id -> country_packs.id`
- UNIQUE (recommended): (`country_pack_id`, `ruleset_code`, `ruleset_version`)
- CHECK: `effective_from <= effective_to` when `effective_to` is not null
- CHECK: allowed `status` enum
- No-overlap rule (required policy): prevent overlapping active ranges for same `country_pack_id` where both rows are active/effective.

### Tenant/global ownership rules
- global legal governance table.

### Important indexes
- `idx_rulesets_pack_status` (`country_pack_id`, `status`)
- `idx_rulesets_pack_effective` (`country_pack_id`, `effective_from`, `effective_to`)
- `idx_rulesets_code_version` (`code_version`)

### Must NOT be stored here
- raw legal value payload blobs
- client data
- module runtime state

---

## 4) `organization_country_settings`

### Purpose
Tenant binding to country + active country pack + active ruleset.

### Fields (conceptual)
- `id` (required)
- `organization_id` (required)
- `country_id` (required)
- `active_country_pack_id` (required)
- `active_ruleset_id` (required)
- `status` (required; active/pending/locked)
- `effective_from` (required)
- `effective_to` (nullable)
- `set_by` (nullable)
- `set_reason` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- organization-level legal context binding.
- effective range for binding transitions.

### Key constraints
- PK: `id`
- FK: `organization_id -> organizations.id`
- FK: `country_id -> countries.id`
- FK: `active_country_pack_id -> country_packs.id`
- FK: `active_ruleset_id -> country_pack_rulesets.id`
- CHECK: `effective_from <= effective_to` when `effective_to` is not null
- UNIQUE (recommended): one active row per organization at a time.
- Consistency checks (required):
  - selected pack belongs to selected country
  - selected ruleset belongs to selected pack

### Tenant/global ownership rules
- tenant-owned (organization scoped).

### Important indexes
- `idx_org_country_settings_org` (`organization_id`)
- `idx_org_country_settings_active` (`organization_id`, `status`, `effective_from`, `effective_to`)
- `idx_org_country_settings_country` (`country_id`)

### Must NOT be stored here
- legal value payloads
- client-level state
- financial truth

---

## 5) `country_extension_capabilities`

### Purpose
Declares which extension contracts a pack supports.

### Fields (conceptual)
- `id` (required)
- `country_pack_id` (required)
- `capability_key` (required)
- `contract_version` (required)
- `status` (required; enabled/deprecated)
- `metadata_json` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- capability identity and compatibility metadata for consumer modules.

### Key constraints
- PK: `id`
- FK: `country_pack_id -> country_packs.id`
- UNIQUE: (`country_pack_id`, `capability_key`, `contract_version`)
- CHECK: allowed `status` enum

### Tenant/global ownership rules
- global pack metadata.

### Important indexes
- `idx_capabilities_pack` (`country_pack_id`)
- `idx_capabilities_key` (`capability_key`)

### Must NOT be stored here
- legal numeric/text values
- client data
- module business rows

---

## 6) `country_legal_values`

### Purpose
Global catalog of legal value identities (semantic keys).

### Fields (conceptual)
- `id` (required)
- `country_id` (required)
- `legal_value_key` (required)
- `label` (required)
- `value_type` (required; number/text/date/enum/json)
- `category` (required)
- `status` (required; active/deprecated)
- `metadata_json` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- identity-level legal concept; no concrete version payload here.

### Key constraints
- PK: `id`
- FK: `country_id -> countries.id`
- UNIQUE: (`country_id`, `legal_value_key`)
- CHECK: allowed `value_type`, `status`

### Tenant/global ownership rules
- global legal catalog (owner-controlled).

### Important indexes
- `idx_legal_values_country` (`country_id`)
- `idx_legal_values_category` (`category`)
- `idx_legal_values_status` (`status`)

### Must NOT be stored here
- concrete effective legal values
- organization overrides
- client data

---

## 7) `country_legal_value_versions`

### Purpose
Immutable versioned legal value payloads with effective windows and ruleset linkage.

### Fields (conceptual)
- `id` (required)
- `country_legal_value_id` (required)
- `country_pack_ruleset_id` (required)
- `version_code` (required)
- `effective_from` (required)
- `effective_to` (nullable)
- `value_payload_json` (required)
- `status` (required; draft/published/retired)
- `approved_by` (nullable)
- `approved_at` (nullable)
- `created_at` (required)
- `updated_at` (required)

### Field meaning
- concrete immutable legal value version used by a specific ruleset.
- effective range controls applicability period.

### Key constraints
- PK: `id`
- FK: `country_legal_value_id -> country_legal_values.id`
- FK: `country_pack_ruleset_id -> country_pack_rulesets.id`
- UNIQUE (recommended): (`country_legal_value_id`, `country_pack_ruleset_id`, `version_code`)
- CHECK: `effective_from <= effective_to` when `effective_to` is not null
- CHECK: `value_payload_json` shape must match declared `value_type` contract (enforced by command/service validation)
- No-overlap rule (required policy): avoid overlapping published effective windows for same legal value within same ruleset scope.

### Tenant/global ownership rules
- global legal governance table.

### Important indexes
- `idx_legal_value_versions_value` (`country_legal_value_id`)
- `idx_legal_value_versions_ruleset` (`country_pack_ruleset_id`)
- `idx_legal_value_versions_effective` (`effective_from`, `effective_to`)
- `idx_legal_value_versions_status` (`status`)

### Must NOT be stored here
- client data
- financial facts
- module operational state

---

## Effective date model (explicit)

Used in:
- `country_pack_rulesets`
- `organization_country_settings`
- `country_legal_value_versions`

Rules:
1. `effective_from` required.
2. `effective_to` nullable for open-ended current version.
3. no invalid range (`from > to`).
4. overlap prevention where uniqueness of active policy is required:
   - active rulesets per pack/date
   - published legal value versions per legal key/ruleset/date
   - active organization binding windows.

---

## Ruleset vs code_version (explicit)

- `ruleset_version` = legal/policy version (business/legal truth context).
- `code_version` = technical package/deployment version.

Both are required in `country_pack_rulesets` to prevent accidental coupling.

---

## Ownership and non-mixing rules

1. Owner-controlled legal values:
   - `country_legal_values` + `country_legal_value_versions`
   - governed by Owner Legal Control Panel process.

2. Client data exclusion:
   - none of the seven tables may store client workspace rows.

3. Accounting Base separation:
   - no accounting entries/summaries in Country Pack tables.

4. Core separation:
   - Core keeps org/user/permissions; legal rules live outside Core tables.
   - only organization reference binding is allowed through `organization_country_settings`.

---

## Audit-ready fields (where needed)

Recommended audit-ready metadata in governance tables:
- `created_at`, `updated_at`
- `published_by`, `published_at` (rulesets)
- `approved_by`, `approved_at` (legal value versions)
- `set_by`, `set_reason` (organization binding changes)

Detailed audit events remain in audit log infrastructure, not as row-history replacement.

---

## What must NOT be modeled in this schema

- Israel-specific columns (VAT, מס הכנסה, ביטוח לאומי specifics)
- local tax constants hardcoded into framework tables
- client financial truth rows
- client personal/business workspace data
- module-specific runtime flags unrelated to legal/ruleset ownership

---

## Risky decisions

1. Overlap policy complexity for rulesets and legal value versions can cause ambiguous active truth if not strictly enforced.
2. Organization binding transitions may require explicit activation workflow to avoid accidental legal-context switches.
3. Ruleset-to-legal-value linking strategy can become heavy if many values change frequently.
4. `value_payload_json` flexibility requires strong command-layer validation governance.
5. Multi-country future support per organization may complicate uniqueness and active binding guarantees.

---

## Open questions / UNKNOWN

1. UNKNOWN: exact enforcement mechanism for no-overlap constraints (DB-native exclusion vs command-layer transactional checks).
2. UNKNOWN: whether organizations can hold multiple concurrent country contexts by scoped domain (future).
3. UNKNOWN: granularity of legal value versioning (per key vs grouped release bundles).
4. UNKNOWN: approval workflow requirements for publishing rulesets/legal value versions.
5. UNKNOWN: rollback semantics for emergency legal hotfix versions.
6. UNKNOWN: final compatibility policy between deprecated `code_version` and active `ruleset_version`.
