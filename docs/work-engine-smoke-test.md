# Work Engine smoke test (local helper)

Stage 3G adds a **local-only** script to exercise Work Engine HTTP endpoints with a real Supabase access token. This is **not** product code and **not** deployed UI.

## Required environment variables

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | API root including `/api/v1`, e.g. `https://nodexpro.onrender.com/api/v1` (no trailing slash required). |
| `AUTH_TOKEN` | Supabase **access** JWT (same value you would send as `Authorization: Bearer …` in the app). |
| `ORG_ID` | Organization UUID. Sent as header `x-organization-id` (see `apps/api/src/middleware/auth.ts`). |
| `CLIENT_ID` | Client UUID that belongs to that organization (used in `intake_work_event` payload). |

## Optional

| Variable | Description |
|----------|-------------|
| `TEST_PERIOD_KEY` | `period_key` for the smoke event. Must satisfy Work Engine `period_key` format. Default: `payroll:2026-05`. |

## How to run

From the repository root:

```bash
export API_BASE_URL="https://your-host.com/api/v1"
export AUTH_TOKEN="your-supabase-access-token"
export ORG_ID="00000000-0000-0000-0000-000000000001"
export CLIENT_ID="00000000-0000-0000-0000-000000000002"
# optional:
# export TEST_PERIOD_KEY="payroll:2026-05"

node scripts/smoke/work-engine-smoke.mjs
```

If any required variable is missing, the script exits with code **2** and prints which variables to set.

On success, exit code **0** and each step prints `PASS`. On HTTP/shape failure, exit code **1** and failed steps print `FAIL` with a short error snippet (never the token).

## What the script does

1. `GET /health` — liveness.
2. `GET /work-engine/aggregates/foundation` — checks `aggregate_key === work_engine_foundation_aggregate` and `org_id` matches `ORG_ID`.
3. `GET /work-engine/aggregates/queue` — checks aggregate shape (`summary_cards`, `rows`, `filters`, `pending_mapping_section`).
4. `POST /work-engine/commands` with `command: intake_work_event` and a **safe** synthetic payload:
   - `event_type`: `payroll.documents_missing` (Stage 3B mapper allowlist)
   - `source_module`: `smoke_test`
   - `source_entity_id`: `smoke-test-client-period`
   - `emitted_by_type`: `system`
5. Repeats the **same** intake payload — expects `meta.intake_result === duplicate_event` (idempotency).
6. `GET /work-engine/aggregates/queue` again — ensures no crash after intake.

## Security rules

- **Never commit** `.env`, tokens, or service role keys. `.env` is gitignored at the repo root.
- **Never paste** production tokens into tickets, screenshots, or docs.
- The script **does not print** `AUTH_TOKEN` (only confirms that it is set).

## Interpreting results

- **PASS** + HTTP 200: response matched minimal shape checks.
- **FAIL** with 401/403: token invalid/expired, wrong org header, or user not a member of the org.
- **FAIL** on first intake: often wrong `CLIENT_ID` for the org, or RBAC/data issue — read the printed JSON snippet (no secrets).
- Second step **must** be `duplicate_event` if the first intake was accepted as a new event (same dedup tuple). If the first call was already `duplicate_event` from a previous run, the second will also be `duplicate_event` — still PASS.

## Related code

- Routes: `apps/api/src/domains/work-engine/work-engine.routes.ts`
- Intake: `apps/api/src/domains/work-engine/work-engine.event-intake.service.ts`
- Mapper allowlist: `apps/api/src/domains/work-engine/work-engine.event-mapping.service.ts`
