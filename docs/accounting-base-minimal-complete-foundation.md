# Accounting Base - Minimal Complete Foundation Scope (Phase 6 - Step 9)

Status: Scope definition only.  
No code, no migrations, no endpoints, no UI, no runtime behavior changes in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-lifecycle-state-model.md`
- `docs/accounting-base-command-catalog.md`
- `docs/accounting-base-aggregates.md`
- `docs/accounting-base-links-model.md`
- `docs/accounting-base-security-audit-tenant.md`

Architecture contract:
- Core -> Commands -> Aggregate -> UI
- Financial truth source = accounting entries
- Foundation must be minimal to implement safely and complete enough to avoid future architectural rewrite

---

## Scope summary

Minimal Complete Foundation means:
- implement only neutral accounting core capabilities
- include all structural building blocks required for future integrations
- exclude country/module-specific logic until explicit follow-up phases
- keep strict architectural rules from day one

---

## 1) Included in first implementation

The first implementation scope includes:

1. Core accounting entities:
   - `accounting_periods`
   - `accounting_categories`
   - `accounting_entries`
   - `accounting_entry_links`
   - derived `accounting_summaries`

2. Lifecycle:
   - entry posting flow: `draft -> finalized`
   - period lifecycle: `open -> locked -> closed`

3. Security/compliance:
   - tenant isolation (`organization_id` scope)
   - permissions model
   - audit events on state-changing commands

4. Read/write architecture:
   - aggregate read models for all first-scope screens
   - command-only writes
   - full refreshed aggregate after command

5. Link model:
   - entry links to client/document/external entity descriptors
   - explicit relation model (not implicit ownership)

---

## 2) Explicitly NOT included yet

Excluded from first implementation:

1. Israel VAT logic
2. Israel tax due-date logic
3. Payroll tax calculation logic
4. Multi-currency normalization engine
5. Reopen closed period flow
6. Advanced reconciliation workflows
7. Automatic module integrations
8. שכ״ט integration
9. client-operations refactor

Design rule:
- exclusions are intentional to protect stability and prevent scope bleed.

---

## 3) Non-negotiable quality rules

Mandatory:
1. no generic PATCH
2. no hidden GET
3. no stitched reads
4. no frontend business logic
5. entries are financial truth
6. summaries are derived
7. documents are not entries
8. all writes through commands
9. all reads through aggregates
10. full refreshed aggregate after command

Additional:
- UI renders backend truth only
- command/action/state/event separation must be respected

---

## 4) First implementation screens

Required screen set:
1. Entries workspace
2. Entry details
3. Periods workspace
4. Categories workspace
5. Summary workspace

Each screen must have one aggregate truth source.

---

## 5) First implementation commands

Required command set:
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
13. `recompute_summary` (internal/system only)

No generic save-all commands.

---

## 6) First implementation aggregates

Required aggregate set:
1. `accounting_entries_workspace_aggregate`
2. `accounting_entry_details_aggregate`
3. `accounting_periods_workspace_aggregate`
4. `accounting_categories_workspace_aggregate`
5. `accounting_summary_workspace_aggregate`

Each aggregate must return ready UI truth (sections/tables/statuses/actions/warnings).

---

## 7) Acceptance criteria

Foundation is accepted only if all below are true:

1. can create period
2. can create income/expense entries
3. can categorize entries
4. can link entry to client/document
5. can finalize entry
6. can close period
7. cannot edit finalized entry like draft
8. cannot mutate closed period without authority
9. summaries calculate from entries
10. aggregate returns ready UI truth
11. permissions enforced
12. audit emitted
13. tenant isolation confirmed

---

## 8) Explicit future extension points

Planned extension lanes (outside first implementation):

1. Country-specific tax modules
2. שכ״ט integration
3. Payroll integration
4. Payment/reconciliation module
5. Multi-currency normalization
6. Reopening/correction flows

Rule:
- extensions consume Accounting Base through command + aggregate boundaries, not by duplicating financial truth.

---

## Included / Excluded list (concise)

Included:
- neutral accounting core model + lifecycle + links + summaries + security + aggregates + commands

Excluded:
- country/module-specific tax/payment/payroll/fees integrations and advanced correction flows

---

## Risky decisions

1. Deferring reopen/correction flows may pressure teams to create temporary bypasses if governance is weak.
2. Deferring multi-currency normalization can create temporary reporting constraints.
3. Link model flexibility may drift without strict target-type governance.
4. Summary recompute strategy (sync/async) can impact perceived consistency.
5. Category governance (system vs org) can become inconsistent without strict policy.

---

## Open questions / UNKNOWN

1. UNKNOWN: final enum set for entry/status/posting/category/relation types at implementation time.
2. UNKNOWN: overlap policy for accounting periods.
3. UNKNOWN: strict SLA for summary recomputation freshness guarantees.
4. UNKNOWN: exact correction model for finalized entries in future phase (reversal vs amendment).
5. UNKNOWN: phased permission rollout details for optional viewer/owner role variants.
6. UNKNOWN: minimum audit payload retention and redaction policy for sensitive financial contexts.

