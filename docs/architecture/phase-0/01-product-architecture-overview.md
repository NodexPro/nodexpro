# 1. Product Architecture Overview

**Document type:** Phase 0 — Master architectural description  
**Mandatory:** Yes. All subsequent design and implementation must align with this document.

---

## 1.1 Product Vision

**What is being built:** A single, modular SaaS platform that provides a common foundation (Core) and pluggable modules. A customer can buy one module first and add others later. Data is unified and synchronized across modules. One module may be sold globally; others may be Israel-only. The system is structured as **Core + Modules + Country Extensions**.

**Target:** B2B customers (organizations). Access is per-organization (multi-tenant). Users belong to organizations and use functionality according to subscription, plan, and role.

**Why SaaS:** Centralized hosting, single codebase, subscription-based commercial model, continuous delivery, tenant isolation by design.

**Why modular monolith at start:** Single deployable unit, shared database, clear module boundaries in code and data, no distributed system complexity at launch. **Early microservices are prohibited.**

**Product growth:** New modules are added without rewriting Core. Country-specific logic is added via Country Packs (e.g. Israel Pack) without polluting global Core.

---

## 1.2 Architectural Style

| Aspect | Decision |
|--------|----------|
| **Style** | SaaS, multi-tenant, modular monolith at startup |
| **Extensions** | Country Packs / country extensions; centralized Core ownership |
| **Frontend** | **Dumb:** renders data, calls backend, displays returned state only |
| **Authority** | Backend, database, policy layer are authoritative; frontend is not |
| **Infrastructure base** | Supabase as platform foundation; Postgres as primary database; Supabase Auth, Storage, RLS |

---

## 1.3 Core Definition

**Core** is the non-removable platform foundation. It owns:

- Platform identity and access model (organizations, application users, roles, permissions)
- Shared platform entities (clients, contacts, shared notes, shared activities, file_assets, notifications, audit_log)
- Subscription and module activation (subscriptions, modules, organization_modules)
- Tenant isolation and security baseline (RLS, server-side authorization)
- Authentication foundation (integration with Supabase Auth; application user profile in public schema)

**Core does not own:** Module-specific business logic, country-specific rules (e.g. Israeli tax, payroll, statutory), or vertical workflows that belong to a module.

**Boundary:** If it is needed by more than one module or by the platform itself (auth, billing, isolation), it belongs in Core or in shared entities owned by Core. If it is specific to one module and one domain, it stays in the module. If it is specific to a country, it goes into a Country Pack.

See: [02-core-boundary-definition.md](./02-core-boundary-definition.md).

---

## 1.4 Module Definition

**Module:** A bounded unit of functionality that (a) extends Core, (b) does not own Core entities, (c) may depend on Core and on other modules via declared dependencies, (d) exposes capabilities that are gated by **entitlement** (purchased/activated for the organization).

**A module must:**

- Declare its dependency on Core (mandatory) and optionally on other modules
- Use only shared entities via Core-defined APIs/contracts; not duplicate them
- Store module-specific data in its own schema/namespace with `organization_id` for tenant scope
- Not implement its own identity, RBAC, or tenant isolation; use Core
- Not make frontend the source of truth for permissions, entitlement, or business rules

**A module must not:**

- Own or duplicate Core entities (organizations, users, roles, clients, etc.)
- Enforce access control only in the UI
- Contain Israel-specific logic unless it is an Israel-only module or extends via Country Pack

See: [03-module-catalog.md](./03-module-catalog.md), [06-module-dependency-matrix.md](./06-module-dependency-matrix.md).

---

## 1.5 Country Pack Definition

**Country Pack:** A controlled extension that adds country-specific data model, rules, and behavior. It extends Core and/or modules through defined extension points (e.g. tax profiles, reporting cycles, local payroll rules). It does not replace Core and does not mix local fields into global Core tables without an extension model.

**Israel Country Pack** contains (examples): tax profiles (Israel), VAT configuration, reporting cycles, payroll local rules, national insurance rules, statutory obligations, local filing entities. These entities and rules **do not** live in global Core; they live in Israel-specific schemas/tables or extension tables keyed by country.

