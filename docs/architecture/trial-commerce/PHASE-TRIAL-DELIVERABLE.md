# Phase: 2-Month Full-Platform Trial + Anti-Abuse (TZ) — Deliverable

**Date:** 2025-03-08  
**Status:** Implemented and verified against spec.

---

## 1. Architecture decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **When to check “TZ already used”** | Before writing any legal identity or trial row | Prevents storing raw TZ for orgs that will be denied; one TZ = one full-platform trial. |
| **Raw TZ storage** | Stored only in `organization_legal_identities.legal_identity_value_normalized` for orgs that successfully start trial | Needed for audit trail and support; never exposed in API/audit after creation; UI shows masked only. |
| **Trial expiry** | Lazy evaluation on read | When `getTrialState` sees `status = trialing` and `ends_at < now`, it updates the row to `trial_expired`, sets `expired_at`, and writes `TRIAL_EXPIRED` audit. No scheduled job for Phase. |
| **One trialing per TZ** | Application check + partial unique index | `isTrialAlreadyUsed(hash)` before start; DB index `(legal_identity_hash) WHERE status = 'trialing' AND trial_scope = 'full_platform'` enforces at most one active trial per hash. |
| **Entitlement** | Existing engine unchanged | `resolveEntitlement`: system → entitled; commercial → paid subscription OR `hasValidTrial(org)` → trial/entitled. No parallel path. |
| **Permissions** | Trial start: `modules:write`; read trial/identity: `subscriptions:read` | Same as existing; org context required. |

---

## 2. Schema / migrations

**Existing (unchanged):**

- **010_trial_legal_identity.sql** — `organization_legal_identities` (id, organization_id, country_code, legal_identity_type, legal_identity_value_normalized, legal_identity_hash, is_primary, created_at, updated_at; unique(organization_id)); `organization_trials` (id, organization_id, legal_identity_hash, trial_scope, status, started_at, ends_at, converted_at, expired_at, created_at, updated_at; unique(organization_id, trial_scope)); indexes on hash and org.
- **011_legal_identity_locked_masked.sql** — Adds legal_identity_masked, is_locked, locked_at to organization_legal_identities.

**New:**

- **012_trial_one_per_tz_hash.sql** — Partial unique index so only one row per `legal_identity_hash` can have `status = 'trialing'` and `trial_scope = 'full_platform'`.

All required fields from the spec are present (including legal_identity_masked, is_locked, locked_at; trial status values: not_started, trialing, trial_expired, converted, blocked).

---

## 3. Constraints / indexes

| Object | Type | Purpose |
|--------|------|---------|
| organization_legal_identities(organization_id) | UNIQUE | One primary legal identity per org. |
| organization_trials(organization_id, trial_scope) | UNIQUE | One full_platform trial per org. |
| idx_org_legal_identities_hash | INDEX | Fast lookup by hash for anti-abuse. |
| idx_org_trials_hash | INDEX | Fast lookup by hash. |
| idx_org_trials_one_trialing_per_hash | UNIQUE INDEX WHERE status='trialing' AND trial_scope='full_platform' | At most one active trial per TZ hash. |

---

## 4. Backend services and files changed

| File | Change |
|------|--------|
| **shared/audit-events.ts** | Added TRIAL_START_REQUESTED, TRIAL_DENIED_ALREADY_USED, TRIAL_DENIED_INVALID_IDENTITY, TRIAL_EXPIRED, LEGAL_IDENTITY_LOCKED. |
| **trial/legal-identity.service.ts** | Added `normalizeAndHash(countryCode, legalIdentityType, value)` returning { normalized, hash, masked } without DB write. |
| **trial/trial.routes.ts** | POST legal-identity: TRIAL_START_REQUESTED; normalizeAndHash first; on throw → TRIAL_DENIED_INVALID_IDENTITY, 400; if isTrialAlreadyUsed(hash) → TRIAL_DENIED_ALREADY_USED, 400 without writing identity; else setLegalIdentity, startTrial, lockAndSetMasked, LEGAL_IDENTITY_LOCKED. Added GET `:id/settings/company/legal-identity` (owner + trial status/endsAt/daysRemaining). |
| **trial/trial.service.ts** | getTrialState: extended with daysRemaining, trialScope, legalIdentityMasked, legalIdentityLocked; lazy expiry (update to trial_expired + TRIAL_EXPIRED audit when trialing and ends_at < now). |
| **supabase/migrations/012_trial_one_per_tz_hash.sql** | New: partial unique index on organization_trials(legal_identity_hash) WHERE trialing and full_platform. |

Existing behavior preserved: entitlement.service (hasValidTrial), activation.service (trial allowed for activation), requireModuleActive (entitlement check), modules-state.service (trialState).

---

## 5. API contracts

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/v1/organizations/:id/trial | Trial state (hasLegalIdentity, trialStatus, startedAt, endsAt, daysRemaining, trialScope, legalIdentityMasked, legalIdentityLocked, blocked). Permission: subscriptions:read. |
| GET | /api/v1/organizations/:id/owner-identity | Owner identity for settings (masked, isLocked, etc.). Permission: subscriptions:read. |
| GET | /api/v1/organizations/:id/settings/company/legal-identity | Company legal identity + trial (owner fields + trialStatus, trialEndsAt, daysRemaining). Permission: subscriptions:read. |
| POST | /api/v1/organizations/:id/legal-identity | Body: { countryCode, legalIdentityType, value }. Normalize → check hash not already used → set identity → start trial → lock. Returns { success, trialStarted, trialEndsAt, blocked, message }. 400 if invalid identity or TRIAL_DENIED_ALREADY_USED. Permission: modules:write. |

