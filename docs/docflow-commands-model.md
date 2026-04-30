# DocFlow Phase 4 - Commands Model (Design Only)

Status: Design contract only.  
No code, no migrations, no API, no services, no UI implementation.

Context contract:
- Core -> Commands -> Aggregate -> UI
- frontend is dumb
- writes only through commands
- reads only through aggregates
- after command: full refreshed aggregate/case
- no PATCH / no generic save / no hidden read stitching

---

## 1) Command Principles

Every DocFlow write action follows this mandatory flow:

1. One user/system action = one command.
2. Command validates actor permission.
3. Command validates strict `org_id` + `client_id` ownership scope.
4. Command validates DocFlow entitlement for organization.
5. Command applies state change.
6. Command writes audit/domain event records.
7. Command returns (or references) full refreshed aggregate target.
8. Frontend does not keep local business truth and does not patch local state.

Non-negotiable:
- no PATCH
- no batch "save_all"
- no generic mutate endpoint

---

## 2) Required Command Groups

### A) Access / Invite
- `invite_client_to_docflow`
- `accept_client_portal_invitation`
- `revoke_client_portal_access`
- `reset_client_portal_access`

### B) Thread
- `create_client_thread`
- `change_thread_status`
- `assign_thread_to_user`
- `set_thread_deadline`
- `archive_client_thread`
- `reopen_client_thread`

### C) Message
- `send_office_message`
- `send_client_message`
- `create_system_message`
- `edit_draft_message`
- `publish_draft_message`
- `cancel_draft_message`

### D) Attachment
- `attach_file_to_client_message`
- `remove_message_attachment`

### E) Read-state
- `mark_thread_read_by_office`
- `mark_thread_read_by_client`

### F) Delivery
- `record_message_delivery_status`
- `record_message_read_delivery`

---

## 3) Command Catalog (Intent, Actor, Payload, Validation, State, Audit, Refresh)

Notation:
- Actor types: `office_user`, `client_portal_user`, `system`
- Shared payload scope fields are implicit unless stated otherwise: `org_id`, `client_id`
- Aggregate refresh targets:
  - office: `client_docflow_tab_aggregate`
  - client: `client_portal_inbox_aggregate`
  - system/review: `docflow_admin_review_aggregate` (where relevant)

---

## A) Access / Invite Commands

### `invite_client_to_docflow`
- **Intent:** Issue invitation for client portal access to DocFlow.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `invite_channel`, one of (`email` or `phone`), optional `expires_in`.
- **Validation rules:**
  - actor is authorized to invite for scoped client
  - org has DocFlow entitlement
  - client belongs to org
  - invite target is valid format
  - no conflicting active invite policy violation
- **State changes:**
  - create invitation row
  - generate secure token (store hash only)
- **Audit/event:** `invitation_created`, optional `invitation_sent`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office)

### `accept_client_portal_invitation`
- **Intent:** Validate invite token and activate client portal access.
- **Actor allowed:** `client_portal_user` (activation context), `system` (on-behalf workflow)
- **Required payload:** `invite_token`, optional activation profile fields.
- **Validation rules:**
  - token hash exists, not expired, not revoked, not consumed
  - invitation scope (`org_id`,`client_id`) valid
  - replay prevention (one-time consumption)
  - entitlement still active
- **State changes:**
  - create/bind scoped `client_portal_user`
  - mark invitation accepted/consumed
  - create scoped session
- **Audit/event:** `invitation_accepted`, `session_created`
- **Aggregate refresh target:** `client_portal_inbox_aggregate` (client)

### `revoke_client_portal_access`
- **Intent:** Immediately block client portal access.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, optional `reason`.
- **Validation rules:**
  - actor permission for scoped client
  - entitlement check not bypassed
- **State changes:**
  - mark portal user revoked/blocked
  - revoke all active sessions in scope
  - revoke pending invites in scope (policy)
- **Audit/event:** `portal_access_revoked`, `invitation_revoked`, `session_revoked`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), optional `docflow_admin_review_aggregate`

### `reset_client_portal_access`
- **Intent:** Invalidate existing access and require fresh invite acceptance.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, optional reset reason.
- **Validation rules:**
  - actor permission and scope checks
  - entitlement check
