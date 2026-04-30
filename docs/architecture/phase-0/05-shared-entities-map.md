# 5. Shared Entities Map

**Document type:** Phase 0 — Data ownership and shared entities  
**Mandatory:** Modules must not duplicate or take ownership of Core-owned entities.

---

## 5.1 Core-Owned Entities (Global)

All in **public** schema (or platform-owned schema). All tenant-bound tables have **organization_id**. **Mandatory.**

| Entity | Table (logical) | Owner | Notes |
|--------|------------------|--------|--------|
| Organizations | organizations | Core | Single source of truth |
| Application users | users / profiles | Core | Linked to auth.users.id; not duplicate of auth |
| Roles | roles | Core | RBAC |
| Permissions | permissions | Core | RBAC |
| Role–permission mapping | role_permissions | Core | RBAC |
| User–org–role | organization_members / user_roles | Core | Per-org membership and role |
| Subscriptions | subscriptions | Core | Links org to plan and validity |
| Plans | plans | Core | Defines module set and limits |
| Modules (catalog) | modules | Core | List of available modules |
| Organization–module activation | organization_modules | Core | Which modules are enabled per org |
| Audit log | audit_log | Core | Critical actions; immutable append |
| Notifications | notifications | Core | User/org notifications |
| File/assets metadata | file_assets | Core | Metadata; files in Supabase Storage |
| Clients (shared) | clients | Core | Shared across modules; modules reference by id |
| Contacts (shared) | contacts | Core | Shared; may link to clients |
| Shared notes | shared_notes | Core | Shared notes (e.g. linked to clients/entities) |
| Shared activities | shared_activities | Core | Shared activity log (e.g. linked to clients/entities) |

---

## 5.2 Shared Entities: Usage by Modules

- **Modules may:** Read/write via Core APIs or well-defined contracts; reference `clients.id`, `contacts.id` in their own tables (foreign key or logical reference).
- **Modules must not:** Duplicate `organizations`, `users`, `clients`, `contacts`; create their own “client” table that replaces shared client. **Prohibited.**

---

## 5.3 Module-Specific Entities (Examples)

- Payroll module: payroll_runs, payroll_lines, payslip_metadata (module-owned; organization_id on each).
- Documents module: document_templates, document_workflows, document_versions (if not in Core); organization_id on each.
- Billing module: invoices, invoice_lines, payment_records; organization_id on each.

Rule: Module tables always have **organization_id** for tenant scope and RLS. **Mandatory.**

---

## 5.4 Israel-Only Entities (Not in Global Core)

| Entity | Owner | Location |
|--------|--------|----------|
| Tax profiles (Israel) | Israel Country Pack | Extension / il schema |
| VAT configuration (Israel) | Israel Country Pack | Extension / il schema |
| Reporting cycles | Israel Country Pack | Extension / il schema |
| Payroll local rules | Israel Country Pack | Extension / il schema |
| National insurance rules | Israel Country Pack | Extension / il schema |
| Statutory obligations | Israel Country Pack | Extension / il schema |
| Local filing entities | Israel Country Pack | Extension / il schema |

These are **not** in the global Core entity list. **Mandatory.**

---

## 5.5 Master vs Transactional vs Module-Specific

| Type | Owner | Examples |
|------|--------|----------|
| **Master (platform)** | Core | organizations, users, roles, clients, contacts, plans, modules |
| **Transactional (platform)** | Core | subscriptions, organization_modules, audit_log, notifications, file_assets metadata |
| **Module-specific** | Module | payroll runs, invoice lines, document versions |
| **Country-specific** | Country Pack | Israel tax profiles, local rules |

---

## 5.6 Organization Isolation

- Every table that holds tenant data has **organization_id** (or is joined through a chain that ends in organization_id).
- RLS policies enforce: current user’s org(s) only. Backend also checks organization_id on read/write. **Mandatory.**

---

## 5.7 Summary

- Core owns: organizations, users, roles, permissions, subscriptions, modules, organization_modules, audit_log, notifications, file_assets, clients, contacts, shared_notes, shared_activities.
- Modules own only their domain entities; they use shared entities by reference.
- Israel entities are owned by Israel Country Pack; not in global Core.

---

*See also: 01 (overview), 02 (core boundary), 04 (global vs Israel), 06 (dependencies).*
