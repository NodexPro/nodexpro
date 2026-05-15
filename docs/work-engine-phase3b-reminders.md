# Work Engine — Phase 3B Reminder Candidates

Status: Phase 3B-1 foundation (schema, owner validators, resolver).  
Tenant candidate generation, SLA hooks, queue UI, and DocFlow dispatch are later phases.

## Boundaries

| Concern | Owner |
|---------|--------|
| Financial amounts (סכום כסף) | Accounting Base only |
| Legal/regulatory tax constants & filing deadlines | Country Pack legal/tax categories |
| Operational reminder cadence & templates | Country Pack category **Operational Communication Policies** |
| Work item orchestration | Work Engine |
| Human review (edit / approve / cancel / snooze) | Work Engine commands |
| Channel delivery (email / portal / docflow) | DocFlow only, **after** approved candidate |

Reminder candidates are **not** accounting truth and **not** legal tax values.

## Architecture (B+ model)

- **Storage:** `country_legal_values` + `country_legal_value_versions` (versioned, ruleset-bound).
- **Category:** `Operational Communication Policies` — separate from VAT / Income Tax / Calendar / etc.
- **Owner UI:** `/platform-owner/legal-control` → `communication_policies` slice (not mixed into tax legal values grid).
- **Candidates:** `work_reminder_candidates` — human approval lifecycle.
- **Delivery intent:** `work_notifications` — only after `approve_reminder_candidate` (intent_type `reminder_candidate_approved`).
- **Generation (3B-2+):** single service `work-engine.reminder.service.ts` only.

## Policy model

Payload type `operational_reminder_policy`:

- `approval_required` (default **true**; no auto-send in Phase 3B)
- `default_channels`: ordered list, e.g. `["docflow", "email", "portal"]`
- `workflows[]`: each with `workflow_type`, `anchor`, `cadence_steps[]`
- Cadence step: `step_key`, `offset_minutes`, `template_key`, optional `channels`, `severity`

Workflow types: `waiting_client`, `response_sla`, `review_sla`.

## Templates

Payload type `operational_reminder_template`:

- `template_key` must start with `comm.reminder.template.`
- `subject_template` / `body_template` with allowlisted `{{variables}}`
- Rendered by Country Pack `renderReminderTemplate()` — not frontend, not Work Engine hardcoded strings.

## Phase map

| Phase | Scope |
|-------|--------|
| **3B-1** | Migration, validators, owner aggregate slice, resolver/renderer |
| **3B-2** | `work-engine.reminder.service.ts`, candidate generation, SLA hook |
| **3B-3** | Queue `reminder_review` section + accountant commands |
| **3B-4** | DocFlow dispatch after approve |
| **3C** | `work_escalation_candidates` (separate from reminders) |

## Explicit non-goals (3B)

- Auto-send without accountant approval
- Scheduler / snooze wake worker
- AI-generated copy
- Client-specific template overrides
- VAT/payroll statutory deadline reminders in this flow
