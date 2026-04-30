# Accounting Base Links Model (Phase 6 - Step 7)

Status: Conceptual links-model definition only.  
No API handlers/endpoints, migrations, DB changes, UI, or module integration in this step.

References:
- `docs/accounting-base-boundary.md`
- `docs/accounting-base-domain-model.md`
- `docs/accounting-base-schema-design.md`
- `docs/accounting-base-command-catalog.md`
- `docs/accounting-base-aggregates.md`

Architecture constraints:
- Core -> Commands -> Aggregate -> UI
- Document != Accounting Entry
- Links are metadata relations, not financial truth

---

## 1) Purpose of links

Accounting links exist to provide explicit relation context between accounting entries and external entities.

Primary purposes:
1. Evidence relation:
   - attach supporting artifacts (for example documents) to an entry.
2. Source traceability:
   - identify where an entry originated from (module/system source entity).
3. Client association:
   - connect entry to client context when relevant.
4. Module source relation:
   - represent relation to future module entities (fee/payment/payroll item etc.).
5. Audit/debug/history context:
   - preserve explainability for why/how entry exists or changed.

Non-purpose:
- links are not financial amount source of truth.

---

## 2) Link entity

Conceptual entity: `accounting_entry_link`

Conceptual fields:
- `id`
- `organization_id`
- `accounting_entry_id`
- `target_entity_type`
- `target_entity_id`
- `relation_type`
- `created_by`
- `created_at`

Field meaning:
- `target_entity_type`: typed target namespace (client/document/module entity class).
- `target_entity_id`: identifier within target namespace.
- `relation_type`: semantic role of relation (evidence/client/source/etc.).

---

## 3) Supported target entity types

Initial/future allowed target types:
- `client`
- `document`
- `fee` (future)
- `payment` (future)
- `payroll_item` (future)
- `module_entity` (future generic envelope, requires stricter typed subtype policy)

Design rule:
- Allowed target types must be centrally controlled (enum/registry policy).
- Free-form arbitrary target types are forbidden.

---

## 4) Relation types

Required relation types:
- `evidence`
- `client`
- `source`

Optional/future relation types:
- `adjustment_reason`
- `reconciliation`

Design rule:
- `relation_type` semantics must be explicit and validated server-side.
- Relation type does not change financial amount truth.

---

## 5) Cardinality rules

Explicit cardinality:
1. Entry may have zero documents.
2. Entry may have one document.
3. Entry may have many documents.
4. Document may have zero linked entries.
5. Document may link to many entries (future policy allowed; controlled by business policy).
6. Entry may have one primary client relation.
7. Entry may have optional source relation to module entity.

Policy notes:
- If one-primary-client rule is enforced, it must be validated by command boundary.
- Multi-evidence documents are allowed by default unless constrained by policy.

---

## 6) Tenant safety

Mandatory tenant rules:
1. `link.organization_id == entry.organization_id`.
2. Target entity must belong to same organization, unless target type explicitly defined as global/system allowed.
3. Cross-tenant links are forbidden.
4. Missing target entity is forbidden.
5. Target existence and tenant ownership must be validated in backend command/service boundary.

Integrity expectations:
- No blind insert of links without target validation.
- No deferred trust in frontend-provided target IDs.

---

## 7) Commands impact

Conceptual commands:
- `link_entry_to_entity`
- `unlink_entry_from_entity`

## 7.1 `link_entry_to_entity`

Permissions:
- accounting entry/link management permission.

Validation:
- entry exists and belongs to org
- target type allowed
- target entity exists
- tenant compatibility
- relation_type allowed
- uniqueness/idempotency rule for duplicate links

Audit event:
- `entry_linked`

Aggregate refresh:
- required (details/list aggregates that expose links must be refreshed).

## 7.2 `unlink_entry_from_entity`

Permissions:
- accounting entry/link management permission.

Validation:
- link exists
- entry/link belongs to org
- relation removability policy check

Audit event:
- `entry_unlinked`

Aggregate refresh:
- required.

---

## 8) Aggregate representation

Links must be returned as ready aggregate objects, not raw unresolved IDs only.

Expected aggregate shape (conceptual):
- `linked_client` ready object (or null)
- `linked_documents` ready list (may be empty)
- `source_entity` ready descriptor (optional)
- `available_link_actions` ready backend action descriptors

Rules:
- UI must not resolve target IDs on its own as truth-building step.
- No hidden GET for linked client/document truth that contributes to screen truth.
- Aggregate supplies display-ready link state and action availability.

---

## 9) Forbidden behavior

Explicitly forbidden:
1. Hardcoding `document_id` as the only ownership model for entries.
2. Treating document as accounting entry.
3. Frontend stitching linked client/document truth from side endpoints.
4. Cross-tenant link creation.
5. Generic unvalidated target linking.
6. Using links as financial source of truth.
7. Deriving accounting totals from links instead of entries.

---

## Links model summary

- Links are explicit, typed, tenant-safe relations.
- Links provide evidence/source/client/module context.
- Links do not replace accounting entries as financial truth.
- Link semantics are command-validated and aggregate-rendered.

---

## Cardinality summary

- Entry: 0..N document links
- Document: 0..N entry links (policy-controlled)
- Entry: 0..1 primary client relation (policy-controlled)
- Entry: 0..1 source module relation (optional, future policy)

---

## Risky decisions

1. Allowing generic `module_entity` target type can become too loose without strict subtype policy.
2. Multi-link cardinality can introduce duplicate/conflicting link semantics without uniqueness constraints.
3. One-primary-client policy must be explicit; otherwise ambiguity in client context may spread.
4. Document-to-many-entries policy may require stronger provenance/audit to avoid misuse.
5. Link-action permissions can become over-broad if not scoped by relation type and target type.

---

## Open questions / UNKNOWN

1. UNKNOWN: whether `module_entity` should be allowed initially or only after typed registry exists.
2. UNKNOWN: exact uniqueness constraints per (`entry`, `target_type`, `target_id`, `relation_type`).
3. UNKNOWN: enforcement model for one-primary-client relation (hard DB/command-only policy).
4. UNKNOWN: whether document-to-many-entry is always allowed or should be restricted by relation_type.
5. UNKNOWN: whether unlink should hard-delete or soft-delete links for audit-sensitive contexts.
6. UNKNOWN: final aggregate contract shape for source entity descriptors across modules.