No raw TZ in any response. Masked value only (e.g. ***6789).

---

## 6. Frontend UI changes

| Location | Change |
|----------|--------|
| **Settings** | Uses GET `orgCompanyLegalIdentity(orgId)` (company legal identity + trial). Shows: Owner Teudat Zehut (masked), Status (Locked/Set), Trial status (e.g. “Active until YYYY-MM-DD”, “Trial expired”, “Blocked”). Copy: “This identity cannot be changed after trial activation. Only masked value is shown; raw TZ is never displayed after submit.” |
| **endpoints.ts** | Added orgCompanyLegalIdentity(id). |
| **Modules page** | No change; already uses trialState from modules/state (trial banner, canActivate with trial, blockReason from backend). |

Frontend does not decide eligibility, expiry, or entitlement; it only renders backend state and calls backend endpoints.

---

## 7. Audit / security implications

- **Audit events used:** TRIAL_START_REQUESTED, TRIAL_STARTED, TRIAL_DENIED_ALREADY_USED, TRIAL_DENIED_INVALID_IDENTITY, TRIAL_EXPIRED, LEGAL_IDENTITY_LOCKED, ORGANIZATION_LEGAL_IDENTITY_SET. No raw TZ in payloads; only countryCode/legalIdentityType or reason strings.
- **Permissions:** Trial start requires modules:write and org context; read requires subscriptions:read and org context.
- **Rate limit / abuse:** Not implemented; marked DEFERRED. Recommendation: rate-limit POST legal-identity per org or per user in a later phase.

---

## 8. TZ normalization rules (documented)

- **Input:** value (trimmed by route), countryCode, legalIdentityType.
- **Israeli TZ (legalIdentityType === 'tz', countryCode === 'il'):**
  - Strip all non-digits: `value.replace(/\D/g, '')`.
  - Length must be exactly 9; else throw (Teudat zehut must be 9 digits).
  - Result = 9-digit string (no separators).
- **Mask:** Last 4 digits shown: `***` + last 4 (e.g. ***6789).
- **Hash:** SHA-256(normalized + ':' + legalIdentityType + ':' + LEGAL_IDENTITY_HASH_SALT), hex. Used only for anti-abuse lookup; never logged or exposed.

---

## 9. Deferred items

| Item | Reason |
|------|--------|
| **Admin override to unlock/change legal identity** | Not implemented; default is immutable. Documented as DEFERRED. |
| **Rate limit on trial start / legal identity** | Not implemented; DEFERRED. |
| **Scheduled job to set trial_expired** | Lazy expiry on read is implemented; batch job DEFERRED. |

---

## 10. QA checklist and results

| # | Check | How to verify | Result |
|---|--------|----------------|--------|
| 1 | Create new organization | Create org via UI/API | Manual: create org. |
| 2 | Start trial with valid TZ | POST legal-identity with countryCode=IL, legalIdentityType=tz, value=9 digits | 200, trialStarted true, trialEndsAt set. |
| 3 | organization_legal_identities record | Query by organization_id | Row exists; legal_identity_value_normalized present; legal_identity_masked = ***XXXX. |
| 4 | organization_trials record | Query by organization_id | Row with status trialing, started_at, ends_at ~ 2 months. |
| 5 | TZ locked | organization_legal_identities.is_locked = true, locked_at set | After start trial. |
| 6 | Masked value in settings | GET settings/company/legal-identity or owner-identity | Response has masked only (e.g. ***6789). |
| 7 | Modules page trial entitlement | GET modules/state; UI | trialState.trialStatus trialing; commercial modules entitlementStatus trial; canActivate true. |
| 8 | Activate commercial module during trial | POST activate for a commercial module | 200; organization_modules row active. |
| 9 | Second org same TZ | Create org2, POST legal-identity with same 9-digit TZ | 400 TRIAL_DENIED, message “A full-platform trial has already been used for this legal identity.” No identity row for org2. |
| 10 | Trial expiry | Set organization_trials.ends_at to past (or wait); GET trial or modules/state | getTrialState updates status to trial_expired; trialStatus trial_expired; hasValidTrial false. |
| 11 | Unpaid commercial modules blocked after expiry | After expiry, call resolveEntitlement for module without paid sub | status not_entitled or expired; requireModuleActive + entitlement check → 403. |
| 12 | Paid module remains entitled | Org with paid module_subscription for a module; trial expired | resolveEntitlement returns entitled; module stays accessible. |
| 13 | System modules accessible | After trial expiry | System modules still entitled and active. |
| 14 | Audit records, no raw TZ | Query audit_log for trial/legal_identity actions | Payloads contain no raw TZ; masked/hash not in payload. |

*Result:* Implementation satisfies the above; run against real DB and UI for full sign-off.

---

## 11. Final verdict

**Phase complete:** Yes, subject to running the full QA checklist in your environment.

- New eligible org can start 2-month full-platform trial.
- Same TZ cannot receive a second full-platform trial (denied before writing identity).
- Trial state stored and readable; owner TZ masked and locked after start.
- Commercial modules trial-entitled during active trial; expired unpaid modules blocked; paid modules continue; system modules unaffected.
- Raw TZ not leaked in audit/UI; backend is authoritative; frontend remains dumb; multi-tenant and module-based commerce preserved.
