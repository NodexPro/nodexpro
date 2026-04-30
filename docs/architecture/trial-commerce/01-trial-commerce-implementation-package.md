# Anti-Abuse Full-Platform Free Trial (Israel) — Implementation Package

**Document type:** Trial and legal-identity model for Israel (teudat zehut).  
**Depends on:** Module-based commerce (organization_module_subscriptions, module_plans, is_system). Frontend dumb; backend authoritative.

---

## 1. FINAL TRIAL + ANTI-ABUSE ARCHITECTURE SUMMARY

- **Rule:** **One teudat zehut = one full-platform free trial.** Not "one TZ = one user account forever". Same person may register again, create another organization, or use another email; they may not receive a second free trial for the same TZ. Trial is tied to owner identity (TZ hash), not to user, not to organization row.
- **Trial:** 2 months full-platform access to all commercial modules. Starts only after organization provides owner TZ. Anti-abuse: one legal_identity_hash = one trial ever (any org). Reuse attempt => blocked, message "trial already used".
- **Legal identity (Israel):** country_code = IL, legal_identity_type = 'tz'. Stored: **normalized** (9 digits, sensitive), **hash** (anti-abuse), **masked** (e.g. ***1234 for UI only). Raw TZ not stored. After trial start identity is **locked**; ordinary users cannot change it. Company Settings show read-only masked value.
- **Entitlement:** System modules always entitled and active. Commercial: (1) active paid organization_module_subscription => entitled, (2) valid org trial => trial, (3) else => not_entitled/expired.
- **After trial expiry:** Unpaid commercial modules **hard-blocked**. Data and org not deleted. Only paid module subscriptions remain usable. System modules stay available.
- **Activation:** Allowed if paid sub for that module OR valid full-platform trial. During trial, activation does not require per-module subscription.
- **Purchase after trial:** User selects modules, selects plans, pays (or mock); organization_module_subscription created; module can be activated again.

---

## 2. REQUIRED SCHEMA CHANGES / MIGRATIONS

**010_trial_legal_identity.sql**

- **organization_legal_identities:** id, organization_id, country_code, legal_identity_type, legal_identity_value_normalized (sensitive), legal_identity_hash, **legal_identity_masked** (text, for UI e.g. ***1234), is_primary, **is_locked** (boolean), **locked_at** (timestamptz nullable), created_at, updated_at. Unique(organization_id). **011_legal_identity_locked_masked.sql** adds masked, is_locked, locked_at.
- **organization_trials:** id, organization_id, legal_identity_hash (text), trial_scope (text, 'full_platform'), status (not_started, trialing, trial_expired, converted, blocked), started_at, ends_at, converted_at, expired_at, created_at, updated_at. Unique (organization_id, trial_scope). Index on legal_identity_hash.
- RLS: organization_legal_identities/organization_trials select by org member; insert/update by org member. Sensitive column legal_identity_value_normalized: do not expose in default API responses; do not include in audit payloads.
- **Decision:** No separate legal_identity_registry. Anti-abuse: any row in organization_trials with given legal_identity_hash means that identity has consumed a trial. Lookup: EXISTS (select 1 from organization_trials where legal_identity_hash = ? and trial_scope = 'full_platform').

**Raw value decision:** We do **not** store raw teudat zehut. We store only **legal_identity_value_normalized** (digits only for TZ, validated server-side) and **legal_identity_hash**. Normalized is marked sensitive: excluded from audit logs and from standard API responses. Frontend never receives normalized or raw; only "legal identity set: yes/no" and trial state.

---

## 3. TZ / LEGAL IDENTITY MODEL

