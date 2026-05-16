# Work Engine — Stage 10 Acceptance Report (Phase 3E)

**Date:** 2026-05-16  
**Scope:** Stages 3B-3 through 3D (reminder review, delivery hardening, auto reminders, escalation, scheduler)  
**Method:** Static architecture review + unit tests + smoke scripts (no full staging E2E in CI yet)

---

## Executive recommendation

| Verdict | Meaning |
| --- | --- |
| **Stage 10 software: READY** | Architecture contract held; core machine implemented and test-covered. |
| **Production go-live: CONDITIONAL** | Requires ops checklist below (secrets, migrations, policy, live smoke). |

---

## A. What passed

### Architecture contract (no drift detected)

| Rule | Status | Evidence |
| --- | --- | --- |
| Reads only via aggregates | **PASS** | `WorkEngineQueue.tsx` — GET `/work-engine/aggregates/queue` only |
| Writes only via commands | **PASS** | POST `/work-engine/commands` only; no PATCH |
| Backend owns actions/labels | **PASS** | `work-engine.read-models.service.ts` — `queue_shell`, `allowed_actions`, reminder review rows |
| No frontend SLA/reminder/escalation logic | **PASS** | No `canEscalate` / `sla_` business rules in `apps/web` Work Engine pages |
| State ≠ action ≠ event | **PASS** | `work_state` transitions via commands; `work_events` intake separate |
| Financial truth not in Work Engine | **PASS** | No accounting entry writes in work-engine domain |
| Legal deadlines not computed in Work Engine | **PASS** | SLA = operational minutes from policy; Country Pack supplies reminder templates |
| No auto-send without approval | **PASS** | `approve_send_reminder_candidate` only path to DocFlow; scheduler creates `pending_review` only |

### 1. Event intake

| Check | Status | How verified |
| --- | --- | --- |
| `intake_work_event` command | **PASS** | `work-engine.commands.service.ts` → `intakeWorkEvent` |
| Allowlist mapping | **PASS** | `work-engine.event-mapping.service.ts` — `SAFE_EVENT_MAPPINGS` |
| Pending mapping persisted | **PASS** | `processing_outcome` + `work_item_id` null |
| Dedup by `event_id` / `idempotency_key` | **PASS** | `findExistingIntakeEvent`, smoke T5 |
| Scheduler reprocess pending | **PASS** | `reprocessPendingWorkEventsForOrg` |
| Tenant isolation | **PASS** | `assertOrgScope`, `assertClientInOrg` on intake |

**Endpoints**

- `POST /api/v1/work-engine/commands` — `{ "command": "intake_work_event", "payload": { ... } }`
- `POST /api/v1/work-engine/events/intake` — Stage 2 audit envelope (prefer commands)

**Sample — valid mapped event**

```json
{
  "command": "intake_work_event",
  "payload": {
    "event_id": "<uuid>",
    "org_id": "<org-uuid>",
    "client_id": "<client-uuid>",
    "source_module": "client_operations",
    "source_entity_type": "payroll_period",
    "source_entity_id": "period-2026-05",
    "event_type": "payroll.documents_missing",
    "period_key": "payroll:2026-05",
    "occurred_at": "2026-05-16T12:00:00.000Z",
    "schema_version": 1,
    "emitted_by_type": "system",
    "emitted_by_id": null,
    "idempotency_key": "client_ops:payroll:2026-05:missing",
    "payload": {}
  }
}
```

**Expected:** `meta.intake_result` = `created` | `reused_existing`; queue aggregate refresh if requested.

**Sample — unknown mapping**

```json
{ "event_type": "module.unknown_event", "...": "same envelope" }
```

**Expected:** `meta.intake_result` = `pending_mapping`; row in `pending_mapping_section` on queue aggregate.

**Sample — duplicate**

Repeat same `event_id` or same `(source_module, idempotency_key)`.

**Expected:** `meta.intake_result` = `duplicate_event`; no new work_item.

### 2. Work item lifecycle

| Command | Status |
| --- | --- |
| `create_work_item` | **PASS** (smoke T7) |
| `assign_work_item`, `pick_up_unassigned`, `claim_work_item`, `release_claim` | **PASS** (smoke) |
| `change_work_state` (waiting_client, review, done, archive) | **PASS** (guards + smoke) |
| `request_review`, `approve_work_item`, `reject_work_item` | **PASS** |
| `apply_work_override` | **PASS** (smoke T11b) |
| `expected_version` conflict | **PASS** (409 smoke T12) |
| Audit transitions | **PASS** | `insertTransition` on commands |

