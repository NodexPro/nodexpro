# Country Pack Ruleset Effective-Date Model (Phase 7 - Step 4)

Status: Policy definition only.  
No migrations, no DB changes, no code, no API, no UI, no module integration in this step.

References:
- `docs/country-pack-boundary.md`
- `docs/country-pack-domain-model.md`
- `docs/country-pack-schema-design.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Country-specific legal logic -> Country Pack only
- Legal values -> Ruleset / Owner Legal Control Panel only
- Financial truth -> Accounting Base only

---

## Ruleset resolution summary

Country Pack resolution is date- and organization-aware:

`organization + country + requested_date`
-> active `organization_country_settings`
-> active `country_pack`
-> active `country_pack_ruleset`
-> resolved `country_legal_value_versions`

Resolution is backend-only. Frontend never chooses rulesets.

---

## 1) Code version vs ruleset version

Definitions:
- `code_version`: technical implementation/build version.
- `ruleset_version`: legal/rule policy version.

Policy:
1. They are independent dimensions.
2. One `code_version` may support multiple `ruleset_version` values.
3. A `ruleset_version` change does not require implicit code version change.
4. Never assume `code_version == ruleset_version`.

---

## 2) Effective date resolution policy

Backend resolution (conceptual flow):

1. Input:
   - organization id
   - country (or inferred from organization settings)
   - requested date (business/legal date context)

2. Resolve organization binding:
   - load `organization_country_settings` valid for requested date.
   - ensure bound country/pack/ruleset consistency.

3. Resolve active ruleset:
   - filter by:
     - same `country_pack`
     - status eligible for runtime resolution (see lifecycle rules)
     - effective window covering requested date

4. Resolve legal values:
   - for each required legal value key:
     - pick `country_legal_value_version` bound to resolved ruleset and valid for requested date.

5. Return:
   - explicit resolved ruleset identity
   - explicit legal value version identities
   - no hidden fallback substitution.

---

## 3) No overlap rule

For a single `country_pack` and any requested date:
- at most one active ruleset may match.

Overlap policy:
1. Overlap among date windows of active rulesets for same pack is invalid.
2. Activation/publish must reject overlap attempts.
3. Conflict must be surfaced to Owner Legal Control Panel before activation.

Result:
- ruleset resolution remains deterministic.

---

## 4) Gap behavior policy

If no ruleset matches requested date:
1. Backend returns controlled failure (explicit "ruleset_not_resolved" style outcome).
2. Country-specific behavior is disabled for that flow.
3. No silent fallback to older/newer/wrong ruleset.
4. No cross-country fallback.

Operational expectation:
- this is governance/configuration error, not a UI heuristic decision.

---

## 5) Historical calculations policy

Rule:
- historical calculations must use the ruleset active on the historical date.

Implications:
1. New ruleset activation must not silently recalculate previously finalized historical outcomes.
2. Recalculation of historical outputs requires explicit controlled command/process.
3. Historical trace should preserve resolved ruleset/version references used at calculation time.

---

## 6) Ruleset lifecycle model

Statuses:
- `draft`
- `active`
- `deprecated`
- `disabled`

Meaning:
- `draft`: editable, not used for production resolution.
- `active`: eligible for runtime resolution by effective date.
- `deprecated`: still resolvable for historical windows but blocked for new activation windows (policy-controlled).
- `disabled`: not eligible for runtime resolution; only governance/history context.

Transition guidance (conceptual):
- draft -> active (after validation/no-overlap checks)
- active -> deprecated (planned replacement path)
- deprecated -> disabled (retirement path)
- active -> disabled (exceptional emergency stop, controlled)

---

## 7) Legal value version resolution policy

Resolution target:
`ruleset + legal_value_key + requested_date`
-> one `legal_value_version`

Policy:
1. Legal value versions are selected within resolved ruleset context.
2. Value version must be effective for requested date.
3. If missing/ambiguous version:
   - controlled failure, no silent substitution.
4. Versions are immutable artifacts; updates create new version rows, not in-place edits.

---

## 8) Owner Legal Control Panel behavior

Owner Legal Control Panel can:
1. Create draft rulesets.
2. Add/update legal value versions in draft/governed flow.
3. Activate ruleset after validation checks.
4. Disable/deprecate ruleset via explicit lifecycle action.
5. View and resolve effective-date overlap conflicts.
6. Inspect gap windows (dates with no resolvable ruleset).

Owner panel must not:
- modify client data
- modify Accounting Base financial truth
- bypass command/audit flow
- apply hidden emergency fallback outside explicit governance action

---

## 9) Forbidden behavior

Explicitly forbidden:
1. Frontend selecting ruleset/version.
2. Module hardcoding legal rates/dates/limits as source of truth.
3. Blindly using latest ruleset for historical dates.
4. Allowing overlapping active rulesets per pack/date.
5. Hidden fallback across countries.
6. Assuming `code_version == ruleset_version`.
7. Silent gap fallback to nearest ruleset.

---

## Effective-date policy (compact)

1. Date-qualified deterministic resolution only.
2. No overlap among active windows.
3. No gaps without controlled failure.
4. Historical date -> historical ruleset.
5. All resolution decisions stay backend-owned and auditable.

---

## Overlap / gap policy (compact)

- Overlap:
  - reject activation/publish
  - show conflict diagnostics in owner panel

- Gap:
  - controlled failure
  - disable local behavior
  - require governance correction, not runtime guess

---

## Open questions / UNKNOWN

1. UNKNOWN: exact deprecated-status runtime eligibility boundaries for historical vs current date requests.
2. UNKNOWN: emergency disable behavior when active ruleset is disabled mid-period.
3. UNKNOWN: whether legal value version windows must be strict subsets of ruleset windows.
4. UNKNOWN: explicit rollback mechanics for mistaken activations (new corrective ruleset vs direct revert).
5. UNKNOWN: minimum persisted trace fields required to guarantee reproducible historical legal outputs.
6. UNKNOWN: SLA and operator workflow for resolving gap/overlap incidents.