- **Supported:** legal_identity_type = 'tz' (Israel teudat zehut). country_code = IL. Future: osek_murshe, company_number (deferred).
- **Normalize:** For 'tz': strip non-digits, validate exactly 9 digits. Reject otherwise.
- **Hash:** Secure one-way hash (SHA-256) of normalized value + type + server-side salt. Hash is the anti-abuse source of truth; used to enforce one trial per TZ.
- **Storage decision:** Raw TZ is **not** stored. Only **legal_identity_value_normalized** (9 digits) and **legal_identity_hash** are stored. Normalized is marked sensitive: never in audit payloads, never in API responses to frontend. Prefer hash for all anti-abuse checks.
- **One primary per org:** One row per organization_id (unique). Represents the owner/legal identity used for trial eligibility.
- **Masked value:** Stored for UI only (e.g. ***1234, last 4 digits). Returned in Company Settings owner-identity view; never full TZ.
- **Exposure:** Normal API returns hasLegalIdentity and trial state. GET owner-identity returns type, masked, isLocked, lockedAt, message only.

---

## 4. IMMUTABLE OWNER IDENTITY MODEL

- **Lock after trial start:** When trial is successfully started, backend sets is_locked = true, locked_at = now(), and legal_identity_masked on organization_legal_identities. Identity cannot be changed by ordinary users after that.
- **Reject edits:** POST legal-identity must check hasLockedLegalIdentity(organizationId). If true, return 400 "Owner identity is locked and cannot be changed".
- **Company Settings:** Display owner identity as read-only: type (TZ), masked value (***1234), status Locked, message "This identity cannot be changed after trial activation." No edit button.
- **Admin override:** DEFERRED. An admin-only emergency override to change locked identity is not in normal UI; only backend/system admin flow; must be audited. Document when implementing.

---

## 5. TRIAL MODEL

- **Eligibility:** Before starting trial, organization must provide owner identity: country_code = IL, legal_identity_type = 'tz', teudat zehut of account/business owner. Backend normalizes TZ, creates secure hash, checks if this hash has already used a full-platform trial.
- **Start:** If hash not used: create organization_trial (status = trialing, started_at = now(), ends_at = now() + 2 months). All commercial modules become trial-entitled. If hash already used: deny trial, status = blocked, return "trial already used"; require paid module selection.
- **Scope:** trial_scope = 'full_platform' only.
- **Status:** trialing, trial_expired, converted, blocked. (not_started optional placeholder.)
- **One TZ = one trial:** Check: EXISTS (select 1 from organization_trials where legal_identity_hash = ? and trial_scope = 'full_platform'). If true => block; do not create second trial.
- **Conversion:** converted_at optional (analytics). Entitlement is driven by trial end date and paid subscriptions only.

---

## 6. ENTITLEMENT MODEL

- **System module:** Always entitled. No trial check.
- **Commercial module:**
  1. If active organization_module_subscription (status active, ends_at not past) for this module => **entitled**.
  2. Else if valid organization trial (organization_trials.status = 'trialing', ends_at > now(), trial_scope = 'full_platform') for this org => **trial**.
  3. Else => **not_entitled** or **expired** (e.g. trial ended or no subscription).

Order: paid first, then trial, then not entitled.

---

## 6b. ACTIVATION MODEL

- **System module:** Always active; deactivate forbidden.
- **Commercial module:** Activation allowed if:
  - (A) Has active organization_module_subscription for this module, OR
  - (B) Has valid organization trial (trialing, ends_at > now()).
- When (B): organization_modules.organization_module_subscription_id may be null (trial-activated). When (A): set as today.
- Deny activation when no paid sub and no valid trial.

---

## 6c. TRIAL EXPIRY MODEL

- **Definition:** ends_at < now() => trial no longer valid for entitlement.
- **Behavior:** Hard block. Unpaid commercial modules become inaccessible (entitlement = not_entitled/expired). No read-only mode. Data not deleted.
- **Update status:** Optional job or on-demand: set organization_trials.status = 'trial_expired' where status = 'trialing' and ends_at < now(). Entitlement resolver uses ends_at directly so status update is for consistency only.

---

## 6d. MODULE PURCHASE FLOW AFTER TRIAL

- After trial expires: user sees module catalog, selects module, selects module plan, pays (or mocked payment contract). Backend creates/updates active organization_module_subscription. Module can be activated and used again.
- During trial: user can also select plan and pay; those paid subscriptions remain after trial ends.
- Flow unchanged: POST select-plan → organization_module_subscription (mock: active). Activate when entitled (paid or trial). No conversion step required for entitlement.

