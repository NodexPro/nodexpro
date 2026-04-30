# 10. Architectural Constraints and Prohibitions

**Document type:** Phase 0 — Mandatory rules and prohibited decisions  
**Mandatory:** These constraints and prohibitions must not be violated by design or implementation.

---

## 10.1 Mandatory Rules

| # | Rule |
|---|------|
| 1 | **Core owns** platform identity and access model (organizations, users, roles, permissions). |
| 2 | **Modules extend** Core; they do not own Core. |
| 3 | **Country packs** extend Core and modules through controlled extension points only. |
| 4 | **Frontend is dumb:** only renders data, calls backend, displays returned state; no business authority. |
| 5 | **Backend is authoritative** for business logic, entitlement, and access. |
| 6 | **Database constraints and policy layer** (e.g. RLS) are authoritative for tenant isolation and consistency. |
| 7 | **No client-side business authority:** no critical decisions (billing, entitlement, workflow, payroll, compliance, document lifecycle) on frontend. |
| 8 | **All tenant-bound data** must be scoped by organization_id. |
| 9 | **All critical authorization** must be enforced server-side (backend and/or DB policies). |
| 10 | **Module entitlement, subscription, and role** are separate concerns; all are checked where required. |
| 11 | **Shared entities** must not be duplicated by modules. |
| 12 | **Israel-specific logic** must not be mixed into global Core tables/services without explicit boundaries (extension model). |
| 13 | **Early microservices** are prohibited; **modular monolith** is mandatory at startup. |

---

## 10.2 Prohibited Decisions

| # | Prohibition |
|---|-------------|
| 1 | **Duplicate organization data** in modules. |
| 2 | **Duplicate user data** in modules (use Core application user; link by id). |
| 3 | **Make a module the owner** of the shared client entity (Core owns clients). |
| 4 | **Keep business logic only on frontend** or make frontend the source of truth. |
| 5 | **Treat UI gating** as sufficient security (hiding buttons is not authorization). |
| 6 | **Mix Israel and global logic** without boundaries (no Israel-only columns in global Core tables without extension model). |
| 7 | **Build the product** as a set of independent applications (must be one platform: Core + modules). |
| 8 | **Move to microservices** before the modular monolith is stable and boundaries are clear. |
| 9 | **Implement module-specific access rules only on the UI** (must be enforced on backend). |
| 10 | **Add local country fields** directly into global Core tables without an extension model (e.g. extension tables, country schema). |
| 11 | **Use search, report, or export** without a tenant-aware security model (all results must be scoped by organization). |
| 12 | **Use file storage** as a public dump without controlled access (policies + metadata in Core). |
| 13 | **Treat the auth provider** (e.g. auth.users) as the full application user model (application user profile must live in public schema and be used for RBAC). |

---

## 10.3 Deferred Decisions

The following are **explicitly deferred** (to be decided in a later phase; not left vague):

- **Exact list of modules** (global and Israel): structure and rules are fixed; final catalog can be updated in product backlog.
- **Reporting/analytics stack:** requirement is “tenant-aware”; technology choice deferred.
- **Exact backup/retention SLA:** “defined and documented” is mandatory; concrete RPO/RTO deferred to implementation.

---

## 10.4 Summary

- **Mandatory:** 13 architectural rules (Core ownership, frontend dumb, backend authoritative, tenant scope, no Israel in global Core without boundaries, modular monolith at start, etc.).
- **Prohibited:** 13 prohibited decisions (duplication, frontend as authority, UI-only security, mixing Israel/global, early microservices, etc.).
- **Deferred:** Final module list, analytics stack choice, exact backup SLA — to be decided in later phases with explicit decisions.

---

*See also: 01 (overview), 02 (core boundary), 07 (security), 08 (commercial).*
