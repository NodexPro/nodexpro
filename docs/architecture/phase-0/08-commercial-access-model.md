# 8. Commercial Access Model

**Document type:** Phase 0 — Subscription, entitlement, and access control  
**Mandatory:** Module access and feature gating must follow this model.

---

## 8.1 Concepts (Strict Separation)

| Concept | Definition | Owner | Stored where |
|--------|------------|--------|---------------|
| **Subscription** | Contract linking an organization to a plan and validity period (start/end). | Core | subscriptions |
| **Plan** | Tier (e.g. Basic, Pro) defining which modules and limits are available. | Core | plans, plan_modules |
| **Entitlement** | Derived fact: “this org is allowed to use module X” (subscription active + plan includes module). | Core (computed) | Derived from subscriptions + plans + organization_modules |
| **Module activation** | Persisted state: which modules are enabled for the org (may be set by admin or by purchase). | Core | organization_modules |
| **Role** | Set of permissions within an org (e.g. Admin, Accountant). | Core | roles, role_permissions |
| **Permission** | Granular right (e.g. clients:read, payroll:run). | Core | permissions |

**Rule:** Subscription/plan/entitlement are **commercial**. Role/permission are **access control**. Both are needed for module features: user must have (1) entitlement to the module and (2) permission to perform the action. **Mandatory.**

---

## 8.2 How Modules Are Sold and Enabled

- **Sale:** Customer subscribes to a plan (or adds a module). Backend or billing integration updates `subscriptions` and/or `organization_modules`.
- **Activation:** `organization_modules` records which modules are on for the org. If subscription expires, entitlement is revoked (backend denies access); `organization_modules` may be updated or left for history.
- **Check:** On every module entry point (API), backend checks: (1) org has entitlement to this module (subscription valid + plan includes module + organization_modules allows), (2) user has required permission. **Mandatory.**

---

## 8.3 How Modules Are Disabled

- **Admin disables module:** Update `organization_modules` (e.g. set active = false). Backend immediately denies access to that module for that org.
- **Subscription expires:** Entitlement engine returns “no access”; backend denies. Data may be retained per retention policy; no delete required by this model.

---

## 8.4 How Plan Affects Functionality

- **Plan** defines: list of modules included, optional limits (e.g. max users, max documents). Backend enforces limits; entitlement for modules is derived from plan + subscription.
- **Frontend** may show/hide features based on data from backend (e.g. “enabled_modules”, “limits”); backend remains authority. **Mandatory.**

---

## 8.5 Entitlement vs Role

- **Entitlement:** “Can this org use payroll_il?” (commercial).
- **Role/Permission:** “Can this user run payroll_il:run?” (access control).
- A user with permission but without org entitlement must be denied. A user with entitlement but without permission must be denied. Both checks on backend. **Mandatory.**

---

## 8.6 Summary

- Subscription → plan → entitlement (module allowed for org).
- organization_modules stores activation state; used together with subscription/plan for entitlement.
- Role/permission define what a user can do; checked together with entitlement.
- All checks are server-side. Frontend only reflects backend state for UX.

---

*See also: 01 (overview), 07 (security baseline), 10 (prohibitions).*