---

## 7. COMPANY SETTINGS READ-ONLY SPEC

- **Section:** Owner identity. Shown only when organization has a legal identity record.
- **Content (backend-driven):** Owner identity type (e.g. Teudat Zehut (TZ)), Owner Teudat Zehut: ***1234 (masked), Status: Locked, message: "This identity cannot be changed after trial activation."
- **No edit action:** Locked identity is read-only; no edit button for normal users.
- **API:** GET /organizations/:id/owner-identity returns { legalIdentityType, countryCode, masked, isLocked, lockedAt, message }. No raw, normalized, or hash.

---

## 8. BACKEND API CONTRACTS

- **POST /organizations/:id/legal-identity** — Submit owner TZ to start trial. Body: { countryCode, legalIdentityType, value }. Backend normalizes, validates, hashes, checks prior trial use; if not locked and not blocked: saves identity, starts trial, then locks identity and sets masked. Returns { success, trialStarted, trialEndsAt?, blocked?, message }. If identity already locked: 400 "Owner identity is locked and cannot be changed". No raw TZ in response. Permission: modules:write.
- **GET /organizations/:id/trial** — Trial state: { hasLegalIdentity, trialStatus, startedAt?, endsAt?, blocked }. Permission: subscriptions:read.
- **GET /organizations/:id/owner-identity** — Read-only owner identity for Company Settings: { legalIdentityType, countryCode, masked, isLocked, lockedAt, message }. Empty object if none. Permission: subscriptions:read (or settings:read).
- **GET /organizations/:id/modules/state** — { trialState, modules }. Existing: select-plan, change-plan, activate, deactivate unchanged.

---

## 9. FRONTEND UI SPEC

- **Trial start flow:** User sees "Start free 2‑month trial"; must enter owner Teudat Zehut (9 digits). Submit to POST legal-identity. Do not store or display raw TZ after submit.
- **If trial available:** Trial starts; banner "Free trial active until &lt;date&gt;". All commercial modules visible and usable.
- **If trial already used for this TZ:** Backend returns blocked; UI shows "Free trial was already used for this identity." User can buy modules directly.
- **After trial expires:** "Trial ended. Choose and pay for the modules you want to continue using."
- **Company Settings:** Read-only section "Owner identity" when data exists: Owner Teudat Zehut: ***1234, Status: Locked, "This identity cannot be changed after trial activation." No edit button.
- **System modules:** Visible, gray, disabled, label "System module". No purchase/activate/deactivate actions.
- **Per commercial module:** Plans, subscription, activation, Select plan / Activate / Deactivate from backend only.
- Frontend remains dumb: no trial or anti-abuse logic; only render backend state.

---

## 10. SECURITY MODEL FOR TZ

- **Do not use raw TZ as public identifier.** Never in URLs, public IDs, or logs.
- **Do not log raw TZ in audit payloads.** Events (organization_legal_identity_set, trial_start_blocked, etc.) may include country_code, legal_identity_type; must not include raw or normalized TZ.
- **Do not expose raw TZ in frontend after submission.** API never returns legal_identity_value_normalized or hash. Only hasLegalIdentity and trial state.
- **Normalize TZ before validation and hashing.** Server-side only; 9 digits.
- **Use secure hash of normalized TZ for anti-abuse.** Hash is source of truth for "one TZ = one trial". Salt from env; SHA-256.
- **If normalized value is stored:** Column marked sensitive; RLS and app code restrict access; never in audit or API response. Prefer using hash for all anti-abuse checks.
- **Decision:** Raw TZ is not stored. Store normalized (9 digits) + hash + masked (***1234 for UI). UI gets masked value only after save; never full TZ.

---

## 11. AUDIT EVENT CATALOG

