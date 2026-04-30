# DocFlow Phase 5 - Aggregates / Read Models (Design Only)

This placeholder contract file defines required aggregate keys used by Phase 6 backend foundation:

- `client_docflow_tab_aggregate` (office)
- `client_portal_inbox_aggregate` (client portal)
- `docflow_admin_review_aggregate` (future)
- `docflow_floating_widget_aggregate` (future)

Phase 6 foundation implements the first two aggregates with:
- thread list
- selected thread
- messages
- attachments
- unread counters
- allowed actions
- backend-provided labels
- backend-provided SLA indicator

UI must render only aggregate truth and trigger only allowed command actions.

# DocFlow Phase 5 - Aggregates / Read Models (Design Only)

Status: Design contract only.  
No code, no migrations, no API, no services, no UI implementation.

Context contract:
- Core -> Commands -> Aggregate -> UI
- frontend is dumb
- reads only through aggregates
- writes only through commands
- after command: full refreshed aggregate/case

---

## 1) Aggregate Principles

- **One screen = one aggregate.**
- Aggregate is the single source of truth for that screen.
- UI renders only aggregate payload fields.
- UI can trigger only command actions returned in aggregate `allowed_actions`.
- No frontend business logic.
- No hidden GET after user action.
- No stitched reads from multiple endpoints for one screen truth.
- No local business truth in UI state.

---

## 2) Required Aggregates

## A) `client_docflow_tab_aggregate` (Office)

### Purpose
DocFlow tab inside client card/workspace (office side).

### Must include
- `client_header`
- `entitlement_status`
- `portal_access_status`
- `thread_list`
- `selected_thread`
- `messages`
- `attachments`
- `unread_counters`
- thread status labels (backend-provided)
- thread type labels (backend-provided)
- `assigned_user` safe object
- `deadline`
- SLA indicator
- `allowed_actions`
- `empty_states`
- `validation_messages` (if needed)

---

## B) `client_portal_inbox_aggregate` (Client)

### Purpose
Client portal mobile/PWA view.

### Must include
- `firm_header`
- `client_profile_header`
- `portal_session_status`
- `thread_list`
- `selected_thread`
- `messages`
- `attachments`
- `unread_count`
- `attachment_permissions`
- `allowed_actions`
- PWA/badge metadata
- `empty_states`

### Must NOT include
- internal `assigned_user_id`
- audit internals
- office-only notes
- internal ownership internals
- data of other clients
- organization admin/internal data

---

## C) `docflow_admin_review_aggregate` (Admin / Rules Review)

### Purpose
Review queue for rule-generated draft/system messages before send.

### Must include
- pending draft messages
- source rule info
- safe client summary
- `module_key`
- `generated_at`
- message preview
- status (`draft` / `approved` / `sent` / `cancelled`)
- skipped clients with reason
- `allowed_actions`:
  - edit
  - approve
  - send
  - cancel

---

## D) `docflow_floating_widget_aggregate` (Floating Widget)

### Purpose
Cross-module widget visibility/action surface when DocFlow entitlement exists.

### Must include
- `entitlement_status`
- `pending_suggestions_count`
- `unread_count`
- `active_client_context` (if available)
- `pending_messages`
- `allowed_actions`:
  - open
  - approve
  - send
  - cancel

---

## 3) Aggregate Data Shapes (JSON-like Contracts)

Important for all shapes:
- labels are backend-provided
- statuses are backend-provided
- actions are backend-provided
- SLA indicator is backend-provided
- unread counters are backend-provided
- UI must not calculate or infer these

## 3.1 `client_docflow_tab_aggregate`

