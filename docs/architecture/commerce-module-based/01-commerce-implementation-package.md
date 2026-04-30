# Module-Based Commerce — Implementation Package

**Document type:** Commerce model change  
**Depends on:** Phase 1, Phase 2 (Module Framework). Frontend dumb; backend authoritative.

---

## 1. FINAL COMMERCE ARCHITECTURE SUMMARY

- **Source of entitlement:** Per-module. System modules are always entitled and always active. Commercial modules are entitled only if the organization has an active `organization_module_subscription` for that module.
- **Pricing:** Stored in `module_plans` (per-module tiers) and `module_plan_limits` (limits per tier). No global platform plan.
- **Purchase flow:** User selects a module plan → backend creates or updates `organization_module_subscriptions` (mock: status active; real: pending → confirmed by payment provider later). Activation is allowed only when subscription status allows use.
- **Legacy:** `plans`, `plan_modules`, `subscriptions` are **deprecated** for module entitlement. Kept in DB; not used by new entitlement or activation logic. No data migration from old to new model. See **[02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md)** for where legacy tables are still used and the rule that entitlement must never be mixed.
- **Core module:** Single module with `scope_type = 'system'` (or equivalent). Always visible, gray, non-clickable, no Activate/Deactivate/Buy. Label "System module". Cannot be deactivated.

---

## 1b. Legacy platform-wide plans (deprecated)

| Item | Status |
|------|--------|
| **plans** | Deprecated for entitlement. Table kept. Still used only in org creation (optional starter) and legacy GET subscription. |
| **plan_modules** | Deprecated for entitlement. Table kept. Still used only in org creation to insert initial organization_modules. |
| **subscriptions** | Deprecated for entitlement. Table kept. Still used: org creation (insert one); GET `/organizations/:id/subscription` (legacy/display). |
| **Module entitlement source** | **Only** `modules.is_system` and `organization_module_subscriptions`. No mixed logic with plans/subscriptions. |

**Rule:** New code must not derive module entitlement or activation eligibility from `plans`, `plan_modules`, or `subscriptions`. See [02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md).

---

## 2. REQUIRED SCHEMA CHANGES / MIGRATIONS

**008_module_commerce_schema.sql**

- **module_plans:** id, module_id, code, name, billing_period (month/year), currency, price_amount (numeric), is_active, sort_order, created_at, updated_at.
- **module_plan_limits:** id, module_plan_id, limit_code, limit_value (numeric), is_unlimited (boolean), created_at.
- **organization_module_subscriptions:** id, organization_id, module_id, module_plan_id, status (active, trialing, past_due, cancelled, ended, pending_payment), started_at, ends_at, trial_ends_at, cancelled_at, billing_state, created_at, updated_at. Unique (organization_id, module_id) — one subscription per org per module.
- **modules:** Add `is_system` boolean not null default false. System module = is_system true; always entitled; never sellable; never deactivatable.
- **organization_modules:** Add optional `organization_module_subscription_id` FK (for audit trail). Keep existing source_subscription_id for legacy; new logic uses organization_module_subscriptions.

**009_module_commerce_seed.sql**

- Set Core (and dashboard, settings, users_roles, billing if they are part of "core" shell) to is_system = true, is_sellable = false.
- Insert commercial modules: clients (Client Management), invoice (Invoice/Hashboniot), accounting (Accounting), payroll (Payroll), reminder (Global Reminder) with codes and is_sellable = true.
- Insert module_plans and module_plan_limits for each commercial module per spec (ILS/USD, tiers, limits).

**Decision on plans / plan_modules / subscriptions:** **Deprecated for module entitlement.** Do not delete tables. New entitlement and activation code do not read them. Existing rows remain; new flows use only organization_module_subscriptions. Legacy use: org creation (starter plan) and GET subscription endpoint only. See [02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md).

---

## 3. MODULE COMMERCE DATA MODEL

- **module_plans:** One row per tier (e.g. "Up to 100 clients", "Unlimited"). Identified by module_id + code. currency + price_amount; billing_period month.
- **module_plan_limits:** limit_code (max_clients, max_companies, max_employees_per_company, etc.), limit_value or is_unlimited.
- **organization_module_subscriptions:** One row per org per module. Links to module_plan_id. status drives entitlement (active, trialing → entitled; cancelled, ended, null → not entitled).
- **organization_modules:** Activation state. For system module: always active, no row or row with status active and is_system module. For commercial: active only if organization_module_subscription exists and is active/trialing and (optional) organization_modules.status = active.

---

## 4. SYSTEM MODULE PROTECTION MODEL

- **Identification:** modules.is_system = true (or scope_type = 'system').
- **Entitlement:** Always entitled. Resolver returns entitled for system modules without DB lookup.
- **Activation:** Always active. If no row in organization_modules for system module, treat as active for nav and access. Optionally auto-insert organization_modules for system module when org is created (Phase 1 may already add core modules via plan; new orgs get system modules auto-active without subscription).
- **Deactivate:** Backend rejects deactivate for any module where is_system = true. Audit: system_module_protected.
- **UI:** Backend returns isSystem: true; frontend renders gray, disabled, "System module", no action buttons.

---

## 5. ENTITLEMENT MODEL

- **System module:** Return entitled; activation treated as active.
- **Commercial module:** Load organization_module_subscriptions for (organization_id, module_id). If no row or status not in (active, trialing) or ends_at in past → not_entitled. If trialing and trial_ends_at in future → trial. Else → entitled.
- **Legacy plans/subscriptions:** Not used for entitlement. Single source of truth for commercial entitlement is organization_module_subscriptions. See [02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md).

---

## 6. MODULE PRICING MODEL