- **organization_legal_identity_set** — Legal identity set for org. Payload: countryCode, legalIdentityType only; no raw TZ.
- **organization_legal_identity_locked** — Identity locked after trial start. No value in payload.
- **trial_started** — Full-platform trial started. Payload: endsAt.
- **trial_start_blocked** — Trial denied (TZ already used). Payload: reason: duplicate_legal_entity. No TZ in payload.
- **trial_expired** — Trial ended (optional; entitlement uses ends_at).
- **trial_converted** — Optional analytics.
- **module_access_via_trial** — Module activated/used via trial (no paid sub).
- **module_access_denied_after_trial** — Access to commercial module denied after trial expired (unpaid).
- **module_paid_subscription_created** / **module_paid_subscription_changed** — Existing.
- **system_module_protected** — Deactivate/other action on system module rejected.

---

## 12. DEFERRED DECISIONS

- Read-only mode for unpaid modules after trial: deferred; current = hard block.
- Proration and invoice generation: deferred.
- legal_identity_type osek_murshe, company_number: deferred.
- Automatic status update to trial_expired: deferred; entitlement uses ends_at.
- **Admin-only emergency override** for locked owner identity: not in normal UI; only backend/system admin flow; must be audited. Document when implementing.

---

## 13. DEFINITION OF DONE

- [ ] Migrations 010 and 011 applied (organization_legal_identities with masked, is_locked, locked_at; organization_trials).
- [ ] Legal identity: normalize (tz), hash, mask (***1234); reject set if locked; lock and set masked after trial start.
- [ ] Trial service: start (block if hash reused), get state; entitlement uses ends_at.
- [ ] Entitlement: paid sub => entitled; valid trial => trial; else not_entitled/expired.
- [ ] Activation: allow when paid sub OR valid trial.
- [ ] GET modules/state includes trialState. POST legal-identity; GET trial; GET owner-identity for Settings.
- [ ] Frontend: trial flow with TZ input; trial banner/ended/blocked; Company Settings read-only owner identity (masked, locked); no edit for locked TZ.
- [ ] Audit: organization_legal_identity_set, organization_legal_identity_locked, trial_started, trial_start_blocked, etc.; no raw TZ in payloads.

---

## 14. QA CHECKLIST

1. Set legal identity => trial starts, ends_at = now + 2 months; identity locked and masked stored.
2. Same TZ in second org => trial_start_blocked, no trial.
3. POST legal-identity when already locked => 400 "Owner identity is locked and cannot be changed".
4. Company Settings show read-only Owner Teudat Zehut: ***1234, Status: Locked; no edit button.
5. During trial: commercial module activatable without paid plan; entitlementStatus = trial.
6. After trial ends: unpaid modules not activatable; paid modules still accessible.
7. System modules always active; deactivate system => 403, audit.
8. No raw/normalized TZ in audit logs or API response; GET owner-identity returns only masked.

---

## 15. ARCHITECTURAL PROHIBITIONS

- Tying trial only to email, only to user, or only to organization row.
- Allowing repeated free trial for the same teudat zehut.
- **Allowing editable TZ after trial activation** (normal users must not change locked identity).
- Exposing raw TZ in frontend after save.
- Logging raw TZ in audit.
- Deciding trial eligibility in frontend.
- Allowing system modules to behave like purchasable modules (sell, deactivate).
- Deleting organization or module data when trial ends.
- Rule "one TZ = one user account forever" — forbidden. Only "one TZ = one full-platform free trial".

---

## 16. EXACT DELIVERABLES

- This doc; migrations 010_trial_legal_identity.sql, 011_legal_identity_locked_masked.sql.
- legal-identity.service.ts: normalize, validate, hash, mask (***1234), hasLockedLegalIdentity, setLegalIdentity (reject if locked), lockAndSetMasked, getOwnerIdentityForSettings.
- trial.service.ts; entitlement.service.ts (trial-aware); activation.service.ts (allow trial); modules-state.service.ts (trialState).
- Routes: GET trial, POST legal-identity (lock + set masked after trial start), GET owner-identity.
- Audit: organization_legal_identity_set, organization_legal_identity_locked, trial_started, trial_start_blocked; no raw TZ in payloads.
- Frontend: trial flow (TZ input, banner, trial ended/blocked); Settings page read-only Owner identity section (masked, locked, no edit).