- **State changes:**
  - revoke current sessions
  - invalidate prior invitation path
  - set reset-required access state
- **Audit/event:** `portal_access_revoked`, `session_revoked`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office)

---

## B) Thread Commands

### `create_client_thread`
- **Intent:** Create work-context thread (not chat room).
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `module_key`, `thread_type`, optional `assigned_user_id`, optional `deadline_at`, optional `title`.
- **Validation rules:**
  - `thread_type` in allowed set
  - actor allowed for module/client scope
  - `assigned_user_id` belongs to same org if provided
  - `deadline_at` format valid
  - entitlement present
- **State changes:** create thread with initial status (default `open` unless explicit valid policy).
- **Audit/event:** `thread_created`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), and relevant client/system aggregate if visible.

### `change_thread_status`
- **Intent:** Move thread work lifecycle.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `next_thread_status`, optional `reason`.
- **Validation rules:**
  - thread exists in scope
  - transition is allowed by lifecycle matrix
  - client portal actor cannot call this command
- **State changes:** update `thread_status`, timestamps (resolved/archive markers as applicable).
- **Audit/event:** `thread_status_changed`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), `client_portal_inbox_aggregate` (if client-visible change).

### `assign_thread_to_user`
- **Intent:** Set/change responsible office owner.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `assigned_user_id`.
- **Validation rules:**
  - target thread in scope
  - assignee exists and belongs to org
  - actor has assignment permission
- **State changes:** update `assigned_user_id`.
- **Audit/event:** `thread_assignment_changed`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office)

### `set_thread_deadline`
- **Intent:** Set/update/remove thread deadline SLA target.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `deadline_at` (nullable for clear).
- **Validation rules:**
  - thread in scope
  - datetime format/constraints valid
  - actor permission check
- **State changes:** update `deadline_at`.
- **Audit/event:** `thread_deadline_set`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), optional client aggregate if safe label shown.

### `archive_client_thread`
- **Intent:** Move resolved thread to archived state.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, optional `reason`.
- **Validation rules:**
  - thread in scope
  - lifecycle allows archive transition (typically from `resolved`)
- **State changes:** set `thread_status=archived`, set `archived_at`.
- **Audit/event:** `thread_archived`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), `client_portal_inbox_aggregate` if visible.

### `reopen_client_thread`
- **Intent:** Reopen previously resolved thread (policy-based).
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, optional `reason`.
- **Validation rules:**
  - thread in scope
  - allowed source state (`resolved`) and policy permits reopen
  - archived reopen is forbidden unless separate restore policy exists
- **State changes:** set `thread_status=open`, clear/adjust resolved markers as policy dictates.
- **Audit/event:** `thread_reopened`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` (office), optional client aggregate.

---

## C) Message Commands

### `send_office_message`
- **Intent:** Publish office-authored message to thread.
- **Actor allowed:** `office_user`, `system` (if acting as office automation)
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_type`, `body`.
- **Validation rules:**
  - thread exists and is active in scope
  - actor permission for thread scope
  - message type allowed
  - body validation/safety constraints
- **State changes:** create message (`message_status=published` by default send path).
- **Audit/event:** `message_created` (office)
- **Aggregate refresh target:** `client_docflow_tab_aggregate`, `client_portal_inbox_aggregate`.

