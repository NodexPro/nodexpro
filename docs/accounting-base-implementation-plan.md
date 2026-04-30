# Accounting Base - Implementation Plan (Phase 6 - Step 10)

Status: Execution plan only.  
No code, no migrations, no runtime changes, no API/UI creation, no module integrations in this step.

Related architecture docs:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-lifecycle-state-model.md`
- `docs/accounting-base-command-catalog.md`
- `docs/accounting-base-aggregates.md`
- `docs/accounting-base-links-model.md`
- `docs/accounting-base-security-audit-tenant.md`
- `docs/accounting-base-minimal-complete-foundation.md`

Architecture invariants (must be preserved end-to-end):
- Core -> Commands -> Aggregate -> UI
- Write path = commands only
- Read path = aggregates only
- Full refreshed aggregate after command
- No generic PATCH
- No hidden GET
- No frontend business logic
- Financial truth = `accounting_entries`

---

## 1) Implementation phases (strict order)

### Phase 1 - Core integration

Scope:
1. Register Accounting Base permissions in Core authorization model.
2. Ensure `organization_id`/tenant context is available and mandatory in all future Accounting Base command/read execution paths.

Exit criteria:
- permission keys are defined and stable;
- tenant scoping contract is explicit and reusable;
- no command/read path can execute without org context.

---

### Phase 2 - Database schema

Scope:
1. Create:
   - `accounting_periods`
   - `accounting_categories`
   - `accounting_entries`
   - `accounting_entry_links`
   - `accounting_summaries`
   - optional `accounting_activity_timeline`
2. Apply constraints/indexes from schema design and tenant isolation contract.

Exit criteria:
- schema supports all planned commands and aggregates;
- uniqueness/foreign key/state constraints are in place;
- org-scoped query paths are index-covered.

---

### Phase 3 - Domain services layer (internal)

Scope:
1. Implement internal services:
   - accounting entry service
   - period service
   - category service
   - link service
   - summary service (derived)
2. Keep services internal and reusable by command handlers.

Exit criteria:
- each service has clear ownership and no cross-layer leakage;
- lifecycle and validation logic is centralized in backend services;
- summary service treats summaries as derived only.

---

### Phase 4 - Commands implementation

Implement commands one-by-one in exact order:
1. `create_period`
2. `lock_period`
3. `close_period`
4. `create_entry`
5. `update_draft_entry`
6. `finalize_entry`
7. `archive_entry`
8. `create_category`
9. `update_category`
10. `deactivate_category`
11. `link_entry_to_entity`
12. `unlink_entry_from_entity`

Per-command mandatory checks:
- validate tenant
- validate permissions
- enforce lifecycle rules
- emit audit event

Exit criteria:
- all first-scope commands execute through command handlers only;
- no direct write bypass exists;
- command behavior is deterministic and auditable.

---

### Phase 5 - Aggregates implementation

Implement aggregates one-by-one:
1. `accounting_entries_workspace_aggregate`
2. `accounting_entry_details_aggregate`
3. `accounting_periods_workspace_aggregate`
4. `accounting_categories_workspace_aggregate`
5. `accounting_summary_workspace_aggregate`

Each aggregate must:
- return ready UI truth
- include actions
- include statuses
- include permissions
- include summaries

Exit criteria:
- each planned screen has one authoritative aggregate source;
- aggregate payloads are complete enough to avoid frontend business interpretation;
- no screen requires hidden/secondary GET to render core truth.

---

### Phase 6 - Internal summary computation

Scope:
1. Implement summary calculation pipeline as derived projection.
2. Ensure summaries are never used as financial source of truth.

Exit criteria:
- summary values can always be recomputed from entries;
- summary drift detection/recompute strategy is defined;
- accounting truth ownership remains in entries.

---

### Phase 7 - Security enforcement

Scope:
1. Enforce permission checks in all commands.
2. Enforce org isolation in command and aggregate paths.
3. Enforce link validation rules (tenant-safe target references and allowed relation types).

Exit criteria:
- no command executes without permission guard;
- no cross-tenant read/write path exists;
- links cannot create illegal or cross-tenant references.

---

### Phase 8 - QA / validation

Scope:
1. Validate against Step 9 acceptance criteria.
2. Verify:
   - entries flow
   - period lifecycle
   - summary correctness
   - permission enforcement
   - tenant isolation

Exit criteria:
- acceptance criteria pass as a full set;
- architecture invariants are verified in tests/review gates;
- foundation is stable before any module integration.

---

## 2) Strict ordering rules

Mandatory sequence rules:
1. Do NOT implement aggregates before commands exist.
2. Do NOT implement commands before schema exists.
3. Do NOT connect UI before aggregates are ready.
4. Do NOT connect modules before Accounting Base is stable.

Enforcement note:
- if ordering is violated, work is considered invalid and must be rolled back/reworked before continuation.

---

## 3) Forbidden during implementation

Explicitly forbidden:
1. No integration with client-operations.
2. No integration with שכ״ט.
3. No tax logic.
4. No VAT logic.
5. No payroll logic.
6. No shortcuts (PATCH, direct DB writes bypassing command layer).
7. No partial updates as final truth flow.

---

## 4) Incremental delivery strategy

Delivery model:
1. Each phase must be independently testable.
2. Commit per phase.
3. Validate phase before moving forward.

Recommended gate per phase:
- architecture rule check
- command/aggregate behavior check
- tenant/permission check
- audit emission check (for write phases)

---

## 5) Risks during implementation

Primary risks:
1. Mixing `status` and `posting_state` semantics.
2. Bypassing command layer in edge write paths.
3. Leaking cross-tenant data in read/write or links.
4. Treating summaries as truth instead of derived projection.
5. Creating link inconsistencies (invalid target, stale relation, illegal type).

Risk controls:
- explicit state model checks in command handlers;
- centralized command write enforcement;
- tenant guard at command entry and query scope;
- recompute-from-entries validation for summaries;
- strict link validation + audit.

---

## 6) Phase summary

Plan outcome:
- establish secure Core and schema foundation first;
- implement domain services and commands before any aggregate/UI exposure;
- build complete aggregate truth layer;
- harden summary/security guarantees;
- certify foundation with acceptance criteria before integrations.

---

## 7) Execution order (concise)

1. Core permissions + tenant context
2. Schema
3. Internal services
4. Commands (ordered list)
5. Aggregates (ordered list)
6. Summary derivation hardening
7. Security hardening
8. QA validation against Step 9 criteria

---

## 8) Risk summary (concise)

- Highest risk: architectural bypasses (command bypass, hidden reads, summary-as-truth).
- Highest impact: tenant leakage and lifecycle violations.
- Control strategy: strict phase gates, per-command guards, per-aggregate completeness, and mandatory audit/permission checks.

---

## 9) Open questions / UNKNOWN

1. UNKNOWN: exact migration sequencing strategy across environments (dev/stage/prod) and rollback policy.
2. UNKNOWN: required performance SLA for aggregate rebuild and summary recomputation at higher data volumes.
3. UNKNOWN: final permission matrix granularity by role (especially lock/close/archive authority variants).
4. UNKNOWN: operational policy for backfill/recompute after historical data correction events.
5. UNKNOWN: final policy for optional `accounting_activity_timeline` scope in first release versus immediate follow-up.

