# Architecture Enforcer v1

`Architecture Enforcer v1` is an executable repository check for NodexPro architecture constraints.

## Run

```bash
npm run architecture:check
npm run architecture:baseline
npm run architecture:report
```

`architecture:check` exits with non-zero code only when **NEW P0** violations are found vs baseline.

## Baseline mode

- Baseline file: `architecture-baseline.json`
- Generate/update baseline intentionally:

```bash
npm run architecture:baseline
```

`architecture:check` compares current violations against baseline and shows:
- `BASELINE` (already tolerated in transition)
- `NEW` (newly introduced)
- `RESOLVED` (removed since baseline)

## What it enforces now (v1)

P0 (fails build):
- `RULE_A_NO_PATCH_PUT` - generic PATCH/PUT in workspace flows
- `RULE_B_AGGREGATE_ONLY_READ` - hidden GET/workspace stitched reads
- `RULE_C_COMMAND_ONLY_WRITE` - non-command workspace writes
- `RULE_D_FULL_REFRESH_AFTER_COMMAND` - local truth patch after command
- `RULE_E_NO_FRONTEND_BUSINESS_LOGIC` - frontend semantic derivation heuristics
- `RULE_F_BACKEND_TABLE_OWNERSHIP` - frontend-owned semantic table structures

P1 (warnings):
- `RULE_G_STATE_ACTION_EVENT` - likely state/action/event mixing
- `RULE_H_LEGACY_ENDPOINT` - legacy endpoint usage in workspace UI
- `RULE_WRAPPER_UNRESOLVED` - unresolved indirect API/service wrapper call
- `RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE` - financial truth outside Accounting Base (transition warning)
- `RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK` - country-specific legal logic outside Country Pack/ruleset ownership (transition warning)

## Config

See `architecture-enforcer.config.mjs`:
- workspace file scope
- allowed command endpoint patterns
- endpoint classification:
  - `allowedOperationalReadEndpoints`
  - `allowedOperationalWriteEndpoints`
  - `forbiddenWorkspaceTruthEndpoints`
  - `deprecatedLegacyEndpoints`
- semantic field heuristic list
- allowlist for temporary exceptions
- baseline location

## Allowlist exceptions

Use config allowlists only for temporary infrastructure exceptions:
- `backendPatchPutAllowlist`
- `frontendPatchPutAllowlist`

Each exception should include TODO context in code review and be removed after migration to command flow.

## Output

For each violation:
- rule id
- severity
- file and line
- matched node summary
- reason (NodexPro)
- minimal safe fix
- stable signature for baseline matching
- baseline status (`BASELINE` / `NEW`)

## Workspace flow report

`npm run architecture:report` returns workspace-level summary:
- aggregate source(s)
- read source(s)
- write source(s)
- full replace evidence
- suspicious partial update evidence
- unresolved indirect calls

## Financial truth rule (transition mode)

NodexPro permanent rule:
- Financial truth source must be Accounting Base.
- Documents are not accounting entries.

Transition behavior in enforcer:
- `RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE` is currently **WARN-only**.
- Existing legacy flows are tolerated.
- New financial logic outside Accounting Base is warned.
- If Accounting Base is not available yet, mark code with:
  - `TEMPORARY_ACCOUNTING_BASE_PENDING`
  and keep implementation minimal and easy to migrate.

## Country Pack rule (transition mode)

NodexPro permanent rule:
- Country-specific legal logic source must be Country Pack Framework / active ruleset / owner legal values.

Transition behavior in enforcer:
- `RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK` is currently **WARN-only**.
- Existing legacy country logic is tolerated during transition.
- New country-specific hardcoding outside Country Pack is warned.
- If Country Pack integration is not ready, mark code with:
  - `TEMPORARY_COUNTRY_PACK_PENDING`
  and keep implementation minimal and migration-friendly.

## Example output

```text
[RULE_A_NO_PATCH_PUT] ERROR
  file: apps/web/src/components/ClientWorkspacePanel.tsx:447
  signature: 41d3c8b9491d98ea
  match: PATCH moduleClientOperationsUpdateClientProfile(clientId)
  baseline_status: BASELINE
```

```text
[RULE_B_AGGREGATE_ONLY_READ] ERROR
  file: apps/web/src/components/NewTab.tsx:122
  signature: 9a1bfe0a7c028fe2
  match: GET moduleClientOperationsAccountingSettingsTab(clientId)
  baseline_status: NEW
```

```text
RESOLVED baseline entries (no longer present):
  - 5ca4fd9f3f90a2a7 [RULE_C_COMMAND_ONLY_WRITE] apps/web/src/components/Legacy.tsx :: POST moduleOldSave(clientId)
```

```text
[RULE_WRAPPER_UNRESOLVED] WARN
  file: apps/web/src/components/TabX.tsx:88
  match: Unresolved indirect call: updateClient()
  reason: Indirect wrapper call could hide method/path semantics.
```
