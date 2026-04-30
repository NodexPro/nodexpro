# 7. Security Baseline

**Document type:** Phase 0 — Security and compliance baseline  
**Mandatory:** All implementation must meet this baseline.

---

## 7.1 Tenant Isolation

- **Rule:** All tenant-bound data must be scoped by **organization_id**. **Mandatory.**
- **Implementation:** Every such table has `organization_id`. RLS policies restrict rows to the current user’s organization(s). Backend validates `organization_id` on every read/write for sensitive operations (defense in depth).
- **Prohibition:** No tenant data accessible without organization scope. No “global” queries that bypass org. **Prohibited.**

---

## 7.2 RBAC (Roles and Permissions)

- **Owner:** Core. Roles and permissions are stored in Core (public schema).
- **Enforcement:** Server-side on every API that performs an action. RLS can enforce row-level visibility; permission checks (e.g. “can_edit_invoice”) are enforced in backend and optionally in DB (e.g. policies that check role).
- **Frontend:** May receive a list of permissions/capabilities from backend for UX (show/hide). Frontend is not the authority; backend must re-check on every request. **Mandatory.**

---

## 7.3 Module Entitlement Checks

- **Rule:** Access to module features is gated by **entitlement** (subscription + plan + organization_modules). Check is performed on the **backend** at module entry points (e.g. “can this org use payroll_il?”). **Mandatory.**
- **Storage:** Entitlement state in Core: subscriptions, plans, organization_modules.
- **Prohibition:** Relying only on UI to hide module features. **Prohibited.**

---

## 7.4 Sensitive Data Policy

**Sensitive data** (must be protected and access logged where required):

- PII: names, emails, phone numbers, addresses (when linked to identity).
- Auth-related: passwords (handled by Supabase Auth), tokens, session data.
- Financial: payment details, bank account references, invoice amounts, payroll results.
- Compliance-related: tax identifiers, national IDs, statutory submission data.

**Policy:** Access to sensitive data is allowed only for authorized roles and only within the tenant. Audit log should record access to sensitive data where required by policy. Exact retention and logging scope to be defined in implementation phase; baseline is “we will define and enforce.” **Mandatory.**

---

## 7.5 File Access Model

- **Storage:** Supabase Storage. Buckets are not public by default.
- **Metadata:** In Core (file_assets); organization_id, owner, document type, lifecycle.
- **Access control:** Storage policies + application layer: user must be in same org and have permission to access the resource. No “open to all” bucket for business documents. **Mandatory.**
- **Prohibition:** Using file storage as a public dump without controlled access. **Prohibited.**

---

## 7.6 Audit Policy

- **Owner:** Core. Table: audit_log (or equivalent).
- **What to log (minimum):** Authentication events (login/fail), entitlement changes, subscription changes, access to sensitive data (if policy requires), critical admin actions.
- **Immutable:** Append-only; no updates/deletes by application. **Mandatory.**
- **Retention:** To be defined (e.g. 1 year, 7 years for compliance); baseline is “defined and documented.” **Deferred** to implementation phase for exact SLA.

---

## 7.7 Backup Baseline

- **Requirement:** Backups of database and critical configuration; recovery procedure documented. Exact RPO/RTO to be defined. **Deferred** to implementation phase.
- **Tenant data:** Backup and restore must preserve organization_id and RLS; no cross-tenant leakage. **Mandatory.**

---

## 7.8 Summary

| Area | Rule |
|------|------|
| Tenant isolation | organization_id on all tenant data; RLS + server checks. **Mandatory.** |
| RBAC | Core-owned; enforced server-side. **Mandatory.** |
| Module entitlement | Checked on backend at module entry. **Mandatory.** |
| Sensitive data | Defined; access controlled and logged as per policy. **Mandatory.** |
| Files | Storage + metadata; access controlled. **Mandatory.** |
| Audit | Append-only log; critical actions logged. **Mandatory.** |
| Backup | Defined and tenant-safe. **Mandatory**; exact SLA **deferred.** |

---

*See also: 01 (overview), 08 (commercial access), 10 (prohibitions).*
