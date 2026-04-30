# Country Pack Domain Model (Phase 7 - Step 2)

Status: Conceptual domain model only.  
No code, no DB schema/migrations, no API, no UI, no module integration in this step.

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Financial truth -> Accounting Base only
- Country-specific legal logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only

---

## Boundary reminders (non-negotiable)

1. `country_pack` != country module implementation.
2. legal values != client data.
3. ruleset != module business logic.
4. Accounting Base != country-specific legal logic.
5. Core != legal ruleset ownership.

---

## Entity List

1. `country`
2. `country_pack`
3. `country_pack_ruleset`
4. `organization_country_settings`
5. `country_extension_capability`
6. `legal_value`
7. `legal_value_version`

Owner Legal Control Panel is modeled as the governance surface over these entities (not as client workspace data).

---

## 1) `country`

### Purpose
Represents a jurisdictional context (country-level legal domain anchor).

### Owns
- country identity and metadata used for pack/ruleset binding.

### Must NOT own
- client-specific financial or workflow state.
- legal value numeric/text payloads themselves.
- module runtime logic.

### Conceptual fields (meaning)
- country code (stable identifier)
- display label(s)
- status (active/inactive for framework availability)
- default locale/timezone hints
- legal-domain metadata references

### Relationships
- one `country` can have multiple `country_pack` records (historical/parallel support model).
- organizations bind to `country` through `organization_country_settings`.

---

## 2) `country_pack`

### Purpose
Represents a framework-compatible legal pack identity for a country (package boundary).

### Owns
- pack identity and lifecycle metadata.
- compatibility metadata and capability declarations.

### Must NOT own
- client operational data.
- accounting financial facts.
- direct module business state.

### Conceptual fields (meaning)
- pack key/code
- bound country reference
- pack status (draft/active/deprecated)
- semantic version reference (pack metadata version, not legal values)
- publisher/owner metadata
- activation constraints metadata

### Relationships
- belongs to one `country`.
- has many `country_pack_ruleset`.
- has many `country_extension_capability`.
- may be selected by organization via `organization_country_settings`.

---

## 3) `country_pack_ruleset`

### Purpose
Represents a legal ruleset snapshot/track for a pack (legal behavior contract, not code deployment).

### Owns
- legal-effective policy boundary for a pack.
- references to legal value versions used by this ruleset.

### Must NOT own
- executable module logic ownership.
- client-level state.
- direct financial truth.

### Conceptual fields (meaning)
- ruleset key/id
- linked country_pack
- legal-effective range metadata
- status (draft/active/retired)
- human-readable ruleset label
- ruleset revision metadata
- referenced legal-value-version set descriptor
- governance/audit metadata

### Relationships
- belongs to one `country_pack`.
- references many `legal_value_version`.
- may be active for organization via `organization_country_settings`.

---

## 4) `organization_country_settings`

### Purpose
Binds organization to country context and active Country Pack/ruleset selection.

### Owns
- organization-level country binding.
- active pack pointer.
- active ruleset pointer.

### Must NOT own
- legal values payload.
- client workspace data.
- financial transactions/entries.

### Conceptual fields (meaning)
- organization reference
- country reference
- active country_pack reference
- active country_pack_ruleset reference
- activation timestamps
- status flags (enabled/locked/pending-transition)
- override policy metadata (if allowed by governance)

### Relationships
- belongs to one organization (Core-owned org identity).
- references one `country`.
- references one active `country_pack`.
- references one active `country_pack_ruleset`.

---

## 5) `country_extension_capability`

### Purpose
Declares what legal capability types a pack provides to consuming modules.

### Owns
- capability contract metadata (what can be asked from Country Pack).

### Must NOT own
- legal values themselves.
- module-specific persisted state.
- client data.

### Conceptual fields (meaning)
- capability key (e.g. due-date-provider, validator-provider)
- owning country_pack reference
- capability status (enabled/deprecated)
- compatibility/version metadata
- contract shape reference (schema key, not implementation)

### Relationships
- belongs to one `country_pack`.
- consumed indirectly by modules through framework contracts.

---

## 6) `legal_value`

### Purpose
Represents a legal concept key (identity of a legal parameter, not concrete versioned value).

### Owns
- canonical legal-value identity and semantic meaning.

### Must NOT own
- client-specific values.
- mutable runtime result state.
- financial facts.

