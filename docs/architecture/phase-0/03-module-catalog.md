# 3. Module Catalog

**Document type:** Phase 0 — Catalog of modules  
**Mandatory:** New modules must conform to this catalog structure and dependency rules.

---

## 3.1 Catalog Structure

Each module is described by:

- **Id / key:** Unique identifier (e.g. `core`, `clients`, `payroll`, `billing`, `documents`, `workflow`, `payroll_il`).
- **Scope:** Global (sell anywhere) or Israel-only.
- **Dependencies:** Core (mandatory) + optional list of other modules.
- **Commercial status:** Paid / included in plan / trial.
- **Owner of data:** Module owns only its domain data; shared entities stay in Core.

---

## 3.2 Core (Not a “Module” in the Catalog)

Core is the platform foundation. It is always present and is not sold as a separate module. All modules depend on Core.

---

## 3.3 Global Modules (Examples)

| Module key | Description | Depends on | Commercial |
|------------|-------------|------------|------------|
| clients | Client/contact management (or part of Core shared entities; if separate module, extends Core) | Core | Per plan |
| documents | Document lifecycle, templates, storage metadata | Core | Per plan |
| billing | Invoicing, plans, usage (if not fully in Core) | Core, optionally clients | Per plan |
| workflow | Generic workflows, approvals | Core | Per plan |

*Exact list to be finalized in product backlog; structure and dependency rules are fixed.*

**Rule:** Global modules may be sold in any market. They must not contain Israel-specific logic; Israel logic goes to Israel Pack or Israel-only modules. **Mandatory.**

---

## 3.4 Israel-Only Modules (Examples)

| Module key | Description | Depends on | Commercial |
|------------|-------------|------------|------------|
| payroll_il | Israeli payroll calculation, reporting | Core, Israel Country Pack | Per plan (Israel) |
| tax_il | Israeli tax profiles, VAT, reporting cycles | Core, Israel Country Pack | Per plan (Israel) |
| statutory_il | Israeli statutory filing, local obligations | Core, Israel Country Pack, optionally payroll_il | Per plan (Israel) |

*Exact list to be finalized in product backlog.*

**Rule:** Israel-only modules depend on Core and on Israel Country Pack. They do not belong in global Core. **Mandatory.**

---

## 3.5 Mandatory Dependencies

- Every module **must** depend on Core. **Mandatory.**
- No module may depend on a module that is not declared in this catalog (no “hidden” dependencies). **Mandatory.**

---

## 3.6 Dependencies: Extension Only; Shared Data via Core

- **Commercial modules are sold independently.** Do not add module_dependencies between business modules (e.g. Payroll→Accounting, Accounting→Clients, Invoice→Clients) for shared data. See **11-module-dependencies-commercial-independence.md**.
- **Shared data** (clients, contacts, companies): owned by Core or shared layer; modules use it via approved service interfaces. No module dependency is declared for that.
- **Allowed dependencies:** Extension → parent (e.g. Israel Payroll Extension → Payroll Core), country pack → parent. These are declared in the Module Dependency Matrix (document 06). **Mandatory.**

---

## 3.7 Commercial Status

- **Paid:** Module is sold separately or as part of a plan; entitlement is checked from `organization_modules` / subscription.
- **Included:** Module is included in a plan; still subject to entitlement check.
- **Trial:** Time-limited access; same entitlement model; expiration enforced on backend.

Entitlement is always checked on the backend when accessing module features. **Mandatory.**

---

## 3.8 Summary

- Core is the foundation; not a sellable module.
- Global modules: sellable globally; depend on Core; no Israel logic.
- Israel modules: depend on Core + Israel Country Pack; Israel-only.
- Dependencies are explicit and documented in the dependency matrix (document 06).

---

*See also: 01 (overview), 06 (dependency matrix), 08 (commercial access).*