```json
{
  "aggregate_key": "client_docflow_tab_aggregate",
  "org_id": "uuid",
  "client_id": "uuid",
  "client_header": {
    "client_id": "uuid",
    "display_name": "string",
    "client_code": "string|null",
    "status_label": "string"
  },
  "entitlement_status": {
    "active": true,
    "code": "enabled|disabled|missing_plan",
    "label": "string"
  },
  "portal_access_status": {
    "state": "not_invited|invited|active|revoked|reset_required",
    "label": "string",
    "last_invited_at": "iso_datetime|null",
    "last_login_at": "iso_datetime|null"
  },
  "thread_list": [
    {
      "thread_id": "uuid",
      "module_key": "string",
      "thread_type": "document_request|question|reminder|task_followup",
      "thread_type_label": "string",
      "thread_status": "open|waiting_client|waiting_office|resolved|archived",
      "thread_status_label": "string",
      "unread_count": 0,
      "last_message_preview": "string|null",
      "last_message_at": "iso_datetime|null",
      "deadline_at": "iso_datetime|null",
      "sla_indicator": {
        "code": "on_track|due_soon|overdue|none",
        "label": "string",
        "tone": "ok|warn|critical|muted"
      },
      "assigned_user": {
        "user_id": "uuid|null",
        "display_name": "string|null",
        "avatar_url": "string|null"
      }
    }
  ],
  "selected_thread": {
    "thread_id": "uuid|null",
    "module_key": "string|null",
    "thread_type": "string|null",
    "thread_type_label": "string|null",
    "thread_status": "string|null",
    "thread_status_label": "string|null",
    "assigned_user": {
      "user_id": "uuid|null",
      "display_name": "string|null",
      "avatar_url": "string|null"
    },
    "deadline_at": "iso_datetime|null",
    "sla_indicator": {
      "code": "string|null",
      "label": "string|null",
      "tone": "string|null"
    }
  },
  "messages": [
    {
      "message_id": "uuid",
      "thread_id": "uuid",
      "message_type": "text|file|system|request|reminder",
      "message_type_label": "string",
      "message_status": "draft|published|deleted",
      "created_by_type": "office|client|system",
      "author_label": "string",
      "body": "string|object",
      "created_at": "iso_datetime"
    }
  ],
  "attachments": [
    {
      "attachment_id": "uuid",
      "message_id": "uuid",
      "file_asset_id": "uuid",
      "file_name": "string",
      "file_size_bytes": 0,
      "mime_type": "string",
      "download_allowed": true
    }
  ],
  "unread_counters": {
    "total_threads_unread": 0,
    "selected_thread_unread": 0
  },
  "allowed_actions": [
    { "command": "send_office_message", "enabled": true, "reason": null }
  ],
  "empty_states": {
    "threads": { "code": "no_threads", "title": "string", "description": "string" },
    "messages": { "code": "no_messages", "title": "string", "description": "string" }
  },
  "validation_messages": []
}
```

## 3.2 `client_portal_inbox_aggregate`

```json
{
  "aggregate_key": "client_portal_inbox_aggregate",
  "org_id": "uuid",
  "client_id": "uuid",
  "firm_header": {
    "firm_display_name": "string",
    "firm_logo_url": "string|null"
  },
  "client_profile_header": {
    "display_name": "string",
    "client_ref": "string|null"
  },
  "portal_session_status": {
    "state": "active|expiring|revoked|expired",
    "label": "string"
  },
  "thread_list": [
    {
      "thread_id": "uuid",
      "module_key": "string",
      "thread_type_label": "string",
      "thread_status_safe_label": "string",
      "unread_count": 0,
      "last_message_preview": "string|null",
      "last_message_at": "iso_datetime|null"
    }
  ],
  "selected_thread": {
    "thread_id": "uuid|null",
    "thread_type_label": "string|null",
    "thread_status_safe_label": "string|null",
    "deadline_safe_label": "string|null"
  },
  "messages": [
    {
      "message_id": "uuid",
      "message_type": "text|file|system|request|reminder",
      "message_type_label": "string",
      "author_role": "office|client|system",
      "body": "string|object",
      "created_at": "iso_datetime"
    }
  ],
  "attachments": [
    {
      "attachment_id": "uuid",
      "message_id": "uuid",
      "file_asset_id": "uuid",
      "file_name": "string",
      "file_size_bytes": 0,
      "mime_type": "string",
      "download_allowed": true
    }
  ],
  "unread_count": 0,
  "attachment_permissions": {
    "can_upload": true,
    "allowed_mime_types": ["string"],
    "max_size_bytes": 0
  },
  "allowed_actions": [
    { "command": "send_client_message", "enabled": true, "reason": null },
    { "command": "attach_file_to_client_message", "enabled": true, "reason": null },
    { "command": "mark_thread_read_by_client", "enabled": true, "reason": null }
  ],
  "pwa_metadata": {
    "badge_count": 0,
    "push_enabled": false
  },
  "empty_states": {
    "threads": { "code": "no_threads", "title": "string", "description": "string" },
    "messages": { "code": "no_messages", "title": "string", "description": "string" }
  }
}
```

## 3.3 `docflow_admin_review_aggregate`

```json
{
  "aggregate_key": "docflow_admin_review_aggregate",
  "org_id": "uuid",
  "scope": {
    "module_key": "string|null",
    "generated_window": "string|null"
  },
  "pending_drafts": [
    {
      "review_item_id": "uuid",
      "message_id": "uuid",
      "thread_id": "uuid|null",
      "client_summary": {
        "client_id": "uuid",
        "display_name": "string",
        "client_code": "string|null"
      },
      "module_key": "string",
      "source_rule": {
        "rule_key": "string",
        "rule_label": "string",
        "rule_version": "string|null"
      },
      "generated_at": "iso_datetime",
      "message_preview": "string",
      "status": "draft|approved|sent|cancelled"
    }
  ],
  "skipped_clients": [
    {
      "client_id": "uuid",
      "display_name": "string",
      "reason_code": "string",
      "reason_label": "string"
    }
  ],
  "allowed_actions": [
    { "command": "edit_draft_message", "enabled": true, "reason": null },
    { "command": "publish_draft_message", "enabled": true, "reason": null },
    { "command": "send_office_message", "enabled": true, "reason": null },
    { "command": "cancel_draft_message", "enabled": true, "reason": null }
  ],
  "empty_states": {
    "pending_drafts": {
      "code": "no_pending_drafts",
      "title": "string",
      "description": "string"
    }
  }
}
```