### `send_client_message`
- **Intent:** Publish client-authored message in scoped portal context.
- **Actor allowed:** `client_portal_user`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_type`, `body`.
- **Validation rules:**
  - portal session valid and scoped
  - thread belongs to same (`org_id`,`client_id`)
  - anti-spam/rate limits
  - client cannot mutate `thread_status` directly
- **State changes:** create message (`message_status=published`).
- **Audit/event:** `message_created` (client)
- **Aggregate refresh target:** `client_portal_inbox_aggregate`, `client_docflow_tab_aggregate`.

### `create_system_message`
- **Intent:** Persist rule/system generated message artifact.
- **Actor allowed:** `system`
- **Required payload:** `org_id`, `client_id`, `thread_id` or thread-creation context, `message_type`, `body`, optional `rule_context_id`.
- **Validation rules:**
  - system scope ownership
  - idempotency key required for rule-generated paths
  - no duplicate emission for same rule event
- **State changes:** create system message (and optionally create/reuse thread by separate flow policy).
- **Audit/event:** `message_created` (system), `rule_message_emitted`
- **Aggregate refresh target:** relevant office/client aggregate; optional admin review aggregate.

### `edit_draft_message`
- **Intent:** Edit an existing draft message before publish.
- **Actor allowed:** `office_user`, `client_portal_user` (own draft scope), `system` (limited)
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, new `body`.
- **Validation rules:**
  - message in scope and `message_status=draft`
  - actor is draft owner/authorized editor
  - cannot edit published/cancelled/deleted messages
- **State changes:** update draft body/updated timestamp.
- **Audit/event:** `draft_message_edited`
- **Aggregate refresh target:** actor-facing aggregate (`client_docflow_tab_aggregate` or `client_portal_inbox_aggregate`).

### `publish_draft_message`
- **Intent:** Publish a previously saved draft.
- **Actor allowed:** `office_user`, `client_portal_user` (own draft), `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`.
- **Validation rules:**
  - message in scope and draft state
  - actor authorized to publish that draft
- **State changes:** `message_status: draft -> published`.
- **Audit/event:** `draft_message_published`
- **Aggregate refresh target:** both office and client relevant aggregates.

### `cancel_draft_message`
- **Intent:** Cancel/discard draft message without publishing.
- **Actor allowed:** `office_user`, `client_portal_user` (own draft), `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, optional reason.
- **Validation rules:**
  - message in scope and draft state
  - actor authorized to cancel draft
- **State changes:** `message_status: draft -> deleted` (or cancelled semantic mapped to deleted in model).
- **Audit/event:** `draft_message_cancelled`
- **Aggregate refresh target:** actor-facing aggregate.

---

## D) Attachment Commands

### `attach_file_to_client_message`
- **Intent:** Attach existing stored file asset to message.
- **Actor allowed:** `office_user`, `client_portal_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, `file_asset_id`.
- **Validation rules:**
  - message belongs to scoped thread/client/org
  - `file_asset_id` exists and belongs to same allowed scope
  - no duplicate attachment link on same message
  - file access policy allows actor visibility
- **State changes:** create attachment link record only (no file duplication).
- **Audit/event:** `message_attachment_added`
- **Aggregate refresh target:** relevant actor aggregate.

### `remove_message_attachment`
- **Intent:** Remove attachment link from message.
- **Actor allowed:** `office_user`, `client_portal_user` (own allowed scope), `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, `attachment_id` or `file_asset_id`.
- **Validation rules:**
  - attachment link exists in scope
  - actor authorized to remove
  - remove link only; do not delete shared file asset unless separate file-domain rule says so
- **State changes:** delete/deactivate attachment link.
- **Audit/event:** `message_attachment_removed`
- **Aggregate refresh target:** relevant actor aggregate.

---

## E) Read-state Commands

### `mark_thread_read_by_office`
- **Intent:** Mark thread/messages read state for office actor.
- **Actor allowed:** `office_user`, `system`
- **Required payload:** `org_id`, `client_id`, `thread_id`, optional `last_message_id` or `read_at`.
- **Validation rules:**
  - thread exists in scope
  - actor permission for office view
- **State changes:** update office read-state marker (separate read-state storage).
- **Audit/event:** `thread_read_marked_office`
- **Aggregate refresh target:** `client_docflow_tab_aggregate`.

### `mark_thread_read_by_client`
- **Intent:** Mark thread/messages read state for client portal actor.
- **Actor allowed:** `client_portal_user`
- **Required payload:** `org_id`, `client_id`, `thread_id`, optional `last_message_id` or `read_at`.
- **Validation rules:**
  - valid scoped portal session
  - thread belongs to same scoped client
- **State changes:** update client read-state marker.
- **Audit/event:** `thread_read_marked_client`
- **Aggregate refresh target:** `client_portal_inbox_aggregate`.

---

## F) Delivery Commands

### `record_message_delivery_status`
- **Intent:** Persist transport status update for message/channel.
- **Actor allowed:** `system` (delivery worker/integration), optional `office_user` for manual correction workflow.
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, `channel`, `delivery_status`, optional provider refs/failure code.
- **Validation rules:**
  - message in scope
  - channel allowed
  - valid status transition policy for delivery lifecycle