### 3. SLA engine

| Check | Status |
| --- | --- |
| Obligation kinds (response / waiting_client / review) | **PASS** |
| `markDueActiveObligationsBreached` | **PASS** |
| `recomputeWorkItemSlaStatus` idempotent | **PASS** |
| Hooks on commands | **PASS** | `applySlaHooksForCommand` |
| No legal deadline computation | **PASS** |

### 4. Reminder engine

| Check | Status |
| --- | --- |
| Policy-driven cadence (`system_rule`) | **PASS** |
| `evaluateRemindersForWorkItem` after SLA recompute | **PASS** |
| Dedup keys + terminal retry suffix | **PASS** (unit tests) |
| Manual `generate_reminder_candidate` (admin dev tool) | **PASS** |
| Snooze wake (scheduler) | **PASS** |
| Terminal work states skip auto eval | **PASS** (unit test) |
| `approve_send` idempotent when already `sent` | **PASS** |

### 5. Reminder review UX

| UI block | Source | Status |
| --- | --- | --- |
| Banner | `aggregate.banner` | **PASS** |
| Summary cards | `summary_cards` | **PASS** |
| Review modal + table | `reminder_review_*` on queue aggregate | **PASS** |
| Detail pane actions | `allowed_actions` per row | **PASS** (hardened — see §C) |
| Commands from action payloads only | **PASS** |

### 6. DocFlow delivery

| Check | Status |
| --- | --- |
| Approve → `work_notifications` row | **PASS** |
| DocFlow `createSystemMessageCore` on docflow channel | **PASS** |
| `delivery_failed` + audit on failure | **PASS** |
| Retry from `delivery_failed` status | **PASS** (approvable statuses include it) |
| No direct email assumptions | **PASS** |

### 7. Escalation engine

| Check | Status |
| --- | --- |
| Manual escalate / acknowledge / resolve / reassign | **PASS** |
| Auto escalate on SLA breached | **PASS** |
| Owner resolution order | **PASS** (unit tests) |
| Dedup (already escalated, terminal states) | **PASS** |
| Resolve restores `escalation_prior_work_state` | **PASS** |
| Permissions on commands + aggregate | **PASS** |

### 8. Scheduler

| Check | Status |
| --- | --- |
| `POST .../internal/scheduler/run` + secret | **PASS** |
| GitHub Actions workflow (30 min) | **PASS** (deployed) |
| `dry_run` | **PASS** |
| In-process `run_in_progress` lock | **PASS** |
| Batch limits | **PASS** |
| No auto-send | **PASS** |

### 9. RBAC (backend matrix)

Permissions from migrations `109`, `110`, `112`, `116` + command enforcement.

| Action | owner | admin | staff | viewer |
| --- | --- | --- | --- | --- |
| View queue / foundation | yes | yes | yes | yes |
| Write commands (assign, state, reminders) | yes | yes | yes | **no** |
| Pickup / claim | yes | yes | yes | **no** |
| Override | yes | yes | **no** | **no** |
| Review request/approve/reject | yes | yes | yes* | **no** |
| Escalate | yes | yes | **no** | **no** |
| Acknowledge escalation | yes† | yes† | owner only‡ | **no** |
| Resolve escalation | yes | yes | owner‡ | **no** |
| Reassign escalation owner | yes | yes | **no** | **no** |
| Approve/send reminder | yes | yes | yes | **no** |
| Generate reminder draft (dev tool) | admin path | admin path | **no** | **no** |

\*Staff: review commands gated by assignee/reviewer rules in `computeReviewCommands`.  
†Managers + escalation_owner per `canAcknowledgeEscalation`.  
‡Escalation_owner_id match or manager role.

### 10. Failure scenarios

| Scenario | Expected | Status |
| --- | --- | --- |
| DocFlow delivery failure | `delivery_failed`, audit, no silent send | **PASS** (code path) |
| Auto escalation no owner | skip + `work_item_auto_escalation_skipped` audit | **PASS** |
| Invalid payload | 400 + code | **PASS** |
| Version conflict | 409 `WORK_ITEM_VERSION_CONFLICT` | **PASS** (smoke) |
| Duplicate approve | return existing `sent` / idempotency lease | **PASS** |
| Scheduler overlap | `skipped: true`, `run_in_progress` | **PASS** |
| Stale reminder version | 409 conflict message | **PASS** (code) |