## 3.4 `docflow_floating_widget_aggregate`

```json
{
  "aggregate_key": "docflow_floating_widget_aggregate",
  "org_id": "uuid",
  "entitlement_status": {
    "active": true,
    "code": "enabled|disabled|missing_plan",
    "label": "string"
  },
  "pending_suggestions_count": 0,
  "unread_count": 0,
  "active_client_context": {
    "client_id": "uuid|null",
    "display_name": "string|null",
    "module_key": "string|null"
  },
  "pending_messages": [
    {
      "message_id": "uuid",
      "thread_id": "uuid",
      "client_id": "uuid",
      "client_display_name": "string",
      "module_key": "string",
      "preview": "string",
      "created_at": "iso_datetime",
      "status": "draft|approved|sent|cancelled"
    }
  ],
  "allowed_actions": [
    { "command": "open_widget_context", "enabled": true, "reason": null },
    { "command": "edit_draft_message", "enabled": true, "reason": null },
    { "command": "send_office_message", "enabled": true, "reason": null },
    { "command": "cancel_draft_message", "enabled": true, "reason": null }
  ]
}
```

---

## 4) Allowed Actions Model

`allowed_actions` must be returned by aggregate and is authoritative for UI.

Example contract:

```json
{
  "allowed_actions": [
    { "command": "send_office_message", "enabled": true, "reason": null },
    { "command": "archive_client_thread", "enabled": false, "reason": "Thread must be resolved first" }
  ]
}
```

Rules:
- UI can only show/trigger actions from `allowed_actions`.
- UI must not infer missing actions.
- UI must show disabled reason when provided.

---

## 5) Office Aggregate Rules

- Office aggregate may include internal operational context needed for execution:
  - assigned user safe object
  - SLA indicator
  - operational status labels
- Office can see status controls only if `allowed_actions` enables related commands.
- No frontend status transition logic.
- No frontend SLA computation.

---

## 6) Client Aggregate Rules

- Client aggregate includes only scoped client data.
- No internal assignment identifiers.
- No audit/internal ownership fields.
- No office-only notes.
- Only safe labels and client-safe data.
- Client actions limited to:
  - `send_client_message`
  - `attach_file_to_client_message`
  - `mark_thread_read_by_client`

---

## 7) Rules / System Message Review Rules

- Rule engine creates draft/system outputs.
- Aggregate exposes pending drafts for accountant/reviewer.
- Reviewer can approve/send/cancel only through explicit commands.
- Frontend does not decide recipient targeting.
- Frontend does not evaluate rule conditions.

---

## 8) Floating Widget Rules

- Widget is visible only if aggregate says `entitlement_status.active = true`.
- Backend must still enforce entitlement for all widget-triggered commands.
- Widget does not create messages by itself.
- Widget triggers only commands present in aggregate `allowed_actions`.

---

## 9) Full Refresh Contract

After any successful command:

- backend returns refreshed aggregate
- office commands refresh `client_docflow_tab_aggregate`
- client commands refresh `client_portal_inbox_aggregate`
- rule/review commands refresh `docflow_admin_review_aggregate`
- widget commands refresh `docflow_floating_widget_aggregate`
- UI performs full replace (no partial merge)

---

## 10) Forbidden Patterns

Explicitly forbidden in frontend:

- frontend status mapping logic
- `statusToUi(...)`
- `TABLE_COLUMNS.match(...)`
- `if (column === ...)` style business mapping
- frontend unread calculation
- frontend SLA calculation
- hidden GET after command
- local optimistic business truth
- client-side filtering for unauthorized data
- stitched reads from multiple endpoints for one screen truth

---

## 11) Phase 5 Validation Checklist

- [x] all required aggregates defined
- [x] office aggregate defined
- [x] client portal aggregate defined
- [x] admin review aggregate defined
- [x] floating widget aggregate defined
- [x] JSON-like shapes included
- [x] `allowed_actions` model included
- [x] backend provides labels/statuses/SLA/unread
- [x] client aggregate hides internal data
- [x] full refresh contract defined
- [x] forbidden frontend patterns documented
- [x] UI remains dumb

---

Final confirmation:  
DocFlow read model contract is aggregate-only, backend-authored, tenant-safe, and frontend-dumb by design.

