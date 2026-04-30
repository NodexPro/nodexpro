# DocFlow Phase 2 - Storage / Schema Design (Design Only)

Status: Draft architectural storage contract (no runtime implementation, no migrations).

Scope: Define storage model for DocFlow under NodexPro contract:

- Core -> Commands -> Aggregates -> UI
- DocFlow is a work communication system, not a generic chat system
- Tenant-safe by default (`org_id` scoping + `client_id` scoping)

## 1) Design Principles

- **Single ownership boundary:** every DocFlow entity belongs to one `org_id` and one `client_id` (except invite/session artifacts that are still scoped by both).
- **Work context, not chat:** thread semantics are operational (`module_key`, `thread_type`, `thread_status`, assignment, SLA).
- **No business logic in messages:** message rows are communication records only.
- **No duplicate file storage:** attachments reference existing file/document storage (`file_asset_id`), no binary duplication in DocFlow tables.
- **Strict status separation:** `thread_status` != `message_status` != `delivery_status`.
- **Client portal identity is separate:** `client_portal_user` != Core user.

---

## 1.1 Tenant Isolation Contract (Mandatory)

- **Every DocFlow table includes `org_id`.** No exceptions.
- **`client_id` is present on all client-scoped tables** (all 8 tables in this phase are client-scoped).
- **No read or write is valid without tenant filter**:
  - office path: `WHERE org_id = :ctx_org_id`
  - portal path: `WHERE org_id = :ctx_org_id AND client_id = :ctx_client_id`
- **Join safety rule:** all joins must include ownership consistency checks on `org_id` and `client_id` (where applicable), not only by `id`.
- **Direct unscoped table access is forbidden** (including diagnostics/reporting queries).

Query enforcement rule (applies to ALL tables):
- Minimum required predicates: `org_id` always, plus `client_id` for client-level access.
- Any query lacking tenant predicates is invalid by contract.

---

## 2) Table Design

## 2.1 `client_portal_users`

### Purpose
Dedicated identity for client portal access. Represents an invited client-side actor for one org/client boundary.

### Fields

| Field | Type (design) | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Portal user identity (not Core user id). |
| `org_id` | uuid fk -> organizations.id | yes | Tenant scope. |
| `client_id` | uuid fk -> clients.id | yes | Client scope inside tenant. |
| `email_normalized` | text | yes | Login identifier (normalized lowercase email). |
| `phone_e164` | text | no | Optional secondary identifier/contact. |
| `display_name` | text | no | Friendly label shown in UI/events. |
| `status` | text enum(`invited`,`active`,`revoked`,`locked`) | yes | Access lifecycle state. |
| `last_login_at` | timestamptz | no | Last successful authentication. |
| `password_hash` | text | no | If password auth is used; never raw password. |
| `auth_method` | text enum(`magic_link`,`otp`,`password`,`external`) | yes | Auth mode marker. |
| `revoked_at` | timestamptz | no | Revocation timestamp. |
| `created_at` | timestamptz | yes | Audit baseline. |
| `updated_at` | timestamptz | yes | Update tracking. |

### Relationships
- many invitations (`client_portal_invitations`)
- many sessions (`client_portal_sessions`)
- may author messages/events as `created_by_type=client` via `created_by_portal_user_id` (future optional FK in message/event tables)

### Scoping
- Always includes both `org_id` and `client_id`.
- Unique identity should not cross org/client boundaries.

### Indexes
- unique: (`org_id`,`client_id`,`email_normalized`)
- index: (`org_id`,`status`)
- index: (`client_id`,`status`)
- index: (`last_login_at`)

### Constraints
- `status` enum check.
- `email_normalized` format/normalization policy.
- Optional check: `revoked_at` must be set when `status='revoked'`.

### Must NOT be stored
- Core platform role data.
- Cross-client permissions.
- Organization-wide authorization matrix.
- Raw secrets (plain passwords, raw OTPs).

---

## 2.2 `client_portal_invitations`

