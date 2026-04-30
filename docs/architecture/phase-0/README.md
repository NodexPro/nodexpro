# Phase 0: Architectural Design — Artifact Index

**Status:** Phase 0 Deliverables  
**Purpose:** Close Phase 0 with a complete architectural package. No implementation begins until these artifacts exist and are agreed.

---

## Artifact List

| # | Document | Purpose |
|---|----------|---------|
| 1 | [01-product-architecture-overview.md](./01-product-architecture-overview.md) | Product vision, architectural style, Core/Module/Country Pack definitions, domain map |
| 2 | [02-core-boundary-definition.md](./02-core-boundary-definition.md) | What is in/out of the product; Core vs modules vs external |
| 3 | [03-module-catalog.md](./03-module-catalog.md) | Catalog of global and Israel modules; dependencies; commercial status |
| 4 | [04-global-vs-israel-separation.md](./04-global-vs-israel-separation.md) | Global vs Israel logic; Country Pack boundaries |
| 5 | [05-shared-entities-map.md](./05-shared-entities-map.md) | Core-owned and shared entities; ownership rules |
| 6 | [06-module-dependency-matrix.md](./06-module-dependency-matrix.md) | Module-to-Core and module-to-module dependencies; prohibited dependencies |
| 7 | [07-security-baseline.md](./07-security-baseline.md) | Tenant isolation, RBAC, entitlement checks, audit, sensitive data |
| 8 | [08-commercial-access-model.md](./08-commercial-access-model.md) | Subscription, plan, entitlement, module activation, role permissions |
| 9 | [09-definition-of-done.md](./09-definition-of-done.md) | Definition of Done for phases and features |
| 10 | [10-architectural-constraints-prohibitions.md](./10-architectural-constraints-prohibitions.md) | Mandatory rules, prohibited decisions, deferred items |
| 11 | [11-module-dependencies-commercial-independence.md](./11-module-dependencies-commercial-independence.md) | Commercial modules sold independently; dependencies only for extensions/country packs; shared data via Core |

---

## Phase 0 Completion Criteria

Phase 0 is **done** when:

- [ ] All 10 artifacts exist and are versioned
- [ ] Product Architecture Overview is approved by product/tech lead
- [ ] Core Boundary and Module Catalog are agreed
- [ ] Security Baseline and Commercial Access Model are signed off
- [ ] Any architect or developer can answer the 18 verification questions (see Overview) without ambiguity

---

## Verification Questions (Must Be Answerable After Phase 0)

1. What is Core?  
2. What is a module?  
3. What is a Country Pack?  
4. Where are access rights stored?  
5. How do we know which modules are purchased?  
6. Where is the organization stored?  
7. How are different tenants' data isolated?  
8. Which entities belong only to Core?  
9. Which entities are module-specific?  
10. Which entities belong only to Israel Pack?  
11. How does a module get access to shared data?  
12. What happens when a module is disabled?  
13. What happens when a subscription expires?  
14. Where is the boundary between global and local logic?  
15. Where is security enforced: frontend, backend, DB policies?  
16. How are critical actions audited?  
17. Which data is considered sensitive?  
18. Which architectural decisions are prohibited?