- **State changes:** upsert/update delivery state row.
- **Audit/event:** `delivery_status_recorded`
- **Aggregate refresh target:** `client_docflow_tab_aggregate` and/or `docflow_admin_review_aggregate`; client aggregate if user-visible.

### `record_message_read_delivery`
- **Intent:** Persist "read" delivery signal for channel.
- **Actor allowed:** `system`, optionally `client_portal_user` when mapped to docflow read signal.
- **Required payload:** `org_id`, `client_id`, `thread_id`, `message_id`, `channel`, `read_at`.
- **Validation rules:**
  - message in scope
  - delivery row/channel exists or can be safely initialized
  - read timestamp validity
- **State changes:** set `delivery_status=read`, set `read_at`.
- **Audit/event:** `delivery_read_recorded`
- **Aggregate refresh target:** relevant office/client aggregate.

---

## 4) Status Rules Enforcement

Commands must enforce:

- Thread lifecycle from Phase 2.1:
  - allowed/forbidden transitions respected by `change_thread_status`, `archive_client_thread`, `reopen_client_thread`
- Client portal user cannot directly change `thread_status`.
- `message_status` is managed by message commands only, separate from delivery.
- `delivery_status` is managed by delivery commands only, separate from thread work state.
- No command may infer one status layer from another without explicit server rule.

---

## 5) Entitlement / Permission Checks

Every command must check:

1. Organization has DocFlow entitlement.
2. Actor has permission for command and scope.
3. `org_id` ownership scope.
4. `client_id` ownership scope.
5. For attachment commands: file ownership/visibility checks for `file_asset_id`.

Security behavior:
- On scope violation, return tenant-safe error (no cross-tenant existence leakage).

---

## 6) Full Refresh Rule

After every successful command:

- backend rebuilds full relevant aggregate (no partial UI patch merge)
- office command path returns refreshed `client_docflow_tab_aggregate` where relevant
- client command path returns refreshed `client_portal_inbox_aggregate` where relevant
- system/rule command returns relevant review/admin aggregate where relevant (`docflow_admin_review_aggregate`)

Frontend must render only returned refreshed truth.

---

## 7) Idempotency Expectations

Idempotency must be defined/required for:

- **`accept_client_portal_invitation`**  
  Same token acceptance cannot activate twice; second attempt is safe no-op/error by consumed state.

- **`send_office_message` / `send_client_message`**  
  Optional idempotency key to prevent duplicate submissions on retries.

- **`attach_file_to_client_message`**  
  Idempotent by unique (`message_id`,`file_asset_id`) link behavior.

- **`create_system_message`**  
  Mandatory idempotency key from rule context to avoid duplicate automated emissions.

- **`record_message_delivery_status` / `record_message_read_delivery`**  
  Upsert/transition-safe idempotent updates by (`message_id`,`channel`,`provider_event_id` optional).

- **rules-generated commands (all)**  
  Must carry deterministic event key to guarantee replay-safe behavior.

---

## 8) Forbidden Patterns

Explicitly forbidden:

- PATCH writes
- generic `update_thread`
- generic `update_message`
- `save_all`
- frontend-calculated statuses
- frontend direct DB writes
- hidden GET after command to stitch missing truth
- partial local update after command
- one command mutating multiple unrelated work items

---

## 9) Command Response Contract

### Success
- command returns:
  - `ok: true`
  - `command_key`
  - refreshed aggregate payload or aggregate reference contract
  - optional warnings (non-blocking)

### Failure
- command returns structured error:
  - stable error code
  - safe message
  - optional validation details (field-level where safe)
- errors must not reveal cross-tenant resource existence.

Frontend contract:
- no partial local merge
- render from refreshed aggregate only on success

---

## 10) Phase 4 Validation Checklist

- [x] all write actions are commands
- [x] no PATCH / generic save exists
- [x] command actors are defined
- [x] payloads are defined
- [x] validation rules are defined
- [x] audit/events are defined
- [x] entitlement checks included
- [x] tenant/client scoping included
- [x] full aggregate refresh included
- [x] idempotency included
- [x] forbidden patterns documented

---

Final confirmation:  
DocFlow write model is command-only, tenant-scoped, auditable, and aggregate-refresh driven.