### Purpose
Track invitation lifecycle for client portal onboarding/reset/re-invite.

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Invitation id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `portal_user_id` | uuid fk -> client_portal_users.id | no | Linked portal user (if pre-created). |
| `invite_email_normalized` | text | yes | Invitation target email. |
| `invite_token_hash` | text | yes | Hashed token only. |
| `token_expires_at` | timestamptz | yes | Invite expiry. |
| `status` | text enum(`pending`,`accepted`,`expired`,`revoked`) | yes | Invite state. |
| `issued_by_user_id` | uuid fk -> users.id | yes | Office Core user who issued invite. |
| `accepted_at` | timestamptz | no | Accept timestamp. |
| `revoked_at` | timestamptz | no | Revoke timestamp. |
| `created_at` | timestamptz | yes | Created time. |

### Relationships
- belongs to org/client.
- optionally links to portal user.
- audit trail should connect to `client_message_events`.

### Scoping
- Scoped by `org_id`,`client_id`.

### Indexes
- unique: (`invite_token_hash`)
- index: (`org_id`,`client_id`,`status`)
- index: (`invite_email_normalized`,`status`)
- index: (`token_expires_at`)

### Constraints
- single active pending invite policy placeholder: at most one `pending` invite per (`org_id`,`client_id`,`invite_email_normalized`) [policy choice].
- token hash required; raw token never stored.

### Must NOT be stored
- Plain invite tokens.
- Sensitive PII not needed for invitation.

---

## 2.3 `client_portal_sessions`

### Purpose
Track authenticated portal sessions for revoke/reset and security auditing.

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Session id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `portal_user_id` | uuid fk | yes | Session owner. |
| `session_token_hash` | text | yes | Hashed session token. |
| `refresh_token_hash` | text | no | Optional hashed refresh token. |
| `status` | text enum(`active`,`revoked`,`expired`) | yes | Session state. |
| `ip_address` | inet/text | no | Security context. |
| `user_agent` | text | no | Security context. |
| `created_at` | timestamptz | yes | Session open time. |
| `last_seen_at` | timestamptz | no | Last activity. |
| `expires_at` | timestamptz | yes | Expiry. |
| `revoked_at` | timestamptz | no | Revoke time. |

### Relationships
- many sessions per portal user.

### Scoping
- enforced by (`org_id`,`client_id`,`portal_user_id`) consistency checks.

### Indexes
- unique: (`session_token_hash`)
- index: (`portal_user_id`,`status`)
- index: (`org_id`,`client_id`,`status`)
- index: (`expires_at`)

### Constraints
- token hashes only.
- expired/revoked state transitions controlled by commands.

### Must NOT be stored
- Raw bearer tokens.
- Business data unrelated to authentication.

---

## 2.4 `client_message_threads`

### Purpose
Top-level work context container per client/module workflow.

### Required Thread Fields (per contract)
- `id`
- `org_id`
- `client_id`
- `module_key`
- `thread_type`
- `thread_status`
- `assigned_user_id` (nullable)
- `deadline_at` (nullable)
- `created_by_type` (`office` / `system`)
- `created_at`
- `updated_at`

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Thread id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `module_key` | text | yes | Workflow/module isolation key. |
| `thread_type` | enum(`document_request`,`question`,`reminder`,`task_followup`) | yes | Work-context semantic type. |
| `thread_status` | enum(`open`,`waiting_client`,`waiting_office`,`resolved`,`archived`) | yes | Work lifecycle. |
| `assigned_user_id` | uuid fk -> users.id | no | Office responsible actor. |
| `deadline_at` | timestamptz | no | Optional SLA/deadline. |
| `created_by_type` | enum(`office`,`system`) | yes | Thread origin actor class for office/system initiated work contexts. |
| `created_by_user_id` | uuid fk -> users.id | no | Office creator if office/system office-context. |
| `created_by_portal_user_id` | uuid fk -> client_portal_users.id | no | Client creator if client-originated. |
| `title` | text | no | Brief work subject (not free chat topic). |
| `summary` | text | no | Optional office summary. |
| `resolved_at` | timestamptz | no | Resolution timestamp. |
| `archived_at` | timestamptz | no | Archive timestamp. |
| `created_at` | timestamptz | yes | Creation timestamp. |
| `updated_at` | timestamptz | yes | Last thread update. |

### Relationships
- one thread -> many messages
- one thread -> many events
- thread tied to one org+client+module

### Scoping
- hard scope by `org_id`,`client_id`.