**Rule:** Israel-specific logic must not be mixed into global Core tables without explicit boundaries (e.g. extension tables, country code, or separate Israel schema). **Mandatory.**

See: [04-global-vs-israel-separation.md](./04-global-vs-israel-separation.md).

---

## 1.6 Domain Map

- **Core domain:** Identity, access, organizations, subscriptions, module activation, shared entities (clients, contacts, notes, activities, files, audit, notifications).
- **Module domains:** Defined per module (e.g. payroll, billing, documents, workflow). Each module has its own domain; it does not own Core domain.
- **Country domain (Israel):** Local tax, payroll, statutory, filing. Owned by Israel Country Pack, not by global Core.

---

## 1.7 Data Ownership Map (Summary)

| Entity / Data | Owner | Location / Note |
|---------------|--------|------------------|
| Organization | Core | public schema, Core tables |
| User (application profile) | Core | public schema; linked to auth via id, not duplicate of auth.users |
| Roles, permissions | Core | public schema |
| Subscriptions, plans | Core | public schema |
| Modules, organization_modules | Core | public schema |
| Clients, contacts | Core (shared) | public schema, shared entities |
| Shared notes, activities | Core | public schema |
| File metadata, document lifecycle | Core | public schema + Supabase Storage with policy |
| Audit log | Core | public schema |
| Notifications | Core | public schema |
| Module-specific transactional data | Module | public schema, module tables, organization_id |
| Payroll results | Payroll module | module-owned; not Core |
| Israel tax profiles, VAT, local rules | Israel Country Pack | Israel extension / country-specific schema |

Full map: [05-shared-entities-map.md](./05-shared-entities-map.md).

---

## 1.8 Security Baseline (Summary)

- **Tenant isolation:** All tenant-scoped data must be scoped by `organization_id`. Enforced by RLS and server-side checks. **Mandatory.**
- **Authorization:** All critical authorization is enforced server-side (backend + DB policies). UI may hide elements but is not the security boundary. **Mandatory.**
- **RBAC:** Roles and permissions live in Core; modules consume them, do not define their own identity model.
- **Module entitlement:** Access to module features is checked on the backend using `organization_modules` / subscription state.
- **Files:** Stored in Supabase Storage with policies; metadata and access control in Core; no public dump. **Mandatory.**
- **Audit:** Critical actions (access to sensitive data, entitlement changes, billing) are logged; policy defined in Security Baseline. **Mandatory.**

Full baseline: [07-security-baseline.md](./07-security-baseline.md).

---

## 1.9 Commercial Access Model (Summary)

- **Subscription:** Contract with the tenant (organization); determines validity period and plan.
- **Plan:** Tier (e.g. Basic, Pro) that determines which modules and limits are available.
- **Entitlement:** Derived from subscription + plan; “this org is allowed to use module X.”
- **Module activation:** Stored in Core (`organization_modules`); checked on every module entry point on the backend. **Mandatory.**
- **Role permissions:** What a user can do within an org; independent of subscription. A user may have permission to use a feature that is not entitled; backend must enforce: (entitlement AND permission) for module features.

Full model: [08-commercial-access-model.md](./08-commercial-access-model.md).

---

## 1.10 Architectural Prohibitions (Summary)

The following are **prohibited**:

- Duplicating organization or user data in modules
- Making a module the owner of the shared client entity
- Keeping business logic only on the frontend or making frontend the source of truth
- Treating UI gating as sufficient security
- Mixing Israel and global logic without boundaries
- Building the product as a set of independent applications
- Early move to microservices
- Module-specific access rules only on the UI
- Adding local country fields directly into global Core tables without an extension model
- Search/report/export without a tenant-aware security model
- Using file storage as an open dump without controlled access
- Treating the auth provider as the full application user model

Full list: [10-architectural-constraints-prohibitions.md](./10-architectural-constraints-prohibitions.md).

---

## 1.11 Frontend Dumb Architecture

**Mandatory rule:** The frontend is dumb. It does not hold business authority.

**What the frontend must NOT do:**

