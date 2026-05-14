# Work Engine smoke test (local helper)

Stage 3G adds a **local-only** script to exercise Work Engine HTTP endpoints with a real Supabase access token. **Stage 4B** extends the same script to run **write commands** and assert each response returns a **refreshed queue aggregate** (NodexPro: command → full aggregate).

This is **not** product code and **not** deployed UI.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | API root including `/api/v1`, e.g. `https://nodexpro.onrender.com/api/v1` (no trailing slash required). |
| `AUTH_TOKEN` | Supabase **access** JWT (same value you would send as `Authorization: Bearer …` in the app). |
| `ORG_ID` | Organization UUID. Sent as header `x-organization-id` (see `apps/api/src/middleware/auth.ts`). |
| `CLIENT_ID` | Client UUID that belongs to that organization (used for `intake_work_event` and `create_work_item`). |

## Optional

| Variable | Description |
|----------|-------------|
| `TEST_PERIOD_KEY` | `period_key` for **command** tests (`create_work_item`, filters). Must satisfy Work Engine `period_key` format (see `docs/work-engine-dedup-policy.md` §8). Default for commands: `smoke:2026-05`. If unset, **intake** steps default to `payroll:2026-05` (mapper-friendly). If you set `TEST_PERIOD_KEY`, **both** intake and commands use that value. |
| `TEST_ASSIGNEE_USER_ID` | User UUID in the org. If set, `assign_work_item` assigns that user; if unset, the script assigns `null` (unassign), which still bumps `version` from `new` without promoting to `assigned`. |
| `TEST_REVIEWER_USER_ID` | Reserved for future reviewer command coverage; not used by the script today. |
| `SMOKE_RUN_ID` | Stable string to build unique `source_entity_id` per run (avoids accidental dedup with prior runs). Default: `run-<timestamp>`. |

## How to run

From the repository root:

```bash
export API_BASE_URL="https://your-host.com/api/v1"
export AUTH_TOKEN="your-supabase-access-token"
export ORG_ID="00000000-0000-0000-0000-000000000001"
export CLIENT_ID="00000000-0000-0000-0000-000000000002"
# optional:
# export TEST_PERIOD_KEY="smoke:2026-05"
# export TEST_ASSIGNEE_USER_ID="<member user uuid>"
# export SMOKE_RUN_ID="local-dev-2026-05-14"

node scripts/smoke/work-engine-smoke.mjs
```

Exit codes:

| Code | Meaning |
|------|---------|
| **0** | All checks passed (`PASS` for every step). |
| **1** | At least one check failed (`FAIL` printed with a short detail; never the token). |
| **2** | Missing required env vars — script lists which to set. |

## What the script does

### Stage 3G (read + intake)

1. `GET /health` — liveness.
2. `GET /work-engine/aggregates/foundation` — checks `aggregate_key === work_engine_foundation_aggregate` and `org_id` matches `ORG_ID`.
3. `GET /work-engine/aggregates/queue` — checks aggregate shape (`summary_cards`, `rows`, `filters`, `pending_mapping_section`).
4. `POST /work-engine/commands` with `command: intake_work_event` and a synthetic payload (`event_type: payroll.documents_missing`, `source_module: smoke_test`, …).
5. Repeats the **same** intake payload — expects `meta.intake_result === duplicate_event` (idempotency).
6. `GET /work-engine/aggregates/queue` again — ensures no crash after intake.

### Stage 4B (commands + queue refresh)

Uses safe synthetic work metadata (unique per run unless `SMOKE_RUN_ID` is reused intentionally):

- `module_key`: `smoke_test`
- `work_type`: `smoke_validation`
- `source_entity_id`: `smoke-stage4b-<SMOKE_RUN_ID>`

Each mutating command sends `refresh_aggregate: work_engine_queue_aggregate` and `aggregate_filters` scoped to `module_key`, `period_key`, `client_id` so the returned aggregate is easy to validate.

| Step | Command | What is asserted |
|------|---------|------------------|
| T7 | `create_work_item` | HTTP 200, `refreshed.aggregate` is queue aggregate; row appears with expected keys; captures `work_item_id` and `version`. |
| T8 | `assign_work_item` | Version increments; queue aggregate refreshed. |
| T9 | `change_work_state` | Transition to `waiting_client`; version increments; queue refreshed. |
| T9b | `change_work_state` | **Illegal** transition (`waiting_client` → `approved`); expects HTTP **400** and `code === invalid_transition`. |
| T10 | `set_work_deadline` | Sets `due_at` ~7 days ahead; version increments; queue refreshed. |
| T11 | `apply_work_override` | `override_kind: assignment` (no `reason_text` required); `override_active === true`; version increments; queue refreshed. |
| T12 | `assign_work_item` | Sends **stale** `expected_version: 0`; expects HTTP **409** and `code === version_conflict`. |

If **T7** does not find the new row (e.g. wrong `CLIENT_ID` / DB error), downstream command tests are skipped and reported as **FAIL**.

## Security rules

- **Never commit** `.env`, tokens, or service role keys. `.env` is gitignored at the repo root.
- **Never paste** production tokens into tickets, screenshots, or docs.
- The script **does not print** `AUTH_TOKEN` (only confirms that it is set).

## Interpreting results

- **PASS** + HTTP 200: response matched the checks for that step.
- **FAIL** with 401/403: token invalid/expired, wrong org header, or user not a member of the org.
- **FAIL** on `create_work_item`: wrong `CLIENT_ID` for the org, validation error, or unique constraint — read the printed JSON snippet (no secrets).
- **FAIL** on `assign_work_item` with `TEST_ASSIGNEE_USER_ID`: assignee may not exist in `users` / not valid for FK — try unset (unassign path) or another member id.
- Intake dedup: second intake **must** be `duplicate_event` if the first was accepted; if a previous run already deduped the tuple, still **PASS**.

## Related code

- Routes: `apps/api/src/domains/work-engine/work-engine.routes.ts`
- Commands: `apps/api/src/domains/work-engine/work-engine.commands.service.ts`
- Intake: `apps/api/src/domains/work-engine/work-engine.event-intake.service.ts`
- Mapper allowlist: `apps/api/src/domains/work-engine/work-engine.event-mapping.service.ts`
- Script: `scripts/smoke/work-engine-smoke.mjs`