### Indexes
- index: (`org_id`,`client_id`,`module_key`,`thread_status`)
- index: (`org_id`,`assigned_user_id`,`thread_status`)
- index: (`org_id`,`client_id`,`updated_at desc`)
- index: (`deadline_at`) for SLA queries

### Constraints
- enum checks for type/status/created_by_type.
- `created_by_type` consistency with creator id fields.
- optional transition policy enforced via commands (not raw DB updates).

### Must NOT be stored
- message delivery transport state.
- binary file payloads.
- task engine truth (thread can reference task context, but is not a task table).

---

## 2.5 `client_messages`

### Purpose
Store communication units inside a thread.

### Required Message Fields (per contract)
- `id`
- `org_id`
- `thread_id`
- `message_type` (`text`,`file`,`system`,`request`,`reminder`)
- `created_by_type` (`office`,`client`,`system`)
- `body`
- `created_at`

Additional tenant field (mandatory for isolation):
- `client_id`

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Message id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `thread_id` | uuid fk -> client_message_threads.id | yes | Parent work thread. |
| `message_type` | enum(`text`,`file`,`system`,`request`,`reminder`) | yes | Message semantic type. |
| `created_by_type` | enum(`office`,`client`,`system`) | yes | Actor class. |
| `created_by_user_id` | uuid fk -> users.id | no | Office/system office actor. |
| `created_by_portal_user_id` | uuid fk -> client_portal_users.id | no | Client actor. |
| `body` | text/jsonb policy | yes | Human-readable content or structured system payload wrapper. |
| `message_status` | enum(`draft`,`published`,`deleted`) | yes | Message entity lifecycle (separate from thread/delivery). |
| `created_at` | timestamptz | yes | Creation time. |
| `updated_at` | timestamptz | yes | Update time. |
| `deleted_at` | timestamptz | no | Soft-delete marker if policy allows. |

### Relationships
- one message -> many attachments
- one message -> many deliveries
- one message -> many events

### Scoping
- message must match parent thread `org_id` + `client_id`.

### Indexes
- index: (`thread_id`,`created_at`)
- index: (`org_id`,`client_id`,`created_at desc`)
- index: (`message_type`,`created_at`)

### Constraints
- message actor consistency checks.
- body length/type policy placeholders.

### Must NOT be stored
- business decision logic.
- workflow state machine logic.
- task completion truth.

---

## 2.6 `client_message_attachments`

### Purpose
Link messages to already stored files/documents.

### Required Attachment Fields (per contract)
- `id`
- `org_id`
- `message_id`
- `file_asset_id` (required, from shared storage)
- `created_at`

Additional tenant field (mandatory for isolation):
- `client_id`

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Attachment link id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `thread_id` | uuid fk -> client_message_threads.id | yes | Parent thread. |
| `message_id` | uuid fk -> client_messages.id | yes | Parent message. |
| `file_asset_id` | uuid fk -> file_assets.id | yes | Existing file pointer. |
| `attached_by_type` | enum(`office`,`client`,`system`) | yes | Actor class for link creation. |
| `attached_by_user_id` | uuid fk -> users.id | no | Office actor id. |
| `attached_by_portal_user_id` | uuid fk -> client_portal_users.id | no | Client actor id. |
| `created_at` | timestamptz | yes | Link creation time. |

### Relationships
- message -> attachments is `1:N`
- references existing file/document storage through `file_asset_id` only
- attachments MUST NOT store files directly

### Scoping
- must match org/client/thread/message ownership.

### Indexes
- unique: (`message_id`,`file_asset_id`) to avoid duplicate links on same message
- index: (`thread_id`,`created_at`)
- index: (`file_asset_id`)

### Constraints
- no file blob column allowed.
- link consistency to message/thread scope.

### Must NOT be stored
- binary file content.
- duplicated metadata already owned by file/document module.

---

## 2.7 `client_message_deliveries`

### Purpose
Track channel-level delivery/read state separately from message and thread lifecycle.

