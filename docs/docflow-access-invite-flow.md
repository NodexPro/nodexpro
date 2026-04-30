# DocFlow Phase 3 - Access / Invite Flow (Design Only)

Status: Design contract only.  
No code, no migrations, no API, no services, no UI implementation.

Context contract:
- Core -> Commands -> Aggregate -> UI
- frontend is dumb
- writes only through commands
- reads only through aggregates
- tenant-safe scoping is mandatory

---

## 1) Access Model (Core Rule)

- `client_portal_user` is **not** a Core platform user.
- It is a separate identity type for DocFlow client portal only.
- Every portal identity is always scoped to:
  - `org_id`
  - `client_id`
- Client portal identity cannot access:
  - other clients
  - office/internal organization data
  - other modules not explicitly exposed in client DocFlow aggregate
- Access scope is limited to DocFlow client portal context only.

---

## 2) Invite Flow (Step by Step)

## Office side flow

1. Office user triggers invite via explicit backend command.
2. Backend validates office permissions and tenant ownership (`org_id`, `client_id`).
3. System creates invitation record.
4. System generates secure invite token.
5. Raw token is returned only to delivery pipeline (email/SMS channel is out of scope here).
6. Invitation link is sent externally (mechanism out of scope, flow defined).

## Client side flow

1. Client opens invite link containing invite token.
2. Backend validates token (hash lookup + status + expiry + scope).
3. Backend activates access:
   - create `client_portal_user` if missing, or
   - bind invitation to existing portal user for same (`org_id`,`client_id`).
4. Backend marks invitation as accepted/consumed.
5. Backend creates scoped session.
6. Client is redirected into DocFlow client portal.

Flow constraints:
- token must be time-limited
- token must be one-time use (consumed on successful acceptance)
- expired/revoked/consumed tokens are never reusable

---

## 3) Token Model

- `invite_token` is generated as high-entropy secret.
- Raw token is never persisted.
- Persisted value: `invite_token_hash` only.
- Required token properties:
  - expiry (`token_expires_at`)
  - status (`pending` / `accepted` / `expired` / `revoked`)
  - one-time consumption semantics
- Replay attack prevention (conceptual):
  - accepted token immediately invalidated for future validation
  - revoked/expired token always rejected
  - optional anti-replay nonce/fingerprint policy may be added later

---

## 4) Portal User Mapping

Portal user lifecycle policy (explicit for Phase 3):
- Policy: **one portal user per (`org_id`,`client_id`) identity boundary**.
- Invitation is bound to exactly one (`org_id`,`client_id`) scope.
- On acceptance:
  - if scoped portal user exists, invitation binds to it;
  - otherwise scoped portal user is created.
- No cross-client access under same email without separate explicit invite mapping.
- Core RBAC is not reused for portal identity.

---

## 5) Session Model

- Session is created only after successful invite activation/validation.
- Session is scoped to `org_id + client_id`.
- Session token is stored as hash only.
- Session has explicit expiration (`expires_at`).
- Optional refresh token is allowed (stored hashed if used).
- Session status lifecycle: `active` -> `revoked` / `expired`.
- Session invalidation can be triggered by revoke/reset commands.

---

## 6) Revoke / Reset Flow (Conceptual Commands)

Conceptual command names:
- `revoke_client_portal_access`
- `reset_client_portal_access`

## Revoke semantics

- Immediate access block for scoped portal identity.
- All active sessions for scoped (`org_id`,`client_id`) portal user are invalidated.
- Portal user status updated (e.g., `revoked`).
- Any non-consumed invitations in same scope should be revoked.

## Reset semantics

- Existing portal access state is invalidated (sessions revoked, prior invite unusable).
- New invitation flow is required for re-entry.
- Reset does not imply access until a new invite is accepted.

---

## 7) Security Rules (Mandatory)

- Every request must validate ownership scope:
  - `org_id` always
  - `client_id` always for portal access
- No access without invitation-based activation.
- No public endpoint may return DocFlow data.
- No raw tokens are stored.
- Cross-tenant or cross-client access is structurally forbidden by scope checks.
- File access for attachments must enforce same (`org_id`,`client_id`) scope checks.

---

## 8) Rate Limiting / Abuse Protection (Conceptual)

Minimum baseline model:
- Limit invite attempts per client per time window.
- Limit token validation attempts per token/IP/time window.
- Limit login/session creation attempts per identity/IP.
- Basic anti-spam guardrails for client message submissions:
  - message frequency thresholds
  - burst limits
  - temporary cool-down behavior

Exact numeric thresholds are policy-level and out of scope for this phase.

---

## 9) Client Experience (High Level)

- Client receives secure invite link.
- Client opens link and activates access.
- Client lands in DocFlow client portal.
- Client cannot access office UI.
- Client cannot access other modules unless explicitly exposed in future contracts.

---

## 10) Audit Events

Required auditable events:
- `invitation_created`
- `invitation_sent` (optional if delivery integration exists)
- `invitation_accepted`
- `invitation_revoked`
- `portal_access_revoked`
- `session_created`
- `session_revoked`
- `failed_login_attempt`

Audit requirement:
- All critical identity/access actions must be auditable with actor, scope (`org_id`,`client_id`), timestamp, and action outcome.

---

## 11) Hard Rules

- no reuse of Core auth system for portal identity
- no shared identity with office users
- no client access without invite
- no direct login without invitation (unless explicitly approved in future phase)
- no frontend auth logic
- no PATCH
- no insecure token handling

---

## 12) Phase 3 Validation Checklist

- [x] `client_portal_user` is separate identity
- [x] invite flow fully defined
- [x] token model secure (hash, expiry, one-time)
- [x] portal user mapping defined
- [x] session model defined
- [x] revoke/reset flow defined
- [x] security rules defined
- [x] rate limiting defined
- [x] audit events defined
- [x] no Core auth reuse
- [x] tenant isolation enforced

---

Final confirmation:  
DocFlow client access is invitation-scoped, tenant-safe, and isolated from Core user identity.

