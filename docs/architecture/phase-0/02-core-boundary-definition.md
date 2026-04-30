# 2. Core Boundary Definition

**Document type:** Phase 0 — System boundaries  
**Mandatory:** All design must respect these boundaries.

---

## 2.1 What Is Inside the Product

- **Core platform:** Identity, access (RBAC), organizations, subscriptions, module activation, shared entities, audit, notifications, file metadata and access control.
- **Modules:** Pluggable functional units (global and/or country-specific) that depend on Core and optionally on each other.
- **Country extensions:** Country Packs (e.g. Israel) that add local data and rules via defined extension points.
- **Frontend:** Thin client that consumes backend APIs and renders data/state from backend; no business authority.

---

## 2.2 What Is Outside the Product (External Integrations)

- **Supabase (Auth, DB, Storage):** Platform foundation; used as infrastructure, not “inside” the application’s business boundary.
- **Payment / billing provider:** External; Core stores subscription state and plan; payment events drive updates via integration.
- **External identity providers (if any):** Used for login only; application user and RBAC remain in Core.
- **Third-party document/export services:** Called by backend when needed; not part of Core data model.
- **Local statutory/filing gateways (e.g. Israel):** Country Pack integrates with them; they are external.

**Rule:** External systems are not the source of truth for organizations, users, permissions, or entitlement. Core is. **Mandatory.**

---

## 2.3 What Belongs to Core

| Area | In Core | Notes |
|------|---------|--------|
| Organizations | Yes | Single source of truth; public schema |
| Application users (profiles) | Yes | Linked to auth; public schema |
| Roles and permissions | Yes | RBAC model; public schema |
| Subscriptions and plans | Yes | Commercial state; public schema |
| Modules catalog | Yes | List of modules; public schema |
| Organization–module activation | Yes | organization_modules; public schema |
| Clients (shared) | Yes | Shared entity; public schema |
| Contacts (shared) | Yes | Shared entity; public schema |
| Shared notes | Yes | Public schema |
| Shared activities | Yes | Public schema |
| File/assets metadata | Yes | Public schema; files in Storage |
| Audit log | Yes | Public schema |
| Notifications | Yes | Public schema |
| Tenant isolation (RLS baseline) | Yes | Policies in DB |
| Auth integration | Yes | Use of Supabase Auth; app user in public |

**Core owns:** Platform identity, access model, shared entities, subscription/entitlement state, and security baseline. **Mandatory.**

---

## 2.4 What Belongs to Modules

- Module-specific domain entities (e.g. payroll runs, document workflows, invoice lines).
- Module-specific transactional data; all with `organization_id`.
- Module-specific UI and API surface; all gated by entitlement on backend.
- Modules **do not** own: organizations, users, roles, shared clients, or Core subscription/entitlement.

---

## 2.5 What Belongs to Country Pack (e.g. Israel)

- Country-specific entities: tax profiles, VAT configuration, reporting cycles, local payroll rules, national insurance rules, statutory obligations, local filing entities.
- Country-specific integration logic and mapping to external systems.
- **Not** in global Core tables as first-class columns without an extension model. **Mandatory.**

---

## 2.6 Boundary Summary

- **Core:** Everything needed for multi-tenant identity, access, shared data, subscription, and security. No module-specific or country-specific business logic in Core (except extension points).
- **Modules:** Vertical functionality; depend on Core; use shared entities via Core; store only module-specific data.
- **Country Pack:** Local rules and data; extend Core/modules via extension points; no mixing into global Core without boundaries.

---

*See also: 01 (overview), 03 (module catalog), 04 (global vs Israel), 05 (shared entities).*