### Delivery Model (required)
- `delivery_status`: `pending | sent | failed | read`
- `channel`: `docflow | sms_later | email_later`

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Delivery row id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `thread_id` | uuid fk | yes | Parent thread. |
| `message_id` | uuid fk -> client_messages.id | yes | Delivered message. |
| `channel` | enum(`docflow`,`sms_later`,`email_later`) | yes | Transport channel. |
| `delivery_status` | enum(`pending`,`sent`,`failed`,`read`) | yes | Transport/read result. |
| `provider_message_id` | text | no | External provider ref (future channels). |
| `attempt_count` | int | yes default 0 | Delivery attempts. |
| `last_attempt_at` | timestamptz | no | Last send attempt. |
| `sent_at` | timestamptz | no | Sent timestamp. |
| `read_at` | timestamptz | no | Read timestamp. |
| `failure_code` | text | no | Provider/internal failure code. |
| `failure_reason` | text | no | Failure details. |
| `created_at` | timestamptz | yes | Row creation time. |
| `updated_at` | timestamptz | yes | Last update. |

### Relationships
- many delivery attempts/channels per message.

### Scoping
- scoped by org/client/thread/message.

### Indexes
- index: (`message_id`,`channel`)
- index: (`org_id`,`delivery_status`,`channel`)
- index: (`client_id`,`delivery_status`)
- index: (`read_at`)

### Constraints
- strict enum checks.
- `read_at` should be nullable unless status is `read`.

### Must NOT be stored
- thread workflow status.
- message body payload duplication.

---

## 2.8 `client_message_events`

### Purpose
Append-only operational/audit timeline for DocFlow domain events (thread/message/invite/session actions).

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | uuid pk | yes | Event id. |
| `org_id` | uuid fk | yes | Tenant scope. |
| `client_id` | uuid fk | yes | Client scope. |
| `thread_id` | uuid fk | no | Thread context (if applicable). |
| `message_id` | uuid fk | no | Message context (if applicable). |
| `event_type` | text enum namespace | yes | Domain event code (e.g. `thread.created`, `message.sent`, `invite.revoked`). |
| `actor_type` | enum(`office`,`client`,`system`) | yes | Event actor class. |
| `actor_user_id` | uuid fk -> users.id | no | Office actor. |
| `actor_portal_user_id` | uuid fk -> client_portal_users.id | no | Portal actor. |
| `payload_json` | jsonb | no | Event metadata (no secrets). |
| `created_at` | timestamptz | yes | Event time. |

### Relationships
- linked to thread/message where applicable.
- integration point with global audit logs (complementary, not replacement).

### Scoping
- always org/client scoped, even for system events.

### Indexes
- index: (`org_id`,`client_id`,`created_at desc`)
- index: (`thread_id`,`created_at`)
- index: (`message_id`,`created_at`)
- index: (`event_type`,`created_at`)

### Constraints
- append-only policy (no updates/deletes except controlled retention workflows).

### Must NOT be stored
- raw authentication secrets/tokens.
- full document binary data.

---

## 3) Key Relationships Overview

- `client_portal_users (1) -> (N) client_portal_invitations`
- `client_portal_users (1) -> (N) client_portal_sessions`
- `client_message_threads (1) -> (N) client_messages` (**thread -> messages**)
- `client_messages (1) -> (N) client_message_attachments` (**message -> attachments**)
- `client_messages (1) -> (N) client_message_deliveries` (**message -> deliveries**)
- `client_message_threads/messages (1) -> (N) client_message_events` (**thread/message -> events**)
- `client_message_attachments.file_asset_id -> file_assets.id` (reuse existing file storage)

Cardinality guardrails:
- No cross-thread message.
- No cross-client attachment/delivery/event link.
- No cross-org joins without explicit owner scope.

---

## 4) Status Separation (Critical)

- **`thread_status`** (in `client_message_threads`): work-progress state of the thread context (`open`,`waiting_client`,`waiting_office`,`resolved`,`archived`).
- **`message_status`** (in `client_messages`): lifecycle state of an individual message entity (`draft`,`published`,`deleted`), independent from thread progress.
- **`delivery_status`** (in `client_message_deliveries`): transport/read outcome per channel (`pending`,`sent`,`failed`,`read`), independent from thread and message lifecycle.
- These three statuses are intentionally separate and must never be reused interchangeably.

---

## 5) Isolation / RLS Expectations

- All DocFlow tables enforce tenant scoping with `org_id`.
- Client-portal scoped reads/writes additionally constrained by `client_id`.
- Office role access goes through backend command/aggregate checks; no direct UI table access.
- Client portal access path must never see rows outside invited (`org_id`,`client_id`).
- Service-role backend may bypass RLS technically, but command-layer enforcement remains mandatory.
- No table is queryable without tenant predicates (`org_id` + `client_id` where applicable).

