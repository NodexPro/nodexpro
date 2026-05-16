# Work Engine — Module Event Contract (Stage 10 Phase 3D)

Status: **Active integration contract** for all NodexPro modules that need operational work orchestration.

Architecture: **Core → Commands → Aggregate → UI**. Modules emit facts; Work Engine owns work items, SLA, reminders, and escalations.

## 1. How any module connects

Modules **do not** call Work Engine internals, **do not** write `work_items` directly, **do not** create reminder candidates, and **do not** send DocFlow/email.

The only supported write path:

```
Module domain action
  → POST /api/v1/work-engine/commands
      command: "intake_work_event"
      payload: { ...envelope... }
  → Work Engine maps event_type (allowlist)
  → creates or reuses active work_item
  → scheduler later recomputes SLA / reminders / escalations
```

Background processing (no user click):

```
Render Cron (or ops)
  → POST /api/v1/work-engine/internal/scheduler/run
      Header: X-Internal-Cron-Secret: <INTERNAL_CRON_SECRET>
  → processes work_events, work_items, reminder candidates (snooze wake)
  → never sends messages automatically
```

Full envelope field reference: [work-engine-event-contract.md](./work-engine-event-contract.md).

## 2. Minimal emitter shape

```json
{
  "command": "intake_work_event",
  "payload": {
    "event_id": "<uuid>",
    "org_id": "<uuid>",
    "client_id": "<uuid>",
    "source_module": "client_operations",
    "source_entity_type": "obligation_task",
    "source_entity_id": "<stable-id>",
    "event_type": "payroll.documents_missing",
    "period_key": "payroll:2026-05",
    "occurred_at": "2026-05-15T10:00:00.000Z",
    "emitted_by_type": "system",
    "emitted_by_id": null,
    "schema_version": 1,
    "idempotency_key": "client_ops:payroll:2026-05:missing_docs",
    "payload": { }
  }
}
```

Rules:

- `event_type` must be in the backend allowlist (`work-engine.event-mapping.service.ts`). Unknown types are stored as **pending mapping** until the allowlist is extended.
- `period_key` is required for work-creating mappings (see dedup policy).
- `source_module` is the emitter identity (audit lineage). `module_key` on the work item comes from the mapper, not from the emitter.

## 3. What the scheduler does (and does not)

The scheduler reads **Work Engine tables only**:

| Step | Action |
| --- | --- |
| A | Reprocess pending `work_events` (mapping now allowed → link/create work_item) |
| B–E | For active `work_items`: recompute SLA, evaluate reminder candidates, evaluate auto-escalation |
| F | Wake `work_reminder_candidates` where `status = snoozed` and `snoozed_until <= now` |

It **never**:

- Scrapes payroll/VAT/documents modules for state
- Auto-sends DocFlow/email
- Approves reminders
- Closes work items
- Computes financial truth (Accounting Base) or legal deadlines (Country Pack)

## 4. Example event types by module (future / planned)

These are **illustrative** `event_type` strings. Each must be added to the backend allowlist before intake creates work items.

### client-operations

| event_type | Meaning |
| --- | --- |
| `client_ops.missing_annual_report_documents` | Annual report materials missing for period |
| `client_ops.missing_capital_declaration_documents` | Capital declaration package incomplete |
| `client_ops.missing_payroll_material` | Payroll inputs missing for period |
| `client_ops.missing_vat_material` | VAT supporting documents missing |

### VAT

| event_type | Meaning |
| --- | --- |
| `vat.vat_docs_missing` | VAT filing documents not received |
| `vat.vat_deadline_near` | Filing window approaching (signal; legal dates from Country Pack) |

### Payroll

| event_type | Meaning |
| --- | --- |
| `payroll.payroll_material_missing` | Employer/client payroll material missing |
| `payroll.payroll_review_needed` | Office review required before filing |

### Accounting Base (signals only — not financial source of truth)

| event_type | Meaning |
| --- | --- |
| `accounting_base.unpaid_invoice_followup_needed` | Follow-up work item for collections workflow |
| `accounting_base.reconciliation_blocked` | Reconciliation cannot proceed; human action needed |

### fees / annual report / capital declaration

Use the same pattern: emit a stable `event_type`, `period_key`, and `source_entity_id`. Do not PATCH work items from those modules.

Currently allowlisted examples (see code): `payroll.documents_missing`, `vat.documents_missing`, `annual_report.documents_missing`, `docflow.thread_needs_attention`.

## 5. Render Cron configuration

Schedule (example — adjust frequency per ops policy):

```http
POST https://nodexpro.onrender.com/api/v1/work-engine/internal/scheduler/run
Content-Type: application/json
X-Internal-Cron-Secret: <INTERNAL_CRON_SECRET>
```

Optional JSON body:

```json
{
  "batch_size": 100,
  "max_work_items_per_run": 500,
  "dry_run": false
}
```

Response summary (top-level):

```json
{
  "ok": true,
  "skipped": false,
  "scanned_work_items": 42,
  "recomputed_sla": 42,
  "reminders_created": 3,
  "escalations_created": 1,
  "snoozed_woken": 2,
  "errors": []
}
```

Set `INTERNAL_CRON_SECRET` in Render (same variable as DocFlow daily scheduler).

## 6. Smoke test

```bash
API_BASE_URL=https://nodexpro.onrender.com \
INTERNAL_CRON_SECRET=... \
node scripts/smoke/work-engine-scheduler-smoke.mjs
```

## 7. Related docs

- [work-engine-event-contract.md](./work-engine-event-contract.md) — envelope + idempotency
- [work-engine-dedup-policy.md](./work-engine-dedup-policy.md) — active work_item tuple
- [work-engine-state-machine.md](./work-engine-state-machine.md) — work_state transitions
