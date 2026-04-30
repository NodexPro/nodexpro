# Accounting Base Boundary (Phase 6 - Step 1)

Status: Draft boundary definition (no runtime implementation in this step).

## Purpose

Accounting Base is a neutral, global accounting foundation for financial truth in NodexPro.

Architecture alignment:
- Core -> Commands -> Aggregate -> UI
- Financial truth source of truth -> Accounting Base only

This document defines boundaries only. It does not introduce schema, migrations, endpoints, or UI.

## Scope of Financial Truth

Financial truth includes:
- income
- expense
- payment
- payroll amounts
- fees
- balances
- totals
- financial summaries

Rule:
- If data participates in financial truth, its canonical source must be Accounting Base.

## Core Domain Definitions

## 1) accounting_entry

`accounting_entry` is the atomic financial fact unit.

Required properties (conceptual):
- tenant/org ownership
- period association
- category association
- direction/sign semantics (income or expense)
- amount and currency semantics
- source reference metadata (where it came from)
- lifecycle state metadata (draft/finalized, timestamps, actor context)

Rules:
- Entry is a fact record, not a UI artifact.
- Entry identity is stable; derived totals are not stored as entry replacement.

## 2) accounting_period

`accounting_period` is the canonical time boundary for accounting truth and aggregation.

Required semantics:
- explicit period key (for example month/quarter/year variants by configuration)
- status/lifecycle (open, locked/finalized workflow controlled by command policy)
- tenant-scoped ownership

Rules:
- Period is a boundary for validation, summarization, and finalization semantics.
- Modules do not own period truth.

## 3) accounting_category

`accounting_category` is the canonical classification for entries.

Required semantics:
- tenant-safe category namespace
- stable category identity/code
- grouping hierarchy support (conceptual)

Rules:
- Categories are accounting classification primitives, not module-local labels.
- Module-specific labels may exist, but mapping to accounting_category is explicit.

## 4) accounting_summary

`accounting_summary` is a derived read model over accounting entries (and period/category boundaries).

Rules:
- Summary is derived, never source of truth.
- Source of truth remains `accounting_entry`.
- Summary may be materialized/cached later, but derivation contract remains authoritative.

## 5) document != accounting_entry

Documents are evidence/artifacts, not accounting facts.

Rules:
- A document can be linked to entries.
- A document cannot replace entry creation/update semantics.
- Uploading a document does not imply accounting entry existence.

## 6) Derived truth rule

Totals/balances/summaries:
- are derived from entries
- are read models for UI/workflows
- are not independent truth sources

## 7) Forbidden inside Accounting Base

Accounting Base must NOT contain:
- country-specific statutory logic (including Israel VAT filing engine specifics)
- payroll tax engine logic
- filing/submission workflows
- document workflow ownership
- client-operation UI workflow orchestration
- module-specific business process ownership

Also forbidden:
- bypass writes outside command/service boundary
- direct table writes to accounting entries from modules (future integration rule)

## 8) Future module usage model (no implementation yet)

Future integration pattern:
1. Module command executes module action.
2. Module command (or orchestration boundary) emits accounting-intent payload.
3. Accounting Base command/service records/updates accounting entries.
4. Aggregate layer returns unified read truth for workspace consumption.
5. UI renders aggregate only.

Important:
- No integration is implemented in this step.
- Existing legacy flows remain unchanged until explicit migration tasks.

## Allowed Responsibilities (Accounting Base)

- Own canonical accounting entries
- Own accounting periods and category taxonomy
- Own entry lifecycle semantics (draft/finalized boundary policy)
- Provide accounting summaries as derived read model
- Enforce tenant-safe scoping for accounting truth
- Support audit-ready command boundaries for accounting mutations
- Provide link model between entries and external/module entities

## Forbidden Responsibilities (Accounting Base)

- Owning module workflow state machines
- Owning document workflow lifecycle
- Implementing statutory filing engines
- Implementing country-specific tax workflow engines
- Acting as UI orchestration layer
- Becoming a generic storage dump for unrelated module data

## Transition Constraints (Current Program State)

- No automatic refactor of existing modules.
- No forced migration in this step.
- No runtime behavior changes in this step.
- New financial truth logic should target Accounting Base design direction.
- If Accounting Base integration is unavailable for a new feature, mark:
  - `TEMPORARY_ACCOUNTING_BASE_PENDING`
  - keep implementation minimal and easy to migrate.

## Open Questions / UNKNOWN

1. UNKNOWN: canonical period granularity policy (monthly-only vs configurable period types).
2. UNKNOWN: category governance model (global catalog + tenant extension vs tenant-only taxonomy).
3. UNKNOWN: multi-currency normalization policy and reporting base currency semantics.
4. UNKNOWN: finalize/lock policy authority (role-based only vs period workflow engine).
5. UNKNOWN: event sourcing level (full immutable ledger vs controlled mutation with audit trail).
6. UNKNOWN: conflict resolution model for concurrent command writes on shared entries/periods.
7. UNKNOWN: exact integration boundary contract between module commands and accounting commands.

