# 9. Definition of Done Framework

**Document type:** Phase 0 — Completion criteria for phases and features  
**Mandatory:** A phase or feature is not “done” until its DoD is satisfied.

---

## 9.1 Phase 0 (Architectural Design)

**Done when:**

- [ ] All 10 Phase 0 artifacts exist and are versioned.
- [ ] Product Architecture Overview is approved by product/tech lead.
- [ ] Core Boundary and Module Catalog are agreed.
- [ ] Security Baseline and Commercial Access Model are signed off.
- [ ] Any architect or developer can answer the 18 verification questions (see README and 01) without ambiguity.
- [ ] No mandatory section is marked “TBD” or left empty; deferred items are explicitly listed as **deferred**.

---

## 9.2 Phase 1 (and Subsequent Phases) — Generic DoD

For each development phase (e.g. Phase 1: Core + first module):

**Done when:**

- [ ] **Requirements:** Scope is defined; acceptance criteria are written; boundaries (Core vs module vs country) are respected.
- [ ] **Design:** Changes align with Phase 0 docs; no violation of architectural prohibitions; new entities have clear ownership (Core / module / Country Pack).
- [ ] **Implementation:**
  - All tenant data has organization_id; RLS and server-side checks are in place.
  - No business logic in frontend that should live in backend; frontend uses backend for permissions/entitlement/capabilities.
  - Module entitlement and permissions are checked on backend at entry points.
- [ ] **Security:** Sensitive operations are audited as per Security Baseline; file access is controlled; no public dump.
- [ ] **Documentation:** Any new module or entity is reflected in the Module Catalog / Shared Entities Map (or equivalent) as agreed.
- [ ] **Definition of Done** for the phase (if phase-specific criteria exist) is met.

---

## 9.3 Feature-Level DoD (Example)

For a single feature (e.g. “Org admin can enable module X”):

- [ ] Backend implements entitlement/activation logic; frontend only calls API and displays result.
- [ ] Access is checked server-side; UI reflects backend state.
- [ ] Audit log records the action if it is in the critical list (e.g. entitlement change).
- [ ] No duplication of Core entities; no Israel logic in global Core without extension model.

---

## 9.4 Summary

- **Phase 0:** Artifacts complete, approved, and verification questions answerable.
- **Later phases:** Align with Phase 0; tenant isolation, backend authority, no prohibitions violated; phase-specific DoD met.

---

*See also: README (Phase 0 completion criteria), 01 (overview), 10 (prohibitions).*