- Implement or decide business rules (billing, entitlement, workflow, payroll, compliance, document lifecycle)
- Compute permissions or module availability as the source of truth
- Authorize access (it may hide UI elements based on data from backend, but hiding is not security)
- Store or interpret subscription/plan/entitlement as authoritative
- Make decisions about sensitive data visibility or audit

**What the frontend must do:**

1. **Render** data received from the backend.
2. **Call** backend commands (API); not implement business logic locally.
3. **Display** state returned by the backend (success, error, updated data).
4. **Render UI** according to data and permissions/entitlements **provided by the backend** (e.g. `/me/capabilities`, or fields on resources).

**Source of truth:** Backend, database, policy layer, rules engines, entitlement layer. Frontend is a consumer of their outputs.

**How the frontend gets permissions and module availability:**

- Backend exposes an endpoint (e.g. current user’s permissions, list of enabled modules for the org, feature flags for the org). Frontend calls it and caches for UX only.
- Every sensitive or module-gated operation is validated again on the backend. Frontend only uses the same data for UX (show/hide, disable buttons). **Mandatory.**

**Why this is critical for modular SaaS:** Prevents drift between what the UI “thinks” and what the backend enforces; ensures entitlement and compliance are never bypassed; keeps a single place (backend/DB) for audits and changes.

---

## 1.12 Supabase / Postgres Architecture Alignment

**Application tables:** All application data lives in the **public** schema (or in clearly namespaced schemas for modules/country). Supabase `auth` schema is used only for authentication (auth.users, sessions). **Mandatory.**

**Auth vs application users:**

- **auth.users:** Supabase-managed; identity, login, password/MFA. Do not use as the full application user model.
- **Application user:** Row in public schema (e.g. `profiles` or `users`) linked to `auth.users.id`; holds display name, org membership, role, etc. All business logic and RBAC use the application user, not auth.users alone. **Mandatory.**

**Organization isolation:**

- Every tenant-scoped table has `organization_id`. RLS policies restrict rows by `organization_id` derived from the current application user’s org(s). Server-side checks must also enforce `organization_id` on write/read. **Mandatory.**

**File storage:**

- Files in Supabase Storage. Metadata (owner org, document type, lifecycle) in public schema. Access control via Storage policies + application checks; no public bucket without strict policies. **Mandatory.**

**RLS and server-side checks:**

- RLS is the database-level baseline for tenant isolation. Backend must still validate `organization_id` and entitlement for sensitive operations (defense in depth). **Mandatory.**

---

## 1.13 Core vs Shared vs Module vs Country Boundaries

| Layer | Owner | Contains |
|-------|--------|----------|
| **Core** | Platform | Identity, access, orgs, subscriptions, module activation, shared entities, audit, notifications, file metadata, RLS baseline |
| **Shared platform entities** | Core | clients, contacts, shared notes, shared activities, file_assets — used by modules via Core contracts |
| **Global modules** | Product | Modules that can be sold globally; depend on Core; may depend on each other per dependency matrix |
| **Country Pack framework** | Platform | Extension points, country code, registration of country-specific modules/entities |
| **Israel-specific** | Israel Country Pack | Tax profiles (Israel), VAT, reporting cycles, payroll local rules, national insurance, statutory, local filing entities |

**Rule:** Core and shared entities are not duplicated in modules. Israel-specific data and rules are not stored in global Core tables without an extension model (e.g. country-specific table or `country_code` + extension schema). **Mandatory.**

---

## 1.14 Commercial Control Model (Summary)

- **Subscription:** Entity in Core; links org to plan and validity.
- **Plan:** Defines which modules and limits are available; stored in Core.
- **Entitlement:** Computed from subscription + plan; “org has access to module X.”
- **Module activation:** Persisted in Core (`organization_modules`); checked on backend at module entry points.
- **Role permissions:** Stored in Core; define what a user can do; checked on backend together with entitlement for module features.

Separation: subscription/plan/entitlement are commercial; role/permission are access control. Both are required for module features; both are enforced on the backend. **Mandatory.**

