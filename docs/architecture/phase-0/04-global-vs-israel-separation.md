# 4. Global vs Israel Separation Map

**Document type:** Phase 0 — Separation of global and local logic  
**Mandatory:** Israel-specific logic must not be mixed into global Core without explicit boundaries.

---

## 4.1 Principle

- **Global:** Usable in any country; no country-specific fields or rules in Core shared entities.
- **Israel:** All Israel-specific data and rules live in Israel Country Pack or Israel-only modules; they extend Core/modules through defined extension points.

---

## 4.2 Where Global Logic Lives

- **Core:** Identity, access, organizations, subscriptions, shared entities (clients, contacts, notes, activities, file metadata), audit, notifications. No country code or Israel-only columns in Core tables (except optional `country_code` for future multi-country if designed as extension).
- **Global modules:** Functionality that is country-agnostic (e.g. documents, workflow, generic billing). No Israel tax, payroll, or statutory logic.

---

## 4.3 Where Israel Logic Lives

- **Israel Country Pack:**
  - Tax profiles (Israel)
  - VAT configuration (Israel)
  - Reporting cycles (Israel)
  - National insurance rules
  - Statutory obligations (Israel)
  - Local filing entities
  - Extension points that global modules or Core can call (e.g. “get local payroll rules for org/country”).
- **Israel-only modules:** e.g. payroll_il, tax_il, statutory_il. They depend on Core + Israel Country Pack and read/write Israel-specific entities only through the Pack or their own module tables.

---

## 4.4 Extension Model (Mandatory)

- **Prohibited:** Adding Israel-only columns (e.g. “Israeli ID”, “VAT number Israel”) directly into global Core tables such as `organizations` or `clients` without an extension model. **Prohibited.**
- **Allowed:**
  - Separate Israel extension tables (e.g. `organization_ext_il`, `client_tax_profile_il`) keyed by `organization_id` / `client_id` and optionally `country_code = 'IL'`.
  - Israel-specific schema or namespace (e.g. `il` or `country_il`) containing only Israel entities.
  - Country Pack providing services/APIs that modules call with `country_code` or org context.

---

## 4.5 Boundary Diagram (Logical)

```
[ Core (global) ]  ←  [ Global modules ]
        ↑
        │ extension points
        ↓
[ Israel Country Pack ]  ←  [ Israel-only modules ]
```

- Core and global modules do not import Israel-specific types or rules directly.
- Israel Pack and Israel modules depend on Core (and optionally global modules) and implement/extend via extension points.

---

## 4.6 Data Ownership (Israel)

| Data | Owner | Location |
|------|--------|----------|
| Tax profiles (Israel) | Israel Country Pack | Extension / il schema |
| VAT configuration (Israel) | Israel Country Pack | Extension / il schema |
| Reporting cycles | Israel Country Pack | Extension / il schema |
| Payroll local rules (Israel) | Israel Country Pack | Extension / il schema |
| National insurance rules | Israel Country Pack | Extension / il schema |
| Statutory obligations | Israel Country Pack | Extension / il schema |
| Local filing entities | Israel Country Pack | Extension / il schema |

None of the above are stored in global Core tables as first-class columns. **Mandatory.**

---

## 4.7 Summary

- Global = Core + global modules; no Israel-specific fields or logic.
- Israel = Country Pack + Israel-only modules; extension model only; no mixing into global Core. **Mandatory.**

---

*See also: 01 (overview), 02 (core boundary), 03 (module catalog), 05 (shared entities).*
