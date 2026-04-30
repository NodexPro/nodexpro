# 6. Module Dependency Matrix

**Document type:** Phase 0 — Dependencies between Core and modules  
**Mandatory:** Dependencies must be explicit; prohibited dependencies must not exist.

---

## 6.1 Dependency Rules

1. **Every module depends on Core.** No module can exist without Core. **Mandatory.**
2. **Modules may depend on other modules** only if the dependency is declared in this matrix and in the Module Catalog.
3. **Circular dependencies between modules are prohibited.** **Prohibited.**
4. **Core does not depend on any module.** Core does not import module-specific types or call module-specific APIs for business logic. Core may provide extension points that modules implement. **Mandatory.**
5. **Israel-only modules depend on Core + Israel Country Pack.** They may also depend on global modules if declared. **Mandatory.**

---

## 6.2 Matrix (Logical)

Rows = dependents; columns = dependencies. “✓” = allowed (extension/country-pack only); “—” = not applicable; “✗” = prohibited.

**Commercial independence:** Business modules (clients, invoice, accounting, payroll, documents, billing, workflow) do **not** depend on each other for shared data. Shared data (e.g. clients, contacts) is in Core/shared layer; modules use it via approved service interfaces. See **11-module-dependencies-commercial-independence.md**.

|             | Core | Israel Pack | clients | documents | billing | workflow | payroll_core | payroll_il |
|-------------|------|-------------|---------|-----------|---------|----------|--------------|------------|
| **Core**    | —    | ✗           | ✗       | ✗         | ✗       | ✗        | ✗            | ✗          |
| **Israel Pack** | ✓* | —           | —       | —         | —       | —        | —            | —          |
| **clients** | ✓    | —           | —       | —         | —       | —        | —            | —          |
| **documents** | ✓  | —           | —       | —         | —       | —        | —            | —          |
| **billing** | ✓    | —           | —       | —         | —       | —        | —            | —          |
| **workflow**| ✓    | —           | —       | —         | —       | —        | —            | —          |
| **payroll_core** | ✓ | —         | —       | —         | —       | —        | —            | —          |
| **payroll_il** | ✓ | ✓           | —       | —         | —       | —        | ✓            | —          |

*Israel Pack extends Core via extension points; it does not depend on any sellable business module.

**Extension-only dependencies:** Only **extension → parent** (e.g. `payroll_il` → base Payroll module, Israel VAT Extension → Accounting) and **country pack → parent** are allowed in `module_dependencies`. No business-module-to-business-module rows for shared data (e.g. Payroll→Accounting, Accounting→Clients). Use Core/shared entities instead. *In the table, payroll_core denotes the base Payroll product (e.g. code `payroll`).*

---

## 6.3 What “Depends On” Means (Extension Dependencies Only)

- **Technical/extension:** The dependent module is an add-on that cannot run without the parent (e.g. payroll_il cannot run without payroll_core). This is the **only** use of `module_dependencies` between sellable modules.
- **Shared data:** Modules that need client/company/contact data use **Core/shared entities** and approved service interfaces. They do **not** declare a module dependency on another business module for that. So “billing references clients” is implemented via shared Core entities, not via billing → clients in the dependency table.
- **Runtime:** If module A truly depends on module B (extension only), disabling B for an org disables or degrades A for that org.

---

## 6.4 Prohibited Dependencies

- **Core depending on any module** for Core behavior. **Prohibited.**
- **Circular dependency** between any two modules. **Prohibited.**
- **Undeclared dependency:** A module using another module’s data or API without declaring it in this matrix. **Prohibited.**
- **Global module depending on Israel Pack or Israel-only module.** Global modules must not depend on country-specific packs. **Prohibited.**

---

## 6.5 How Modules Get Access to Shared Data

- **Core entities (organizations, users, clients, contacts, etc.):** Module receives them via Core APIs or by reading from Core tables with RLS (user already scoped to org). Module stores only references (e.g. `client_id`), not copies of the entity.
- **Other modules’ data:** Only if a dependency is declared. Access via that module’s API or shared DB with clear ownership (e.g. document module owns document; payroll_il references document id).

**Mandatory:** No module duplicates Core-owned entities. **Prohibited.**

---

## 6.6 Summary

- Core is the root; no module can skip Core.
- Dependencies are one-way and acyclic; no circles.
- Israel Pack extends Core; Israel modules depend on Core + Israel Pack.
- All dependencies are explicit in this matrix and in the Module Catalog.

---

*See also: 01 (overview), 03 (module catalog), 05 (shared entities).*
