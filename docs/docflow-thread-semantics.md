# DocFlow Phase 2.1 - Thread Semantics (Design Only)

Status: Design contract only.  
No code, no migrations, no API, no services, no UI implementation.

Context contract:
- Core -> Commands -> Aggregate -> UI
- Frontend is dumb
- Writes only via commands
- Reads only via aggregates
- After command: full refreshed aggregate/case

---

## 1) Thread Meaning

A DocFlow thread is a **work unit / work context**, not a free chat conversation.

- Thread is created to move a client-related work item to completion.
- Thread is bounded by ownership and workflow context.
- Thread cannot exist without:
  - `org_id`
  - `client_id`
  - `module_key`

Definition boundary:
- Thread != WhatsApp-like chat room
- Thread != global messaging channel
- Thread != standalone social conversation

---

## 2) Thread Types (`thread_type`)

Allowed values (exact):
- `document_request`
- `question`
- `reminder`
- `task_followup`

### `document_request`
- **Purpose:** Request specific document(s) from client for ongoing work.
- **Typical creator:** Office user or system rule.
- **Typical messages:** Requested document list, clarifications, upload confirmations.
- **Resolve when:** Required document set is received/validated or request is cancelled/closed by office policy.

### `question`
- **Purpose:** Clarify missing/ambiguous information needed for workflow progress.
- **Typical creator:** Office user, occasionally client (if allowed by product flow), or system prompt.
- **Typical messages:** Q/A exchanges, concise clarifications, status confirmations.
- **Resolve when:** Question is answered sufficiently for work continuation.

### `reminder`
- **Purpose:** Follow-up nudge for pending client action or office callback.
- **Typical creator:** System rule or office user.
- **Typical messages:** Reminder notices, due-date references, acknowledgment.
- **Resolve when:** Reminded action is completed or reminder is no longer relevant.

### `task_followup`
- **Purpose:** Communication tied to a workflow step/task context (conceptual link).
- **Typical creator:** Office user or system rule.
- **Typical messages:** Progress checkpoints, dependency updates, completion confirmations.
- **Resolve when:** Related workflow checkpoint is completed or superseded.

---

## 3) Thread Status Lifecycle (`thread_status`)

Allowed values (exact):
- `open`
- `waiting_client`
- `waiting_office`
- `resolved`
- `archived`

### Meaning

- **`open`**  
  Active thread, work started, no strict waiting owner yet.

- **`waiting_client`**  
  Next required action is on client side.

- **`waiting_office`**  
  Next required action is on office side.

- **`resolved`**  
  Work context is completed/closed functionally.

- **`archived`**  
  Historical/inactive state for retention/reference; no active work expected.

### Allowed transitions

- `open` -> `waiting_client`
- `open` -> `waiting_office`
- `open` -> `resolved`
- `waiting_client` -> `waiting_office`
- `waiting_client` -> `resolved`
- `waiting_office` -> `waiting_client`
- `waiting_office` -> `resolved`
- `resolved` -> `archived`
- `resolved` -> `open` (reopen when explicitly allowed by command policy)

### Forbidden transitions

- `archived` -> any active status (without explicit restore command policy; not in this phase)
- `open` -> `archived` (must resolve first)
- `waiting_client` -> `archived` (must resolve first)
- `waiting_office` -> `archived` (must resolve first)
- Any implicit transition done by UI without command

### Who can change `thread_status`

- **Office user:** can change status through explicit backend command according to policy.
- **System:** can change status via rule-driven command flow.
- **Client portal user:** **must NOT directly change `thread_status`**.  
  Client actions (message/upload/ack) may trigger backend command logic that may update status server-side.

---

## 4) Status Separation (Mandatory)

`thread_status` != `message_status` != `delivery_status`

- **`thread_status`** = work progress state of the thread context.
- **`message_status`** = lifecycle of an individual message entity.
- **`delivery_status`** = channel transport/read state.

These statuses are separate and must never be mixed, inferred interchangeably, or computed in UI.

---

## 5) Assignment Model

- `assigned_user_id` means the responsible **office** user for thread ownership.
- Assignment is internal operational ownership.
- Client must not see raw internal ownership unless aggregate exposes a safe/public label.
- Assignment changes only through explicit backend command.
- Every assignment change must be audited (event/audit trail).

---

## 6) Deadline / SLA Model

- `deadline_at` is the target time boundary for this thread work context.
- SLA indicators (on-time, due soon, overdue, breached) are computed by backend aggregate only.
- UI must not compute overdue/due-soon using local date logic.
- Default SLA policy may later come from Owner Panel/rules configuration.
- No frontend date decision logic for SLA behavior.

---

## 7) System / Rule-Generated Threads

- System is allowed to create threads.
- System-created thread must set `created_by_type = system`.
- System messages may create a new thread or reuse an existing one using:
  - `module_key`
  - `client_id`
  - rule context
- Decision to create/reuse is rule/command responsibility, not UI responsibility.
- DocFlow storage responsibility is to persist, track, and deliver communication artifacts.

---

## 8) Task Connection (Conceptual Only)

- Thread may later reference task/workflow context.
- DocFlow thread is not a task entity and must not become a task engine.
- No task implementation in this phase.
- No direct module-to-module coupling introduced in this phase.

---

## 9) Aggregate Expectations (Future Read Model Contract)

### Office aggregate should expose
- `thread_status`
- `thread_type`
- `assigned_user` (safe office context)
- `deadline`
- SLA indicator
- allowed actions (command-driven)

### Client aggregate should expose
- safe `thread_status` label only if needed
- messages
- allowed actions
- no internal assignment details
- no audit/internal ownership internals

Note: these are aggregate contract expectations only, not API implementation.

---

## 10) Hard Rules

- no frontend status calculation
- no frontend SLA calculation
- no client-side direct thread status changes
- no PATCH
- no generic save
- no direct DB update from UI
- no treating thread as WhatsApp-style chat
- no mixing `thread_status`, `message_status`, `delivery_status`

---

## 11) Phase 2.1 Validation Checklist

- [x] Thread is defined as work context, not chat
- [x] `thread_type` values are defined
- [x] `thread_status` lifecycle is defined
- [x] allowed/forbidden transitions are defined
- [x] client cannot directly change `thread_status`
- [x] assignment model is defined
- [x] deadline/SLA model is backend-owned
- [x] system/rule-generated threads are defined
- [x] task connection is conceptual only
- [x] aggregate expectations are defined
- [x] UI remains dumb

---

Final confirmation:  
**DocFlow thread semantics define a work communication context, not a generic chat conversation.**

