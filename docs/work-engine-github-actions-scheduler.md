# Work Engine — GitHub Actions Scheduler

This document describes the **GitHub Actions trigger** for the Work Engine background scheduler. It does **not** implement business logic — the API on Render owns SLA recompute, reminder candidate creation, escalation evaluation, and snooze wake-up.

Workflow file: [`.github/workflows/work-engine-scheduler.yml`](../.github/workflows/work-engine-scheduler.yml)

## 1. Create the GitHub secret

In the repository:

1. Open **Settings → Secrets and variables → Actions**
2. Add a new repository secret:
   - **Name:** `WORK_ENGINE_CRON_SECRET`
   - **Value:** (see step 2 below)

Do **not** commit the secret value to git. The workflow reads it only via `${{ secrets.WORK_ENGINE_CRON_SECRET }}`.

## 2. Value must match Render `INTERNAL_CRON_SECRET`

On Render (API service environment):

- Variable: `INTERNAL_CRON_SECRET`

The GitHub secret `WORK_ENGINE_CRON_SECRET` must be **exactly the same string** as Render’s `INTERNAL_CRON_SECRET`. The API route validates the header `X-Internal-Cron-Secret` against `INTERNAL_CRON_SECRET`.

If they differ, the workflow receives **403 Forbidden** and fails.

## 3. Schedule and manual runs

| Trigger | Behavior |
| --- | --- |
| **Cron** | Every **30 minutes** (`*/30 * * * *`, UTC) |
| **workflow_dispatch** | Manual run from the Actions tab (“Run workflow”) |

Each run sends:

```http
POST https://nodexpro.onrender.com/api/v1/work-engine/internal/scheduler/run
Content-Type: application/json
X-Internal-Cron-Secret: <from WORK_ENGINE_CRON_SECRET>

{"batch_size":100,"max_work_items_per_run":500}
```

The workflow:

- Fails on non-2xx HTTP status (or `ok: false` in JSON when parseable)
- Prints only a **safe summary** (counts and flags — no secrets, no raw tokens)
- Uses a **10-minute job timeout** and **180s curl timeout**
- **Retries once** after 15s on transient failures (5xx, 408, 429, or curl network/timeout errors)

Overlapping GitHub runs are serialized via `concurrency: work-engine-scheduler`. The API also skips duplicate in-process runs when a previous invocation is still active.

## 4. Trigger only — backend owns all logic

GitHub Actions is a **clock + HTTP client**. It does not:

- Read module databases (payroll, VAT, documents, etc.)
- Decide work states, SLAs, or reminder text
- Send email or DocFlow messages

Render API `runWorkEngineScheduler` processes Work Engine tables only (`work_items`, `work_sla_obligations`, `work_events`, `work_reminder_candidates`). Modules connect by emitting `intake_work_event` — see [work-engine-module-event-contract.md](./work-engine-module-event-contract.md).

## 5. No auto-send — reminders need accountant approval

The scheduler may create **`pending_review` reminder candidates** and **escalated work items**. It does **not**:

- Approve or send reminders
- Call DocFlow delivery
- Auto-close work items

Sending still requires an accountant to use **Reminder Review** and explicitly approve (`approve_send_reminder_candidate`). Escalations follow the manual acknowledge/resolve flow from the queue.

## 6. Verifying setup

1. Confirm Render has `INTERNAL_CRON_SECRET` set.
2. Confirm GitHub has `WORK_ENGINE_CRON_SECRET` with the same value.
3. Run the workflow manually (**Actions → Work Engine Scheduler → Run workflow**).
4. Expect a green run and log lines similar to:

   ```json
   {"ok":true,"skipped":false,"scanned_work_items":…,"recomputed_sla":…,"reminders_created":…,"escalations_created":…,"snoozed_woken":…,"error_count":0}
   ```

Optional local smoke (no GitHub):

```bash
API_BASE_URL=https://nodexpro.onrender.com/api/v1 \
INTERNAL_CRON_SECRET=<same value> \
node scripts/smoke/work-engine-scheduler-smoke.mjs
```

## 7. Related documentation

- [work-engine-module-event-contract.md](./work-engine-module-event-contract.md) — module event intake + Render cron
- [work-engine-event-contract.md](./work-engine-event-contract.md) — event envelope
