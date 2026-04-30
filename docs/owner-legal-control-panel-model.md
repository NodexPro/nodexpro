# Owner Legal Control Panel Access Model

Status: Documentation-only contract.  
No code, no API, no DB migration, no UI implementation in this step.

Scope:
- Defines access model for Owner Legal Control Panel.
- Defines identity, authentication, recovery, and audit requirements.
- Defines owner metadata notes contract for legal/system values.
- Does not change tenant/module runtime behavior yet.

Implementation note (Prompt 1 - Core/owner access preparation):
- Core now has configured platform owner identity placeholders (`email`, `phone`, `password hash placeholder`, `access key placeholder`) and internal `assertPlatformOwner(ctx)` guard.
- Platform owner access remains separated from tenant organization roles.

---

## 1) Access boundary

Owner Legal Control Panel is **platform-owner-only**.

Hard rules:
- Not tenant RBAC.
- Not organization role based.
- No normal organization role may access this page.
- No client data can be changed from this page.
- Only `platform_owner` / product owner may execute legal value, ruleset, pricing, owner note, and country pack management commands.
- Tenant roles (`owner`, `admin`, `staff`, `viewer`) must never be allowed to change legal values or country rules.

This page is governance-only for legal values/rulesets/country-pack platform controls.

---

## 2) Authorization model

Access is granted only when all platform-owner conditions pass:

1. Owner email is explicitly configured in platform configuration.
2. Owner account has password configured.
3. Owner account has phone number configured.
4. Request is authenticated by one of allowed owner authentication methods.

Organization user identity (owner/admin/staff/viewer) must not grant access here.

---

## 3) Owner bootstrap (first setup)

On first owner setup:

1. System stores configured allowed owner email.
2. Owner sets password.
3. Owner sets phone number.
4. System generates private owner access key.
5. System records audited bootstrap event(s).

Generated private access key is owner-only credential and must never be shown to non-owner users.

---

## 4) Login methods (future behavior)

Owner may authenticate by any approved method:

1. `email + password`
2. `private owner access key`
3. `SMS code` sent to owner phone

All methods are only valid for the configured platform owner identity.

---

## 5) Recovery flow (forgot access key/password)

Recovery entry:
- owner provides phone number

Recovery action:
- system sends a **new one-time 7-digit code**

Recovery code requirements:
- unique per request
- expiring code (time-limited validity)
- single-use semantics

Recovery completion:
- verified code allows secure reset/update of forgotten credential(s)
- recovery attempt and outcome must be audited

---

## 6) Owner profile updates

Owner may update:
- email
- password
- phone number

Update constraints:
- updates apply only to platform owner identity
- each update must require authenticated owner session
- high-risk updates should require re-verification (policy details TBD in implementation)

---

## 7) Audit requirements

Every login and every sensitive change must be audited.

Minimum audited events:
- owner login success
- owner login failure
- owner bootstrap completed
- owner access key generated/rotated
- owner recovery requested
- owner recovery code sent
- owner recovery completed/failed
- owner email changed
- owner password changed
- owner phone changed
- unauthorized access attempt to owner panel

Minimum audit fields:
- actor identity
- timestamp
- event type
- method used (password/key/sms/recovery)
- result (success/failure)
- reason/error category (when failed)
- request context metadata (safe, non-secret)

---

## 8) Explicit prohibitions

Forbidden:

1. Using organization RBAC to grant Owner Legal Control Panel access.
2. Allowing any org user to open/manage this panel.
3. Treating tenant role as equivalent to platform owner.
4. Updating client data from this panel.
5. Exposing private owner access key in logs/audits/plain responses.
6. Allowing unaudited authentication or profile changes.

---

## 9) Relation to Country Pack governance

Owner Legal Control Panel manages:
- country packs activation governance
- rulesets lifecycle operations
- legal values and their versions

Modules/tenants consume resolved outputs only and do not gain owner privileges.

---

## 10) Owner notes for legal/system values

Each legal value definition/version must support owner-facing metadata:

- `owner_note`: private platform-owner note
- `usage_hint`: explanation of where/how the value is used
- `module_scope`: module/domain area that consumes the value
- `category`: one of:
  - `VAT`
  - `Income Tax`
  - `National Insurance`
  - `Credit Points`
  - `Pricing`
  - `Reports`
  - `Calendar`
  - `Modules`

Rules:

1. `owner_note` is informational only and must never affect calculations.
2. `owner_note` is visible to platform owner only.
3. `owner_note` is never visible to client/tenant users.
4. Owner Panel must display `owner_note` next to the value/version it describes.
5. `owner_note` create/update/delete events must be audited.
6. `usage_hint`, `module_scope`, and `category` are governance metadata and must not be treated as financial truth.

Minimum additional audit events:
- legal value owner note added
- legal value owner note updated
- legal value owner note removed

---

## 11) UNKNOWN (must be decided at implementation)

1. UNKNOWN: SMS provider integration details.
2. UNKNOWN: secure storage mechanism for private owner access key.
3. UNKNOWN: exact expiry policy for one-time 7-digit recovery code (TTL, retries, lockout).
4. UNKNOWN: key rotation and revocation policy.
5. UNKNOWN: step-up verification policy for high-risk profile changes.
6. UNKNOWN: brute-force/rate-limit thresholds for owner auth and recovery endpoints.