**Current commerce implementation (module-based):** The platform uses **module-based commerce**. Per-module entitlement is resolved only from `organization_module_subscriptions` and `modules.is_system` (system modules always entitled). The legacy platform-wide tables `plans`, `plan_modules`, and `subscriptions` are **deprecated for module entitlement**; they remain only for backward compatibility and limited legacy use (e.g. org creation, legacy GET subscription). No mixed entitlement logic is allowed. See [commerce-module-based/01-commerce-implementation-package.md](../commerce-module-based/01-commerce-implementation-package.md) and [commerce-module-based/02-legacy-plans-deprecation.md](../commerce-module-based/02-legacy-plans-deprecation.md).

---

## 1.15 Data Ownership (Detailed)

- **Organization:** Core only. Single source of truth in public schema.
- **User identity (application):** Core. Profile in public schema; auth via Supabase Auth.
- **Shared clients:** Core. Modules reference them; no module owns the client entity.
- **Documents / file metadata:** Core (metadata + lifecycle); files in Storage with policies.
- **Payroll results:** Payroll module. Core does not own payroll results.
- **Local Israel rulesets:** Israel Country Pack. Not in global Core; extension or country schema.

---

## 1.16 Deferred Decisions

The following are explicitly **deferred** (to be decided in a later phase, not “we might think later”):

- Exact list of global vs Israel-only modules (to be finalized in product backlog; catalog structure is fixed).
- Choice of reporting/analytics stack (tenant-aware requirement is fixed).
- Exact retention and backup SLA (policy is “we will define”; baseline is in Security Baseline).

---

## 1.17 Verification: Answers to the 18 Questions

After Phase 0, the following must be answerable from this package:

1. **What is Core?** — The non-removable platform foundation: identity, access, orgs, subscriptions, shared entities, tenant isolation, audit (see 1.3, 02).
2. **What is a module?** — A bounded unit extending Core, with declared dependencies, using shared entities via Core, gated by entitlement (see 1.4, 03, 06).
3. **What is a Country Pack?** — A country-specific extension (e.g. Israel) with its own entities/rules; extends Core/modules via extension points (see 1.5, 04).
4. **Where are access rights stored?** — In Core (public schema): roles, permissions; enforced server-side and by RLS (see 05, 07).
5. **How do we know which modules are purchased?** — Core: subscriptions, plans, `organization_modules`; entitlement derived and checked on backend (see 08).
6. **Where is the organization stored?** — Core, public schema (see 05).
7. **How are tenants’ data isolated?** — `organization_id` on all tenant data; RLS + server-side checks (see 07).
8. **Which entities belong only to Core?** — Orgs, application users, roles, permissions, subscriptions, modules, organization_modules, audit_log, notifications, shared clients, contacts, notes, activities, file_assets (see 05).
9. **Which entities are module-specific?** — Per module (e.g. payroll runs, document workflows); see 03, 05.
10. **Which entities belong only to Israel Pack?** — Israel tax profiles, VAT config, reporting cycles, local payroll rules, national insurance, statutory, local filing (see 04, 05).
11. **How does a module get access to shared data?** — Via Core APIs/contracts; no duplication; module tables reference Core entities by id (see 05, 06).
12. **What happens when a module is disabled?** — Backend denies access to module features; data may be retained or handled per retention policy; UI reflects state from backend (see 08).
13. **What happens when a subscription expires?** — Entitlement revokes; backend denies access to gated features; defined in Commercial Access Model (see 08).
14. **Where is the boundary between global and local logic?** — Country Pack extension points; Israel-specific tables/schemas; no Israel fields in global Core without extension model (see 04).
15. **Where is security enforced?** — Backend and DB policies (RLS); frontend is not the security boundary (see 07, 1.11).
16. **How are critical actions audited?** — Audit log in Core; policy in Security Baseline (see 07).
17. **Which data is sensitive?** — Defined in Security Baseline (e.g. PII, financial, payroll, auth) (see 07).
18. **Which architectural decisions are prohibited?** — Listed in document 10 and summarized in 1.10.

---

*Phase 0 master document. For boundaries, modules, entities, dependencies, security, commercial model, DoD, and prohibitions, use the linked artifacts.*
