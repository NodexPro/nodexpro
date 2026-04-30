# Legacy Platform-Wide Plans — Deprecation

**Document type:** Commerce transition / deprecation  
**Status:** Mandatory for implementation. No mixed entitlement logic.

---

## 1. Summary

- **Module entitlement** is resolved **only** from:
  - **System modules:** `modules.is_system = true` → always entitled.
  - **Commercial modules:** `organization_module_subscriptions` (active/trialing, `ends_at` not in past).
- **Legacy tables** `plans`, `plan_modules`, `subscriptions` are **deprecated for module entitlement**. They are **not** read by entitlement or activation logic. They remain in the database for backward compatibility and limited internal/legacy use only.

---

## 2. Legacy Tables: What They Are and Where Still Used

| Table | Purpose (legacy) | Still used? | For module entitlement? |
|-------|------------------|-------------|--------------------------|
| **plans** | Global platform plan (e.g. starter, pro) | Yes, only in org creation and legacy GET subscription | **No** |
| **plan_modules** | Which modules are included in a plan | Yes, only in org creation (starter → insert organization_modules) | **No** |
| **subscriptions** | Org-level subscription to a plan | Yes: org creation inserts one; GET `/organizations/:id/subscription` returns it | **No** |

**Conclusion:** Legacy tables are used only for:
1. **Org creation** — Optional “starter” plan: insert one row into `subscriptions` and insert `organization_modules` rows from `plan_modules`. This does **not** drive entitlement. Entitlement is resolved solely from `organization_module_subscriptions` and `modules.is_system`.
2. **Legacy API** — GET `/organizations/:id/subscription` returns the org’s latest row from `subscriptions`. This is for backward compatibility or display only. Billing and module access use module-based commerce (Modules screen, `organization_module_subscriptions`).

---

## 3. No Mixed Entitlement Logic

- **Entitlement resolver** (`entitlement.service.ts`): Reads only `modules.is_system` and `organization_module_subscriptions`. Does **not** read `plans`, `plan_modules`, or `subscriptions`.
- **Activation** (`activation.service.ts`): Requires active `organization_module_subscription` for commercial modules. Does **not** use `subscriptions` or `plan_modules`.
- **Module state** (`modules-state.service.ts`): Uses only `resolveEntitlement` and `organization_module_subscriptions` / `module_plans` for plans and current subscription. No use of legacy plans/subscriptions.
- **Module commerce** (`module-commerce.service.ts`): Uses only `module_plans`, `module_plan_limits`, `organization_module_subscriptions`.

Adding any logic that derives **module** entitlement from `plans`, `plan_modules`, or `subscriptions` is **prohibited**.

---

## 4. Implementation Notes (Code)

- **`entitlement.service.ts`:** Comment at top: per-module entitlement from `organization_module_subscriptions` only; legacy plans/subscriptions not used.
- **`subscriptions.service.ts`:** Legacy endpoint; returns `subscriptions` table only. Not used for module entitlement or module billing decisions.
- **`organizations.service.ts`:** Optional “starter” plan and `subscriptions`/`plan_modules` usage is legacy onboarding only. New module entitlement is never derived from this data.
- **Migrations:** 008 deprecation note in schema; no new code may use legacy tables for entitlement.

---

## 5. Architecture Doc References

- **Commerce model and entitlement:** [01-commerce-implementation-package.md](./01-commerce-implementation-package.md) (sections 1, 5, 15).
- **Phase 0 overview:** Subscription/entitlement wording in phase-0 docs refers to the conceptual model; **current implementation** follows module-based commerce and this deprecation.

---

## 6. Definition of “Deprecated”

- **Deprecated:** Tables and their data remain. Existing code may read/write them only for:
  - Backward compatibility (e.g. legacy GET subscription),
  - Internal/onboarding (e.g. org creation inserting starter subscription and organization_modules from plan_modules).
- **Not allowed:** Using `plans`, `plan_modules`, or `subscriptions` to decide whether an organization is **entitled** to a module or to drive activation. That is done only via `organization_module_subscriptions` and `modules.is_system`.
