# 11. Module Dependencies — Commercial Independence

**Document type:** Phase 0 — Architecture clarification  
**Mandatory:** Commercial modules must be purchasable independently. Module dependencies are only for technical/extension relationships, not for shared data.

---

## 11.1 Product Model

- **Commercial modules are sold separately.** A customer may buy only Payroll, only Accounting, only Client Management, or any combination.
- **Shared platform data** (e.g. clients, companies, contacts) lives in **Core or a shared layer**. Business modules **do not** depend on each other just because they use the same data.
- **Access to shared data** is via **approved Core/shared service interfaces**. Modules read/use shared entities through these interfaces; they do not declare a module dependency for that.

---

## 11.2 What Module Dependencies Are For

Use the `module_dependencies` table **only** for:

- **Extension → Core module** (same product line)  
  - Example: **Israel Payroll Extension** → **Payroll Core** (adds Israeli rules; cannot run without Payroll).
- **Country pack → parent module**  
  - Example: **Israel VAT Extension** → **Accounting Core** (adds local VAT; cannot run without Accounting).
- **True technical/plugin dependency**  
  - A module that is literally an add-on or plugin to another module and has no standalone value.

**Not** for:

- Payroll depending on Accounting because both use client/company data.
- Accounting depending on Client Management because client records exist.
- Invoice depending on Client Management for customer references.

Those use cases are solved by **shared Core/shared entities** and **service interfaces**, not by module_dependencies.

---

## 11.3 What Is Not Allowed (Default Business Design)

The following are **not** allowed as the default design:

| Prohibited dependency | Correct approach |
|------------------------|------------------|
| Payroll → Accounting (for shared data) | Shared entities in Core; both modules reference via Core APIs. |
| Accounting → Client Management | Clients/contacts in Core or shared layer; Accounting uses shared entity APIs. |
| Invoice → Client Management | Same: shared clients/contacts; Invoice references them via Core/shared. |
| Any business-module → business-module for “it uses the same clients” | Shared platform entities + approved service interfaces. |

If a module needs “client” or “company” data, the design is: **Core (or shared layer) owns the entity; module gets it via a shared service/API.** No row in `module_dependencies` between the two business modules.

---

## 11.4 Allowed Examples

| Dependency | Allowed? | Reason |
|------------|----------|--------|
| Israel Payroll Extension → Payroll Core | ✓ | Extension of a product; not sellable without parent. |
| Israel VAT Extension → Accounting Core | ✓ | Country pack extending a core module. |
| Country pack → parent module | ✓ | Technical/extension dependency. |
| Payroll → Accounting | ✗ | Use shared entities; sell independently. |
| Accounting → Client Management | ✗ | Use Core/shared clients. |
| Invoice → Client Management | ✗ | Use Core/shared clients. |

---

## 11.5 Implementation Implications

- **Database:** Do **not** insert rows into `module_dependencies` that express business-module-to-business-module relationships for shared data. The table may be empty for all commercial business modules; it is used for extension/country-pack dependencies only.
- **Activation:** A customer can activate **only** Payroll, **only** Accounting, **only** Clients, or any combination, with no activation-order requirement between these.
- **Shared entities:** Core (or shared layer) defines and owns entities such as clients, contacts, companies (if shared). Modules that need them call shared services or read through approved interfaces; no module dependency is required.

---

## 11.6 Summary

- **Commercial independence:** Every business module is sellable and activatable on its own.
- **Shared data:** Via Core/shared entities and service interfaces; no business-module-to-business-module dependency for that.
- **module_dependencies:** Only for extension→core and country pack→parent (or equivalent technical/extension dependencies).

---

*See also: 03 (module catalog), 05 (shared entities), 06 (dependency matrix).*