- **Resolver:** GET module_plans by module_id (join module_plan_limits). Return plans with limits for display. No pricing logic on frontend.
- **Currency and amount:** Stored in module_plans (currency, price_amount). Display from backend only.

---

## 7. MODULE SUBSCRIPTION MODEL

- **Create (Select plan / Buy):** POST with moduleId, module_plan_id. Backend creates organization_module_subscription (status active for mock; or pending_payment for real). Audit: module_plan_selected, module_subscription_created.
- **Change plan:** POST with new module_plan_id. Update organization_module_subscriptions.module_plan_id; keep same row. Audit: module_subscription_changed.
- **Activate:** Requires active organization_module_subscription. Then set organization_modules.status = active, link subscription id. Audit: module_activated.
- **Deactivate:** For commercial only. Set organization_modules.status = deactivated. Do not delete organization_module_subscription (subscription may still be paid). Audit: module_deactivated.

---

## 8. BACKEND API CONTRACTS

- **GET /modules/:moduleId/plans** — List module_plans + limits for module. Auth. (moduleId = uuid.)
- **GET /organizations/:id/modules/state** — Extended: isSystem, availablePlans[], currentModuleSubscription (plan, status, ends_at), canSelectPlan, canActivate, canDeactivate, canChangePlan, blockReason.
- **POST /organizations/:id/modules/:moduleId/select-plan** — Body: { modulePlanId }. Creates or updates organization_module_subscription (mock: status active). Permission: modules:write. Audit: module_plan_selected, module_subscription_created.
- **POST /organizations/:id/modules/:moduleId/activate** — Same as today; entitlement from org_module_subscription. Audit: module_activated.
- **POST /organizations/:id/modules/:moduleId/deactivate** — Reject if is_system. Else deactivate. Audit: module_deactivated.
- **POST /organizations/:id/modules/:moduleId/change-plan** — Body: { modulePlanId }. Update organization_module_subscriptions.module_plan_id. Audit: module_subscription_changed.

All under /api/v1 (modules routes or organizations routes as currently mounted).

---

## 9. FRONTEND UI SPEC

- **Modules screen:** One section per module. For each module row:
  - **System module:** Name, code, version, label "System module". Gray background, disabled. No buttons.
  - **Commercial module:** Name, code, version, description, available plans (name, price, currency, limits from backend), current subscription (plan name, status, ends_at if any), buttons from backend: Select plan | Buy | Activate | Deactivate | Change plan. Disabled states and blockReason from backend.
- **Billing screen:** Summary of all organization_module_subscriptions (module name, plan, price, status). Link "Manage modules" to Modules. No pricing logic in UI; all from API.

---

## 10. BILLING / MODULES UX DECISION

- **Primary:** **Modules screen** — full module commerce: list modules, show plans/prices/limits, current subscription, Select plan, Activate, Deactivate, Change plan. Single place for per-module decisions.
- **Billing screen:** **Summary only** — list of current module subscriptions (read-only), total or per-module, link to Modules for changes. Rationale: one source of truth (Modules); Billing is overview and future invoice/payment history.

---

## 11. AUDIT EVENT CATALOG

- module_plan_selected
- module_subscription_created
- module_subscription_changed
- module_purchase_started (mock or real)
- module_purchase_confirmed (mock or real)
- module_activated
- module_deactivated
- module_activation_blocked
- system_module_protected

---

## 12. DEFERRED DECISIONS

- Real payment provider integration (contract only; mock confirmation).
- Invoice generation and PDF (out of scope).
- Proration on change plan (out of scope).
- Trial period logic for module subscriptions (trial_ends_at present; automatic downgrade deferred).

---

## 13. DEFINITION OF DONE

- [ ] Migration 008 and 009 applied; Core and commercial modules seeded; module_plans and limits seeded.
- [ ] Entitlement uses only is_system and organization_module_subscriptions.
- [ ] Activation requires active module subscription for commercial; system always active; deactivate blocked for system.
- [ ] APIs: get plans, select-plan, change-plan, activate, deactivate implemented and audited.
- [ ] Modules screen shows system vs commercial, plans/prices/limits from API, action buttons from backend state; Core gray and disabled.
- [ ] Billing screen shows summary of module subscriptions and link to Modules.

---

## 14. QA CHECKLIST

1. Core module visible, gray, no buttons, label "System module".
2. Commercial module: no subscription → can Select plan; after select-plan → can Activate.
3. Activate without subscription → blocked with reason.
4. Deactivate system module → 403 or 400, audit system_module_protected.
5. Change plan updates organization_module_subscriptions and audit.
6. Billing shows list of module subscriptions.
7. Limits and prices displayed from backend only.

---

## 15. ARCHITECTURAL PROHIBITIONS

- Do not treat Core as sellable or deactivatable.
- Do not store module pricing or entitlement logic only on frontend.
- Do not use global platform plan or legacy plans/subscriptions as source of module entitlement. No mixed entitlement logic (see [02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md)).
- Do not mix activation and purchase (subscription first, then activate).
- Do not make system module clickable or actionable like commercial.

---

## 16. EXACT DELIVERABLES

- Doc: this file; [02-legacy-plans-deprecation.md](./02-legacy-plans-deprecation.md); DELIVERABLES.md.
- DB: 008_module_commerce_schema.sql, 009_module_commerce_seed.sql.
- Backend: entitlement.service (per-module + system); activation.service (block deactivate system, require module subscription); module-commerce.service (plans, select-plan, change-plan); routes; audit events.
- Frontend: ModuleStateItem extended (isSystem, availablePlans, currentSubscription, canSelectPlan, canChangePlan); Modules page UI (system gray, commercial with plans and buttons); Billing summary.
- Payment: mock select-plan creates active subscription; no real provider.