### Conceptual fields (meaning)
- legal value key/code
- category/domain (rates, limits, dates, classifications, metadata)
- value type descriptor (number/text/date/enum/object)
- semantic description
- ownership/governance scope

### Relationships
- one `legal_value` has many `legal_value_version`.
- `country_pack_ruleset` references versions of legal values, not mutable base key state.

---

## 7) `legal_value_version`

### Purpose
Represents immutable, versioned legal value payload used by rulesets.

### Owns
- immutable value content for a legal value at a specific revision/effective context.

### Must NOT own
- organization client data.
- module runtime state.
- financial truth.

### Conceptual fields (meaning)
- legal_value reference
- version identifier/revision
- immutable value payload
- effective range metadata
- status (draft/published/retired)
- authored/approved governance metadata

### Relationships
- belongs to one `legal_value`.
- referenced by one or many `country_pack_ruleset`.

---

## Separation: `legal_value` vs `legal_value_version`

- `legal_value` = semantic identity ("what concept is this?").
- `legal_value_version` = immutable value instance ("what is its value in this revision/effective period?").

Rule:
- rulesets bind to `legal_value_version`, not mutable ad-hoc legal values.
- changes in legal meaning/value create new version, not in-place mutation.

---

## Separation: `ruleset` vs `code_version`

- `country_pack_ruleset` is legal-policy/version contract.
- code version is technical deployment artifact.

Rule:
- legal ruleset activation must not be conflated with app build version.
- a code deploy must not silently change legal values without explicit ruleset/version governance.

---

## Organization binding model

Organization must bind explicitly to:
1. `country`
2. active `country_pack`
3. active `country_pack_ruleset`

This binding lives in `organization_country_settings`, not in client entities and not in module-local hidden config.

---

## Relationships (section)

1. `country -> country_pack`
   - one country can map to multiple packs over time (or variants), one active by policy.

2. `country_pack -> country_pack_ruleset`
   - one pack has many rulesets (versioned legal tracks).

3. `organization -> organization_country_settings`
   - organization has one effective country settings record (logical current binding).

4. `country_pack_ruleset -> legal_value_version`
   - ruleset references a stable set of legal value versions.

5. `legal_value -> legal_value_version`
   - one legal value key, many immutable versions.

---

## Truth rules (section)

1. Source of truth for legal values:
   - `legal_value` + `legal_value_version` under Country Pack governance.

2. Source of truth for selected legal context per organization:
   - `organization_country_settings` active binding.

3. Source of truth for financial facts:
   - Accounting Base (never Country Pack).

4. Version selection rule (conceptual, no algorithm here):
   - active organization binding points to active ruleset;
   - ruleset points to legal value versions;
   - consumers use that reference chain only.

---

## Owner Legal Control Panel (section)

### Controls
- `country_pack` lifecycle metadata
- `country_pack_ruleset` lifecycle and activation metadata
- `legal_value` catalog governance
- `legal_value_version` publishing/retirement
- organization binding overrides/policies in `organization_country_settings` (if governance allows)

### Can modify
- legal/ruleset/platform values and references.
- activation states and legal-effective configuration metadata.

### Must never touch
- client operational records.
- client workspace truth rows.
- Accounting Base financial entries/summaries as legal value source.
- module-owned business state directly.

---

## Forbidden mixing (section)

Never mix across layers:

1. country-specific legal logic into Core.
2. country-specific legal logic into Accounting Base.
3. legal values into client workspace entities.
4. ruleset ownership into module-local hidden constants as source of truth.
5. owner panel governance data with client operational state.
6. financial truth with legal value truth.

---

## Allowed extension points

1. Country Pack registration (`country_pack`) for new jurisdictions.
2. Ruleset evolution (`country_pack_ruleset`) without client-data rewrites.
3. Legal value versioning (`legal_value_version`) with immutable history.
4. Organization-level activation/switching via `organization_country_settings`.
5. Capability declaration via `country_extension_capability`.

---

## Open questions / UNKNOWN

1. UNKNOWN: final policy for single vs multi-active ruleset per organization context.
2. UNKNOWN: rollback semantics when a published legal_value_version is superseded.
3. UNKNOWN: compatibility guarantees when capability contracts evolve.
4. UNKNOWN: governance flow for emergency legal updates vs regular release cycle.
5. UNKNOWN: organization-level override policy boundaries (if any) versus global legal defaults.
6. UNKNOWN: strict audit retention requirements for legal value/ruleset lifecycle events.
