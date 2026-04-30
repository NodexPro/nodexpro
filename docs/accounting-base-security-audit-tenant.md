# Accounting Base Security / Audit / Tenant Isolation (Phase 6 - Step 8)

Status: Security architecture definition only.  
No code implementation, no endpoints, no migrations, no DB/runtime/UI changes in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-lifecycle-state-model.md`
- `docs/accounting-base-command-catalog.md`
- `docs/accounting-base-aggregates.md`
- `docs/accounting-base-links-model.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Commands enforce permission + tenant scope + audit
- Aggregates return permission-shaped data only
- UI does not decide permissions/actions

---

## 1) Permission catalog

Required permissions:

1. `accounting.view`
   - View accounting entries/periods/categories context where applicable.

2. `accounting.create_entry`
   - Create new accounting entries.

3. `accounting.edit_draft_entry`
   - Edit mutable draft entry fields.

4. `accounting.finalize_entry`
   - Finalize draft entries.

5. `accounting.archive_entry`
   - Archive entries according to lifecycle policy.

6. `accounting.view_summary`
   - View derived financial summaries.

7. `accounting.manage_categories`
   - Create/update/deactivate organization categories.

8. `accounting.link_entry`
   - Create entry links to external entities.

9. `accounting.unlink_entry`
   - Remove entry links from external entities.

10. `accounting.lock_period`
    - Transition period to locked state.

11. `accounting.close_period`
    - Transition period to closed state.

12. `accounting.reopen_period` (optional/future)
    - Exceptional reopen of closed period.

13. `accounting.view_sensitive_financial_data` (optional)
    - Gate sensitive fields/sections if required by policy.

---

## 2) Role mapping (baseline)

Baseline role decisions (required by task):
- create entries: `accountant`
- finalize entries: `accountant`
- close period: `admin`
- view money: `accountant`
- manage categories: `admin`
- break/override system rules: nobody

Proposed baseline matrix:

## accountant
- allowed:
  - `accounting.view`
  - `accounting.create_entry`
  - `accounting.edit_draft_entry`
  - `accounting.finalize_entry`
  - `accounting.archive_entry`
  - `accounting.view_summary`
  - `accounting.link_entry`
  - `accounting.unlink_entry`
- not allowed (baseline):
  - `accounting.manage_categories`
  - `accounting.close_period`
  - `accounting.reopen_period`

## admin
- allowed:
  - all accountant permissions
  - `accounting.manage_categories`
  - `accounting.lock_period`
  - `accounting.close_period`
  - optional future `accounting.reopen_period` (policy-gated)

## viewer (optional)
- allowed:
  - `accounting.view`
  - `accounting.view_summary` (if policy allows read-only finance visibility)
- not allowed:
  - any mutation permissions

## owner (optional)
- allowed:
  - admin-equivalent by default (subject to org policy)
- not allowed:
  - "break/override system rules" bypass of command/audit/tenant controls

Rule:
- No role may bypass command boundary, tenant validation, or required audit.

---

## 3) Tenant isolation rules

Mandatory tenant model:
1. Every tenant-owned row contains `organization_id`.
2. Every command is scoped by `organization_id` context.
3. Every aggregate/read model is scoped by `organization_id`.
4. Every link validates same organization ownership between entry and target.
5. Cross-tenant totals are forbidden.
6. Cross-tenant links are forbidden.
7. Reading entries from another organization is forbidden.
8. Referenced entity ownership must be validated in backend command/service boundary.

Security invariant:
- tenant scope is enforced in command, query, and aggregate construction layers.

---

## 4) Audit catalog

Required audit/event facts:
- `accounting_period_created`
- `accounting_period_locked`
- `accounting_period_closed`
- `accounting_period_reopened` (optional/future)
- `accounting_entry_created`
- `accounting_entry_updated`
- `accounting_entry_finalized`
- `accounting_entry_archived`
- `accounting_entry_cancelled` (optional/future)
- `accounting_entry_linked`
- `accounting_entry_unlinked`
- `accounting_category_created`
- `accounting_category_updated`
- `accounting_category_deactivated`
- `accounting_summary_recomputed`

Audit payload minimum requirements (all events):
- `actor_user_id`
- `organization_id`
- `target_entity_type`
- `target_entity_id`
- `occurred_at` timestamp
- `command_key` / action key
- domain-relevant payload subset (before/after or key fields changed)

Sensitive data caution:
- avoid storing full sensitive financial payloads when not required.
- prefer references + delta metadata over full raw duplication.
- mask/redact fields in audit payload when policy requires.

---

## 5) Security rules by command

Command matrix (conceptual):

1. `create_period`
- permission: `accounting.close_period` or dedicated period-create permission (TBD)
- tenant validation: org scope + uniqueness/ownership checks
- audit: `accounting_period_created`
- forbidden: period creation outside org scope

2. `lock_period`
- permission: `accounting.lock_period`
- tenant validation: period belongs to org
- audit: `accounting_period_locked`
- forbidden: silent lock

3. `close_period`
- permission: `accounting.close_period`
- tenant validation: period belongs to org
- audit: `accounting_period_closed`
- forbidden: silent close; close without permission