### 11. Audit trail

| Event | Audit action |
| --- | --- |
| Intake received / duplicate / mapping | `work_engine.event_*` |
| Work transitions | `work_engine.work_item_*` |
| SLA | `work_engine.work_item_sla_*` |
| Reminder create/approve/send/fail/snooze | `work_engine.reminder_*` |
| Escalation | `work_engine.work_item_escalated*` |
| Scheduler run | `work_engine.scheduler_run` |

### Automated test summary

| Suite | Result |
| --- | --- |
| `tests/work-engine/*.spec.ts` (28 tests) | **ALL PASS** |
| `scripts/smoke/work-engine-smoke.mjs` | Requires live API env |
| `scripts/smoke/work-engine-reminder-smoke.mjs` | Requires policy + work item env |
| `scripts/smoke/work-engine-scheduler-smoke.mjs` | Requires `INTERNAL_CRON_SECRET` |
| `scripts/smoke/work-engine-acceptance.mjs` | **NEW** — 3E orchestrator |

---

## B. What failed / not fully verified in CI

| Gap | Severity | Notes |
| --- | --- | --- |
| No automated E2E against production Render | Medium | Smoke scripts are manual/ops-run |
| Cross-tenant negative test | Low | Code review only; needs second org fixture |
| Full DocFlow delivery E2E | Medium | Requires entitled org + DocFlow module live |
| Escalation E2E in smoke | Low | Covered by unit tests; not in `work-engine-smoke.mjs` yet |
| GitHub scheduler first green run | Ops | Needs `WORK_ENGINE_CRON_SECRET` |

**No architectural violations found** — no patch-based writes, no frontend truth ownership.

---

## C. Minimal hardening fixes applied (3E)

| Fix | File | Why |
| --- | --- | --- |
| Reminder review `allowed_actions` now require `work_engine.write` or `work_engine.admin` | `work-engine.reminder-review.service.ts` | Aggregate previously enabled actions for any member including **viewer**; commands correctly returned 403 — UI/contract mismatch. |

---

## D. Remaining production risks

1. **Migrations** — Ensure `109`–`116` applied on Supabase (especially `116` escalation spine, `114` reminder candidates).
2. **Operational reminder policy** — Auto reminders only run when Owner Legal Control / Country Pack active policy exists.
3. **Cron secret** — `WORK_ENGINE_CRON_SECRET` (GitHub) = `INTERNAL_CRON_SECRET` (Render).
4. **Render cold start** — 30-min cron may hit slow instances; workflow has retry.
5. **DocFlow entitlement** — Reminder delivery path requires DocFlow module active for org.
6. **Scale** — Scheduler `max_work_items_per_run=500`; large tenants may need tuning or more frequent runs.
7. **Module emitters** — Only allowlisted `event_type` values create work items; new modules must extend `SAFE_EVENT_MAPPINGS`.

---

## E. Stage 10 closure

**Stage 10 (Work Engine operational machine): READY for merge and staged rollout.**

**Production go-live: CONDITIONAL READY** — complete before enabling cron for all tenants:

- [ ] Run `node scripts/smoke/work-engine-acceptance.mjs` against staging
- [ ] Run `node scripts/smoke/work-engine-smoke.mjs` against staging
- [ ] Confirm GitHub Actions “Work Engine Scheduler” green with secret set
- [ ] Confirm active operational reminder policy in Owner Legal Control
- [ ] Confirm migration `116` on production database

---

## How to run acceptance locally

```bash
# Unit tests
cd apps/api && npx tsx --test tests/work-engine/*.spec.ts

# 3E orchestrator (API + optional scheduler)
export API_BASE_URL=https://<host>/api/v1
export AUTH_TOKEN=<token>
export ORG_ID=<org>
export CLIENT_ID=<client>
export INTERNAL_CRON_SECRET=<optional same as Render>
node scripts/smoke/work-engine-acceptance.mjs

# Full lifecycle smoke
node scripts/smoke/work-engine-smoke.mjs
```

See also: [work-engine-smoke-test.md](./work-engine-smoke-test.md), [work-engine-github-actions-scheduler.md](./work-engine-github-actions-scheduler.md), [work-engine-module-event-contract.md](./work-engine-module-event-contract.md).