Minimum RLS intent per table:
- Office authenticated users: scoped by organization membership + module entitlement.
- Client portal actor: scoped to exact client pair only.
- No anonymous data access.

---

## 6) Access / Invitation / Revocation Expectations

- Invite token flow uses hashed token storage only.
- Invitation accept binds to (`org_id`,`client_id`) boundary.
- Revoke/reset must invalidate sessions (`client_portal_sessions.status=revoked`).
- Portal user lifecycle independent from Core user lifecycle.

---

## 7) Audit/Event Expectations

- Critical operations produce events:
  - invitation issued/accepted/revoked/expired
  - session created/revoked/expired
  - thread created/status changed/assigned/resolved/archived
  - message created/published/deleted
  - attachment linked/unlinked
  - delivery state transitions
- Event stream is domain timeline; global audit log remains platform-wide compliance log.

---

## 8) File Access Security Expectations

- Attachments only reference existing `file_asset_id` objects.
- File retrieval must enforce same (`org_id`,`client_id`) entitlement + thread/message ownership checks.
- Signed URLs/time-limited access policy placeholder (implementation phase).
- Malware scanning / DLP hooks placeholder (implementation phase).

---

## 9) Storage Rules (Mandatory)

- NO file duplication in DocFlow tables.
- NO separate file storage for DocFlow.
- Attachments only reference shared `file_assets` through `file_asset_id`.
- NO cross-module direct coupling by raw table reads.
- Module consumers must rely on DocFlow read models, not direct message table coupling.

---

## 10) Policy Placeholders (to be finalized before implementation)

- **Rate limits**
  - max messages per minute per actor
  - max invite attempts/day per client
  - max failed auth attempts before temporary lock
- **Attachment policy**
  - max file size per attachment
  - max attachments per message/thread
  - allowed mime types/extensions
  - retention / purge window
- **Retention policy**
  - archive/retention duration for messages/events
  - legal hold behavior

---

## 11) Explicit Separations (Non-negotiable)

- `thread_status` != `message_status` != `delivery_status`
- DocFlow messages != tasks/work items
- DocFlow attachments != file storage system
- `client_portal_user` != Core user

---

## 12) Risks

1. **Status coupling risk:** accidental mixing of thread/message/delivery status in downstream logic.
2. **Tenant leak risk:** missing (`org_id`,`client_id`) filters in joins/aggregates.
3. **Portal identity confusion:** treating portal users like Core users could break access boundaries.
4. **Attachment duplication drift:** storing file metadata/payload redundantly in DocFlow.
5. **Event bloat:** unbounded event payloads without retention and schema discipline.

---

## 13) Open Questions / UNKNOWN

1. Should one `client_portal_user` be allowed to access multiple clients in same org, or strictly one user per (`org_id`,`client_id`)?
2. Preferred authentication mode for portal v1 (`magic_link` vs OTP vs password)?
3. Is message edit allowed, or append-only with correction messages only?
4. Should `message_status=draft` exist for office side, or publish-only model?
5. Delivery semantics for `docflow` channel: when is `read` set (thread open vs message viewport)?
6. Attachment retention ownership: follows file module policy or DocFlow-specific override?
7. Do we need PII minimization/encryption-at-column for `body` in specific jurisdictions?
8. Expected SLA policy defaults by `thread_type` and `module_key`?
9. Need idempotency key storage for command replay protection at message creation?
10. How to model legal hold / immutable archive requirements for regulated tenants?

---

## 14) Phase 2 Validation Checklist

- [x] `org_id` exists in ALL tables
- [x] `client_id` correctly scoped
- [x] all relations defined
- [x] required fields present
- [x] file storage is unified via `file_assets`
- [x] no status mixing
- [x] tenant isolation enforced

---

## 15) Final Contract Confirmation

This storage design preserves Phase 1 architecture and constraints:

- Command/aggregate-driven backend model
- strict org/client/module scoping
- non-chat work communication semantics
- no UI business logic dependency
- no direct DB reads from UI

**DocFlow remains a work communication system, not a chat system.**