4. `reopen_period` (optional/future)
- permission: `accounting.reopen_period` (admin-only)
- tenant validation: period belongs to org
- audit: `accounting_period_reopened`
- forbidden: reopen without explicit reason/audit

5. `create_entry`
- permission: `accounting.create_entry`
- tenant validation: period/category/client (if provided) belong to org or are allowed system entities
- audit: `accounting_entry_created`
- forbidden: create without required fields or across tenant boundary

6. `update_draft_entry`
- permission: `accounting.edit_draft_entry`
- tenant validation: entry belongs to org
- audit: `accounting_entry_updated`
- forbidden: update finalized entry as draft; mutate closed-period entry without special policy

7. `finalize_entry`
- permission: `accounting.finalize_entry`
- tenant validation: entry + period belong to org
- audit: `accounting_entry_finalized`
- forbidden: finalize invalid entry or bypass lifecycle checks

8. `archive_entry`
- permission: `accounting.archive_entry`
- tenant validation: entry belongs to org
- audit: `accounting_entry_archived`
- forbidden: archive used as silent correction bypass

9. `cancel_entry` (optional/future)
- permission: dedicated cancel permission (TBD; likely admin/accounting-supervisor)
- tenant validation: entry belongs to org
- audit: `accounting_entry_cancelled`
- forbidden: cancel without reason/audit

10. `create_category`
- permission: `accounting.manage_categories`
- tenant validation: org scope for tenant category
- audit: `accounting_category_created`
- forbidden: system category mutation without policy

11. `update_category`
- permission: `accounting.manage_categories`
- tenant validation: category ownership/system policy check
- audit: `accounting_category_updated`
- forbidden: unsafe hierarchy/ownership change

12. `deactivate_category`
- permission: `accounting.manage_categories`
- tenant validation: category ownership/system policy check
- audit: `accounting_category_deactivated`
- forbidden: hard delete that breaks historical integrity

13. `link_entry_to_entity`
- permission: `accounting.link_entry`
- tenant validation: entry and target same org (or allowed global)
- audit: `accounting_entry_linked`
- forbidden: missing/unvalidated target; cross-tenant links

14. `unlink_entry_from_entity`
- permission: `accounting.unlink_entry`
- tenant validation: link belongs to org
- audit: `accounting_entry_unlinked`
- forbidden: unlink outside tenant ownership

15. `recompute_summary` (system/internal)
- permission: system job or privileged maintenance role
- tenant validation: summary scope bound to org
- audit: `accounting_summary_recomputed`
- forbidden: manual summary edits as truth

---

## 6) Aggregate security

Aggregate security requirements:
1. Aggregate returns only data the actor is permitted to view.
2. Sensitive financial fields require `accounting.view_sensitive_financial_data` if enabled by policy.
3. Backend returns available actions based on permission + lifecycle state.
4. UI must not calculate permissions/actions.
5. Aggregate should include explicit permission/action descriptors for deterministic rendering.

Forbidden:
- frontend-side permission inference
- action enablement logic implemented as frontend business rules

---

## 7) Forbidden behavior (explicit)

1. Frontend permission decisions for accounting mutations.
2. Cross-tenant data access/read.
3. Silent edits of finalized entries.
4. Silent period close/reopen transitions.
5. Financial mutations without audit event.
6. Direct DB writes outside command/service boundary.
7. Links to entities from another organization.
8. Returning sensitive financial fields without required permission.

---

## Permission summary

- Minimum operational role: `accountant` for entry lifecycle and summary view.
- Elevated governance role: `admin` for period closure and category management.
- Optional restricted read role: `viewer`.
- No role may bypass command, audit, or tenant controls.

---

## Audit summary

- Every state-changing command emits required audit fact.
- Audit payload must include actor, org, target entity, timestamp, and command context.
- Sensitive payload handling must follow redaction/minimization policy.

---

## Tenant isolation summary

- `organization_id` is mandatory tenant key.
- Command/read/link paths are all org-scoped.
- Cross-tenant links, reads, and totals are forbidden.
- Target entity ownership validation is mandatory for link commands.

---

## Risky decisions

1. Optional `view_sensitive_financial_data` split may increase complexity in aggregate field-level gating.
2. Reopen-period authority can weaken closure guarantees if too broad.
3. Viewer access to summaries may expose sensitive data unless masking policy is explicit.
4. System category governance (global vs tenant override) can create privilege edge cases.
5. Overly generic link permissions may become escalation path without strict target validation.

---

## Open questions / UNKNOWN

1. UNKNOWN: whether `create_period` should have dedicated permission distinct from close/lock.
2. UNKNOWN: final owner/admin/viewer permission inheritance model in Core RBAC.
3. UNKNOWN: exact field-level masking/redaction policy for sensitive financial data in aggregate and audit.
4. UNKNOWN: whether `cancel_entry` becomes standard command or remains exceptional/future.
5. UNKNOWN: final policy for system category modification rights (if any).
6. UNKNOWN: audit retention policy and secure access policy for accounting audit events.

