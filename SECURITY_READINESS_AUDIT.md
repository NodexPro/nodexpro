# NodexPro — Full Security & Confidential Data Readiness Audit

**Date:** 2026-10-22  
**Auditor role:** application security architect / defensive review (repository + limited live health/headers)  
**Scope:** entire first-party NodexPro platform in this repository  
**Method:** audit-first. No production RLS changes, no CSP enforcement change, no migrations, no secret rotation, no deploy. Unrelated dirty WIP was left unstaged.

**This document is not a certification.** TypeScript builds, unit tests, `authMiddleware`, and `ENABLE ROW LEVEL SECURITY` statements are **not** treated as proof that the product is safe for real client data.

---

## 0. Executive assessment

NodexPro has a real Core security spine: Supabase Auth JWTs, organization membership checks on `X-Organization-Id`, named commands in several domains, Teudat Zehut checksum + hashing for trial identity, magic-byte upload guards, Accounting Base write permissions, and a fail-closed internal cron secret.

That spine is **not sufficient** for confidential production data.

Isolation is enforced in application code while the API uses the **service role** (RLS never applies to backend queries). Defense-in-depth RLS still keys off **legacy** `organization_users`, and many tenant tables still have **authenticated write policies**. Suspended users remain authorized on APIs. There is no MFA. Office sessions live in `localStorage`. Teudat Zehut is stored **normalized in plaintext**. There is **no evidence** of tested backups, erasure, or incident response.

**Confidential-data readiness: NOT READY.**

Several production dashboard settings (live grants, storage policies, env values, Supabase PITR) remain **NOT VERIFIED**. Those unknowns do not upgrade the decision to READY.

---

## 0.1 Baseline inventory

| Surface | Evidence |
|---|---|
| WEB | `apps/web` React/Vite, Vercel. Live `https://www.nodexpro.com` assets `index-IGcXPb_J.js` / `index-DX5S82ZR.css` (security WEB SHA `5f649e04`). CSP **Report-Only** confirmed live. `https://app.nodexpro.com` returned **HTTP 500** during this audit. |
| API | `apps/api` Express. Production Render `https://nodexpro.onrender.com`. Health `deploy_marker=153556c72350d34275f3ad6af3dffdd6b6d30ab9` (`fix: validate registration identity requirements`). |
| Auth | Supabase Auth (GoTrue). Browser uses anon key. API validates via `auth.getUser(token)`. |
| Database | Supabase Postgres. ~166 `public` tables, ~164 with RLS in migrations. Backend: `supabaseAdmin` service role (`apps/api/src/db/client.ts`). |
| Storage buckets (repo) | `client-files`, `document-files`, `organization-assets`, `income-documents` created `public: false`. **No `storage.objects` policies in repo.** |
| Domains | auth, organizations, memberships/RBAC, clients, documents, dashboard, modules, client-operations, trial, organization-settings, owner/country-pack, docflow, work-engine, income, accounting-base |
| External integrations | Supabase, Vercel, Render, Resend, Twilio, Puppeteer/Chrome. **No first-party Stripe.** |
| CI | `.github/workflows/architecture-enforcer.yml` (static). Schedulers hit **production** API (`main.yml`, `work-engine-scheduler.yml`). No deploy workflow. |
| Dev vs prod | `nodexpro-dev` is **not** in repo docs. Isolated WEB worktrees are an operator convention, not an environment. |

**Git HEAD at audit start:** `153556c72350d34275f3ad6af3dffdd6b6d30ab9`  
**WEB / API compatibility:** YES for current live pair (WEB `5f649e04` commands exist on API `153556c7`; API is ahead only by Teudat Zehut checksum).  
**Uncommitted WIP:** preserved (Login extras, Owner Legal Control, Income/Work Engine, dist, migrations 140–163, `New folder`, `apps/nodexpro-web-deploy`).

**Existing security controls already present (do not duplicate):**

- Registration/login rate limits (`apps/api/src/middleware/rate-limit.ts`, `auth.routes.ts`)
- Teudat Zehut checksum (`apps/api/src/domains/trial/legal-identity.pure.ts`)
- File magic-byte guard (`apps/api/src/shared/file-content-guard.pure.ts`)
- WEB CSP Report-Only (`apps/web/vercel.json`, confirmed on www)
- Named commands in clients/documents/settings/memberships/accounting-base/work-engine/income (legacy PATCH still mounted)
- Tenant/RBAC middleware (`auth.ts`, `requireOrg`, `requirePermission`, `requireOfficeAdministration`, `requireModuleActive`)

---

## 0.2 Finding counts

Counts below are **this audit’s catalog**, not a scanner score. Architecture items are counted separately from vulnerabilities.

| Severity | Security findings | Architecture | Privacy / governance | Infra / ops |
|---|---:|---:|---:|---:|
| CRITICAL | 3 | 0 | 0 | 0 |
| HIGH | 14 | 2 | 4 | 4 |
| MEDIUM | 16 | 6 | 3 | 5 |
| LOW | 7 | 3 | 1 | 2 |

**Top 10 risks**

1. Suspended / non-active users remain fully authorized on the API.  
2. PostgREST authenticated write policies on tenant and platform tables, keyed by a stale membership helper.  
3. Two sensitive tables have no RLS in migrations (owner OTP hashes; Work Engine idempotency).  
4. No MFA, including platform-owner.  
5. Office JWT and DocFlow portal token in `localStorage` (XSS = session theft).  
6. Normalized Teudat Zehut stored in plaintext; default hash salt if env unset.  
7. Payment-card OTP + phone logged to console when Twilio is unset.  
8. No malware scan; OLE/ZIP office files accepted by magic-byte only.  
9. No evidence of tested backups / PITR restore / incident response.  
10. No subject-erasure or documented retention for client PII, tax, and files.

---

## 1. Security vulnerabilities

### S-001 — Suspended users keep API access

| Field | Value |
|---|---|
| Severity | **CRITICAL** |
| Module | Auth / Core |
| Location | `apps/api/src/middleware/auth.ts` `authMiddleware`; `apps/api/src/domains/auth/auth.routes.ts` `toAuthSessionAggregate`, `GET /me` |
| Issue | `users.status` is copied onto context but **never blocks** the request. Only `GET /session` sets `session_state: 'blocked'`. `GET /me` and all tenant APIs still run. |
| Evidence | `auth.ts` lines 59–92 call `next()` with no status check. `auth.routes.ts` 224–228 applies blocked only inside `toAuthSessionAggregate`. |
| Prerequisites | Valid JWT for a user whose `users.status` is `suspended` or `deleted`. |
| Impact | Access-revocation is UI-only. A blocked bookkeeper can still read/write client, tax, payroll, and documents via API. |
| Mitigations | Session aggregate redirects the first-party UI. |
| Remediation | Reject non-`active` in `authMiddleware`. Also revoke Supabase sessions on suspend. |
| Tests | Missing HTTP test: suspended user + `/clients` must 401/403. |
| Status | **CONFIRMED** |
| Production affected | YES if any non-active user still has a valid refresh token. |

### S-002 — PostgREST write surface + stale RLS membership helper

| Field | Value |
|---|---|
| Severity | **CRITICAL** (repo). Live grants **NOT VERIFIED**. |
| Module | Supabase / RLS |
| Location | `supabase/migrations/002_rls_core.sql` `organizations_for_current_auth_user`; write policies across clients/documents/income/accounting/payroll/fees; `097_platform_settings_email_provider.sql`; `095_owner_email_provider_configs.sql` |
| Issue | WEB ships `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. After login a user can call `/rest/v1` with their JWT. RLS is the only control. The helper reads **legacy** `organization_users`, not `organization_memberships`, and is `SECURITY DEFINER` without `search_path`. Many tables allow INSERT/UPDATE/DELETE for any org member. `platform_settings` is writable by **any** member of **any** org. |
| Evidence | `002_rls_core.sql` 5–12, 75–76; `097_…sql` 11–18. API uses service role (`db/client.ts`), so RLS does not constrain first-party API queries. |
| Prerequisites | User JWT + reachable PostgREST (default Supabase). Leftover `organization_users` row after a non-standard revoke. |
| Impact | Bypass command/RBAC/audit. Possible write of clients, documents, accounting entries, payroll, platform settings, encrypted email-provider secrets. |
| Mitigations | First-party UI does not call `.from()`. Migration `137_core_rbac_settings_rls_hardening.sql` revokes a few Core tables. |
| Remediation | `REVOKE ALL` from `anon`/`authenticated` on tenant tables (pattern in 137). Rewrite helper to active `organization_memberships` + `SET search_path = public`. |
| Tests | No PostgREST JWT tests exist. |
| Status | **CONFIRMED** in migrations; live GRANT/network ACL **NOT VERIFIED** |
| Production affected | Treat as YES until live grants are proven revoked. |

### S-003 — Tables without RLS (owner OTP hashes)

| Field | Value |
|---|---|
| Severity | **CRITICAL** if `authenticated` is granted; otherwise HIGH |
| Module | Platform owner recovery / Work Engine |
| Location | `supabase/migrations/098_platform_owner_password_recovery.sql` (`platform_owner_password_recovery_challenges.otp_hash`); `110_work_engine_stage10_phase1.sql` `work_engine_command_idempotency` |
| Issue | Neither table enables RLS. Comment says service-role only; grants are not in those files. |
| Evidence | `098_…sql` 3–11; `110_…sql` 43–52 (no `enable row level security`). |
| Prerequisites | Default Supabase table grants to `authenticated`, or any leaked service role. |
| Impact | Read/write owner recovery OTP hashes; tamper with command idempotency. |
| Mitigations | None in schema. |
| Remediation | Enable RLS, revoke from `anon`/`authenticated`, grant service_role only. |
| Tests | Missing. |
| Status | **CONFIRMED** schema gap; live grants **NOT VERIFIED** |
| Production affected | NOT VERIFIED (schema is in the migration history). |

### S-004 — No MFA

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | Auth |
| Location | `apps/api/src/middleware/auth.ts`; `apps/web/src/pages/Login.tsx`; `PlatformOwnerLogin.tsx` |
| Issue | No TOTP/WebAuthn/AAL check anywhere in first-party source. Owner SMS OTP is **password recovery**, not login MFA. |
| Evidence | Repo grep of `mfa` / `totp` / `enrollFactor` / `aal` in `apps/api/src` and `apps/web/src`: none. |
| Prerequisites | Stolen password or XSS-stolen refresh token. |
| Impact | Full office or platform-owner session. |
| Mitigations | Password + (office) login rate limit. Owner login **bypasses** the API limiter. |
| Remediation | Enforce MFA for platform owner and office owner/admin before confidential data. |
| Tests | None. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-005 — Session tokens in `localStorage`

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | WEB auth / DocFlow portal |
| Location | `apps/web/src/lib/supabase.ts`; `apps/web/src/api/client.ts`; `apps/web/src/lib/docflow-portal-session.ts` |
| Issue | Default Supabase JS persistSession → localStorage. Portal token also in a **non-HttpOnly** cookie. |
| Evidence | `supabase.ts` 1–5 (no custom storage). `docflow-portal-session.ts` writes localStorage + JS-readable cookie. |
| Prerequisites | Any XSS. |
| Impact | Account takeover until refresh revoked. |
| Mitigations | CSP Report-Only (does **not** block script). Limited `dangerouslySetInnerHTML` surfaces. |
| Remediation | HttpOnly cookie session or BFF; HttpOnly portal cookie. |
| Tests | None. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-006 — Platform-owner login bypasses API rate limit

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | Platform owner |
| Location | `apps/web/src/pages/PlatformOwnerLogin.tsx`; `apps/api/src/domains/auth/auth.routes.ts` `POST /login` |
| Issue | Owner signs in with `supabase.auth.signInWithPassword` directly. Office `/auth/login` limiter is skipped. |
| Evidence | Owner login page does not call `AUTH.login`. |
| Prerequisites | Knowledge of owner email (also enumerable — S-007). |
| Impact | Online password guessing against the most privileged account, limited only by hosted GoTrue (NOT VERIFIED). |
| Mitigations | None in app. |
| Remediation | Force owner login through a rate-limited API command. |
| Tests | Missing. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-007 — Owner recovery email enumeration

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | Platform owner recovery |
| Location | `apps/api/src/domains/auth/platform-owner-password-recovery.service.ts` |
| Issue | Wrong email → `403 OWNER_RECOVERY_EMAIL_NOT_ALLOWED`. Matching configured email → 200 + session id. |
| Evidence | Service lines ~90–100. |
| Prerequisites | Unauthenticated `POST /api/v1/owner/password-recovery/request` (rate-limited 5/15m/IP). |
| Impact | Confirms the platform-owner address. Combined with S-006, focuses brute force. |
| Mitigations | IP rate limit on recovery. |
| Remediation | Always return the same 200. |
| Tests | Missing. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-008 — Hardcoded OTP pepper fallback

| Field | Value |
|---|---|
| Severity | **HIGH** (if production env unset) |
| Module | Platform owner recovery |
| Location | `apps/api/src/domains/auth/platform-owner-password-recovery.service.ts` |
| Issue | Falls back to `'dev-only-pepper-set-SENSITIVE_ACCESS_CODE_PEPPER'` when env is missing. |
| Evidence | Lines 12–17. |
| Prerequisites | Missing `SENSITIVE_ACCESS_CODE_PEPPER` / related env in Render. |
| Impact | OTP hashes become offline-guessable with a public pepper. |
| Mitigations | Fail-closed if env unset (not implemented). |
| Remediation | Refuse to start recovery (and preferably the process) without a production pepper. |
| Tests | Missing. |
| Status | **CONFIRMED** code; production env **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-009 — Default Teudat Zehut hash salt + plaintext at rest

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | Trial / legal identity |
| Location | `apps/api/src/config.ts`; `supabase/migrations/010_trial_legal_identity.sql`; `legal-identity.service.ts` |
| Issue | `LEGAL_IDENTITY_HASH_SALT` defaults to `'dev-salt-change-in-production'` and is **absent** from `RENDER_ENV.md`. Column `legal_identity_value_normalized` stores the full 9-digit ID. API returns masked only; DB does not. |
| Evidence | `config.ts` line 10; `010_…sql` 10–18. |
| Prerequisites | DB read (backup, staff, SQLi, service-role leak) or knowledge of default salt for hash correlation. |
| Impact | National-ID disclosure / trial correlation. |
| Mitigations | Checksum + hash for trial anti-abuse; audit payloads omit raw TZ; settings API masked. |
| Remediation | Require salt in production; encrypt or remove plaintext column; keep hash + last-4 mask. |
| Tests | Checksum tests exist; no prod-salt test. |
| Status | **CONFIRMED** code; live salt **NOT VERIFIED** |
| Production affected | Plaintext column: YES if any trial identity was stored. Salt: NOT VERIFIED. |

### S-010 — Payment-card OTP logged to console

| Field | Value |
|---|---|
| Severity | **HIGH** |
| Module | Client Operations payment card |
| Location | `apps/api/src/domains/client-operations/payment-card-access.service.ts` |
| Issue | If Twilio is unset, code logs `` OTP for ${toPhone}: ${code} `` with **no `NODE_ENV` guard**. |
| Evidence | Line 93. |
| Prerequisites | Twilio env missing on a running API instance. |
| Impact | Phone + OTP in Render logs (access, retention, support). |
| Mitigations | AES-256-GCM for stored payment secrets when `CLIENT_DATA_ENCRYPTION_KEY` is a valid 32-byte key (`field-encryption.ts`). |
| Remediation | Never log OTP/phone. Fail closed without Twilio in production. |
| Tests | Missing. |
| Status | **CONFIRMED** code; live Twilio **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-011 — Legacy `member` maps to RBAC `admin`

| Field | Value |
|---|---|
| Severity | **HIGH** if such rows exist |
| Module | RBAC |
| Location | `apps/api/src/domains/rbac/rbac.service.ts` `LEGACY_ORG_ROLE_TO_RBAC_ROLE` |
| Issue | `member: 'admin'`. Users only in `organization_users` with role `member` receive admin permissions. |
| Evidence | Lines 57–64. |
| Prerequisites | Legacy membership row with `role_code/code = member`. |
| Impact | Privilege inflation vs modern staff/viewer. |
| Mitigations | Canonical path is `organization_memberships`. |
| Remediation | Map unknown/member → `staff` or deny. Inventory live rows. |
| Tests | Missing live-row inventory. |
| Status | **CONFIRMED** mapping; live row existence **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-012 — CSP is Report-Only on production WEB

| Field | Value |
|---|---|
| Severity | **HIGH** (XSS amplifier; not a standalone RCE) |
| Module | WEB |
| Location | `apps/web/vercel.json`; live `https://www.nodexpro.com` |
| Issue | `Content-Security-Policy-Report-Only` only. XSS is not blocked. |
| Evidence | `vercel.json` 11–12. Live header matches. `dangerouslySetInnerHTML` in `IncomeDocumentBrandingSettingsPanel.tsx` (2) and `WorkEngineIncomeDocumentPreviewPaper.tsx` (1). No DOMPurify. |
| Prerequisites | XSS in those sinks or a future sink. |
| Impact | Script runs; steals localStorage session (S-005). |
| Mitigations | Backend `escapeHtml` on many preview fields; `script-src 'self'` would help **only if enforced**. |
| Remediation | Authenticated regression, then enforce CSP. Do not flip now. |
| Tests | No authenticated CSP regression. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-013 — No malware scanning; OLE/ZIP trusted by magic bytes

| Field | Value |
|---|---|
| Severity | **HIGH** for a document-heavy tax office |
| Module | Documents / Client Operations / Income branding |
| Location | `apps/api/src/shared/file-content-guard.pure.ts`; upload callers listed in Phase 6 |
| Issue | Guard is magic-byte + extension. Any OLE `.doc`/`.xls` or ZIP `.docx`/`.xlsx` is accepted. No ClamAV/macro/zip-bomb check. Puppeteer `--no-sandbox` + `setContent` without request interception. |
| Evidence | `file-content-guard.pure.ts` 72–83; `income-document-pdf.renderer.ts` `--no-sandbox`. |
| Prerequisites | Authenticated uploader. |
| Impact | Malware stored next to client files; PDF render may fetch attacker URLs. |
| Mitigations | HTML-as-text rejected; SVG excluded from settings images; storage keys server-composed. |
| Remediation | Content scanning; isolate PDF renderer; reject OLE or convert server-side. |
| Tests | `apps/api/tests/security/file-content-guard.pure.spec.ts` (magic bytes only). |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-014 — AppError / Postgres details leaked to clients

| Field | Value |
|---|---|
| Severity | **HIGH** / MEDIUM |
| Module | API errors |
| Location | `apps/api/src/index.ts` 206–211; `apps/api/src/shared/supabase-errors.ts` |
| Issue | `...(err.details ?? {})` flattens `pg_code`, `pg_details`, `pg_hint` into JSON. Client-ops signed-URL failures throw `se.message`. |
| Evidence | `index.ts` 206–211; `client-documents-tab.service.ts` ~426. |
| Prerequisites | Trigger a failing query or signed-URL error. |
| Impact | Schema/constraint oracle; storage error strings. |
| Mitigations | Generic 500 in production for non-`AppError`. |
| Remediation | Never spread `details` to clients; map to safe codes. |
| Tests | Missing. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-015 — Register account enumeration

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Auth |
| Location | `apps/api/src/domains/auth/auth.service.ts` 15–17 |
| Issue | `'Email already registered'` on conflict. |
| Evidence | `register()` maps Supabase “already registered” to `conflict`. |
| Prerequisites | `POST /register` (5/15m per IP+email). |
| Impact | Email existence oracle. |
| Mitigations | Rate limit. |
| Remediation | Generic success. |
| Tests | Rate-limit tests exist; enumeration test missing. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-016 — Invite tokens stored plaintext

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Memberships |
| Location | `inviteUserRbac`; `023_rbac_user_invitations.sql` |
| Issue | 32-byte hex token stored and indexed in plaintext; response includes `invite_link`. |
| Impact | DB dump = join as invited role. |
| Remediation | Store only a hash; return token once. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-017 — In-memory rate limit + login keyed by email

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | API |
| Location | `apps/api/src/middleware/rate-limit.ts`; `auth.routes.ts` login key `email \|\| ip` |
| Issue | Per-process map (multi-instance bypass). One IP can try many emails at 10/10m each. `change_password`, invite-accept, uploads, financial writes: no limiter. |
| Status | **CONFIRMED** |
| Production affected | YES (Render can run more than one instance — instance count **NOT VERIFIED**). |

### S-018 — Global 15mb JSON body, no global rate limit

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | API |
| Location | `apps/api/src/index.ts` 147 |
| Issue | Every JSON route accepts 15mb. Easy resource exhaustion. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-019 — Signed URLs are bearer capability tokens

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Files |
| Location | `file-access.service.ts` (60s); client-ops / fleet / annual-report (120s) |
| Issue | URL works for anyone until expiry. Portal token may appear as query `portal_session_token` (referrer/log leak). |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-020 — Platform-owner open redirect

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | WEB |
| Location | `apps/web/src/pages/PlatformOwnerLogin.tsx` `redirect` query used as `navigate(from)` |
| Issue | Not allowlisted. Office invite return path **is** allowlisted (`invite-return-path.pure.ts`). |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-021 — `/platform-owner` UI has no route guard

| Field | Value |
|---|---|
| Severity | **MEDIUM** (defense-in-depth) |
| Module | WEB |
| Location | `apps/web/src/App.tsx`; `PlatformOwnerShell.tsx` |
| Issue | Shell is reachable without session. APIs still `assertPlatformOwner`. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-022 — Logout server revoke likely a no-op

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Auth |
| Location | `auth.routes.ts` `POST /logout` uses anon-key `auth.admin.signOut` and swallows errors |
| Issue | Server-side revocation is not proven. Stolen refresh may survive UI logout. |
| Status | **SUSPECTED** (code path); live revoke **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-023 — Email verification not enforced

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Auth |
| Location | `auth.ts` `emailVerified` is display-only |
| Issue | Unverified email can use the API. Invite bind is primary email match only. |
| Status | **CONFIRMED** |
| Production affected | YES (hosted confirm-email setting **NOT VERIFIED**). |

### S-024 — Inconsistent password policy

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Auth |
| Location | Register does not run `validateNewPassword`; Reset UI allows 6 chars; change-password API requires 8–128 |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-025 — Filename sanitization discarded; metadata-only file_assets

| Field | Value |
|---|---|
| Severity | **LOW** |
| Module | Files |
| Location | `entity-file-links.service.ts`; `income-document-branding.service.ts` |
| Issue | Inserts store raw `fileName`; can create `file_assets` without bytes. Storage keys are still server-built. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-026 — Unauthenticated health + module catalog

| Field | Value |
|---|---|
| Severity | **LOW** |
| Module | API |
| Location | `GET /api/v1/health`; authenticated `GET /api/v1/modules/` (not org-scoped) |
| Issue | Health exposes `deploy_marker` (useful, low risk). Module registry is visible to any logged-in user. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-027 — Owner OTP compared with `===`

| Field | Value |
|---|---|
| Severity | **LOW** |
| Module | Platform owner recovery |
| Location | `platform-owner-password-recovery.service.ts` |
| Issue | SHA-256 hex compared with `===`, not `timingSafeEqual`. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-028 — No storage.objects policies in repository

| Field | Value |
|---|---|
| Severity | **HIGH** gap |
| Module | Storage |
| Location | `015_client_files_bucket.sql`, `018_phase4_document_files_bucket.sql` |
| Issue | Baseline 7.6 requires storage policies. Repo only inserts private buckets. Live project policies **NOT VERIFIED**. |
| Status | **CONFIRMED** repo gap; exploit **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-029 — Internal cron is a cross-tenant control plane

| Field | Value |
|---|---|
| Severity | **HIGH** if secret leaked |
| Module | Work Engine / DocFlow |
| Location | `work-engine.routes.ts` `POST /internal/scheduler/run`; `docflow.routes.ts` `run-daily` |
| Issue | Shared header secret. Omit `org_id` = all orgs. Fail-closed if unset. GitHub Actions call **production**. |
| Status | **CONFIRMED** design; secret quality **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-030 — `audit_log` null-org rows visible under RLS

| Field | Value |
|---|---|
| Severity | **MEDIUM** |
| Module | Audit |
| Location | `002_rls_core.sql` 61–65 |
| Issue | `organization_id is null OR member org`. Any member can SELECT global audit rows via PostgREST. |
| Status | **CONFIRMED** policy; live use **NOT VERIFIED** |
| Production affected | NOT VERIFIED |

### S-031 — www HTML `Access-Control-Allow-Origin: *`

| Field | Value |
|---|---|
| Severity | **LOW** |
| Module | WEB / Vercel |
| Location | Live `https://www.nodexpro.com` response headers |
| Issue | Static HTML is `*`. API CORS is separate. Unusual but not a direct tenant leak. |
| Status | **CONFIRMED** |
| Production affected | YES |

### S-032 — First-party API IDOR (org A → org B)

| Field | Value |
|---|---|
| Severity | — |
| Module | All tenant APIs |
| Issue | Spot-check of clients, documents, income, accounting, work-engine, docflow, memberships binds `ctx.organizationId` or `params.id === context.organizationId`. **No confirmed cross-tenant API IDOR.** Surface was **not** exhaustively tested with two synthetic orgs over HTTP. |
| Status | **NOT VERIFIED** (do not mark PASS) |
| Production affected | NOT VERIFIED |

---

## 2. Architecture violations (not automatically vulnerabilities)

| ID | Severity | Location | Violation |
|---|---|---|---|
| A-001 | HIGH | `clients.routes.ts`, `documents.routes.ts`, `organization-settings.routes.ts`, `memberships.routes.ts` | Legacy generic PATCH still mounted beside named commands. |
| A-002 | HIGH | `ClientCard.tsx`, `DocumentCard.tsx` | Extra GETs after tags/files/links/versions; local tag delete truth; archive/restore not always full aggregate. |
| A-003 | MEDIUM | `Modules.tsx` / `office-modules-state.ts` `matchingPlan` | Client joins `modulePlanId` to `availablePlans`. Presentation only. |
| A-004 | MEDIUM | `Dashboard.tsx` drilldowns | Extra GETs for modal lists after overview aggregate. |
| A-005 | MEDIUM | `client-operations.routes.ts` `GET .../tax-settings` | Leftover read beside case aggregate. |
| A-006 | HIGH | `client-tax-settings.service.ts` | Israel `patur` / tax rules outside Country Pack (no `TEMPORARY_COUNTRY_PACK_PENDING` in that file). |
| A-007 | MEDIUM | Income / Work Engine `TEMPORARY_COUNTRY_PACK_PENDING` / `TEMPORARY_ACCOUNTING_BASE_PENDING` | Documented transitional financial/legal logic. |
| A-008 | MEDIUM | Dual membership (`organization_memberships` vs `organization_users`) | Canonical vs legacy; RLS helper uses legacy. |
| A-009 | LOW | Tax Brain | Marketing key only. No Tax Brain module in `apps/api/src`. Draft-to-approved knowledge lifecycle is **not implemented** as a product surface. |
| A-010 | LOW | `GET /auth/me` vs `/auth/session` | Two session reads; `/me` omits `session_state`. |

State ≠ Action ≠ Event is followed in Work Engine event contract code; leftover PATCH/GET stitching is the main Core→Commands→Aggregate→UI debt.

---

## 3. Privacy / confidential-data governance

| ID | Severity | Gap |
|---|---|---|
| P-001 | HIGH | No account/org/subject **erasure** API. Client archive is soft-delete only. |
| P-002 | HIGH | No documented retention for `audit_log`, files, tax, payroll. CO history UI filters 12 months; storage is unbounded. Phase 0 §7.7 retention is **Deferred**. |
| P-003 | HIGH | Normalized Teudat Zehut at rest (S-009). Requires Israeli Privacy Protection Law counsel (national ID is sensitive). |
| P-004 | HIGH | No privacy policy, DPA, or subprocessor list in repo (Supabase, Vercel, Render, Resend, Twilio, Puppeteer). |
| P-005 | MEDIUM | Audit is insert-only in app code; **not** DB append-only. Tests delete `audit_log` rows. |
| P-006 | MEDIUM | Sensitive-access logging is incomplete (payment-card reveal vs bulk document open). |
| P-007 | MEDIUM | Encryption in transit: HTTPS live on www (HSTS present). Encryption at rest: **Supabase/Render defaults NOT VERIFIED**. App-level AES-GCM only for payment-card JSON when key is valid. |
| P-008 | LOW | `RENDER_ENV.md` / `.env.example` commit a real-looking `PLATFORM_OWNER_EMAIL` (PII in repo). |

**Legal review required (do not treat as done):** Israeli Privacy Protection Law / Amendment 13; accountant professional secrecy; tax-document retention; cross-border processing (Vercel/Render/Supabase regions); employee access to client files.

---

## 4. Infrastructure and operational risks

| ID | Severity | Gap |
|---|---|---|
| I-001 | HIGH | No backup / PITR / restore-drill / RPO-RTO evidence. Phase 0 §7.7 **Deferred**. |
| I-002 | HIGH | No incident runbook, alerting, or emergency rotation procedure. |
| I-003 | HIGH | `LEGAL_IDENTITY_HASH_SALT`, `INTERNAL_CRON_SECRET`, `RESEND_API_KEY`, `SENSITIVE_ACCESS_CODE_PEPPER` missing from `RENDER_ENV.md`. |
| I-004 | HIGH | `app.nodexpro.com` returned HTTP 500 during this audit (documented CORS origin). |
| I-005 | MEDIUM | No `render.yaml`; Auto-Deploy **NOT VERIFIED**. Agent convention: production service `nodexpro`, Auto-Deploy OFF. |
| I-006 | MEDIUM | GitHub schedulers hit production with default `GITHUB_TOKEN` permissions. |
| I-007 | MEDIUM | In-memory limiter; `trust proxy = 1` hop count **NOT VERIFIED**. |
| I-008 | MEDIUM | No web HSTS in `vercel.json` (Vercel still sent HSTS on www — platform default). |
| I-009 | LOW | No committed live keys found in first-party source. |
| I-010 | LOW | `nodexpro-dev` absent from repo. |

**Do not claim disaster-recovery readiness.** No restore was performed or documented.

---

## 5. Missing tests and verification

Required before any READY claim:

1. Two synthetic orgs, HTTP IDOR matrix (GET/POST/PATCH/command/export/PDF/signed URL) for every tenant resource.  
2. PostgREST: user JWT vs write policies, revoked member + leftover `organization_users`, `platform_settings`.  
3. Live `information_schema` / `pg_policies` / `storage.policies` dump (read-only).  
4. Suspended user still calling `/clients` and `/documents`.  
5. Platform-owner recovery enumeration + login limiter.  
6. Authenticated CSP regression (login, Income preview, Work Engine preview, uploads, language switch) **before** enforce.  
7. Restore drill from backup with tenant-safe proof.  
8. Confirm production env: encryption key, TZ salt, cron secret, Twilio, pepper, CORS.  
9. Malware-scan strategy decision (product, not a unit test).  
10. Privilege tests: staff cannot change roles; admin cannot set owner; viewer cannot write accounting.

**Ran this audit (isolated, synthetic, non-production):**

```
apps/api/tests/security/rate-limit.spec.ts
apps/api/tests/security/file-content-guard.pure.spec.ts
apps/api/tests/trial/legal-identity.pure.spec.ts
apps/api/tests/trial/legal-identity-bypass.pure.spec.ts
```

**13/13 passed.** These prove local limiters, magic bytes, and TZ checksum — **not** tenant isolation or production RLS.

Live checks: API health `153556c7`; www headers + assets `index-IGcXPb_J.js`. No production accounts, no real identity numbers, no destructive tests.

---

## 6. Phase notes (evidence, not PASS)

### Authentication and sessions

Entry points: `POST /register`, `POST /login`, `POST /logout`, `GET /me`, `GET /session`, invite accept, org switch commands, owner recovery, additional-email verify, platform-owner client login. JWT validated by live `getUser`. No API refresh. MFA absent. Blocked users: S-001. Enumeration: S-007, S-015.

### Tenant isolation and IDOR

Trust boundary: Bearer JWT + membership-checked `X-Organization-Id` (foreign header ignored). Service role for all data. Spot-checked domains filter trusted org. Exhaustive IDOR **NOT VERIFIED**. Cron is intentionally cross-tenant. No inbound billing webhooks found.

### RBAC

Roles: owner / admin / staff / viewer. Office admin = owner|admin. Self-role change blocked; cannot set owner; admin may promote others to admin. Platform owner = email allowlist and **no** tenant `membership.roleCode`. Extra owner hashes in config are unused. Represented clients use DocFlow portal sessions, not office RBAC.

### Supabase / database

RLS is defense-in-depth and **does not apply** to the API. Helper is stale. Two tables lack RLS. Storage policies missing in repo. Audit immutability not DB-enforced.

### Documents

Magic-byte guard present. No malware scan. Signed URLs 60–120s. PDF `--no-sandbox`. Three HTML sinks without client sanitizer.

### Financial and tax

Accounting Base HTTP allowlist is allocate/reverse with permission checks. Other AB commands exist in-process but are not mounted. Tax Brain module **does not exist**. Country-specific tax still lives in Client Operations / Income (architecture + legal-truth debt).

### Work Engine / DocFlow

Scheduler and DocFlow cron fail-closed without secret. Existing work-event contract reused. Office command handler logs email, user, org, role, permissions (`docflow.routes.ts`). Portal attachments org/client scoped in spot-check.

### Frontend

CSP Report-Only live. Tokens in localStorage. Source maps: Vite default off; `apps/web/dist` had no `.map` at audit time; CI flags **NOT VERIFIED**. Invite redirect allowlisted; owner redirect not.

---

## 7. Explicit answers

| # | Question | Answer |
|---|---|---|
| 1 | Can a normal user access another tenant's data? | **NOT VERIFIED** on the first-party API (spot-check found no IDOR; no two-org HTTP suite). **SUSPECTED** via PostgREST if live grants match migrations (S-002). |
| 2 | Can a user elevate privileges? | **Cannot** set self to owner via `changeUserRoleRbac`. **CONFIRMED** privilege *retention*: blocked users keep API access (S-001). **SUSPECTED** inflation: legacy `member`→`admin` (S-011). Admin→admin promotion is by design. |
| 3 | Can a document be downloaded without authorization? | **NOT VERIFIED** for Storage RLS. **CONFIRMED** that a leaked signed URL works for 60–120s without the original session (S-019). |
| 4 | Can frontend credentials expose backend or database secrets? | **NO** in first-party source: no service-role key in `apps/web`. Anon key + URL are expected. Live bundle extra secrets **NOT VERIFIED**. |
| 5 | Can Supabase RLS be bypassed? | **YES for the API** (service role, by design). **YES/SUSPECTED for PostgREST** via stale helper and write policies (S-002). |
| 6 | Are financial and tax records protected by domain authorization? | **PARTIAL.** Accounting Base payment writes check permissions. Leftover PATCH and CO/Income country rules remain. Tax Brain lifecycle is **not implemented**. |
| 7 | Is CSP ready for enforcement? | **NO.** Report-Only live. Requires authenticated regression of login, previews, uploads, fonts, Supabase realtime. |
| 8 | Are backups recoverable? | **NOT VERIFIED.** No restore evidence. Do not claim DR. |
| 9 | Is incident response operationally prepared? | **NO** (no runbook, alerting, or rotation procedure in repo). |
| 10 | Confidential production data? | **NOT READY.** |

---

## 8. Prioritized remediation roadmap

### P0 — Immediate

1. Reject non-`active` users in `authMiddleware`; revoke sessions on suspend (S-001).  
2. Verify live PostgREST grants; `REVOKE` authenticated writes; fix `organizations_for_current_auth_user` (S-002).  
3. Enable RLS + revoke on owner recovery + Work Engine idempotency tables (S-003).  
4. Confirm production `CLIENT_DATA_ENCRYPTION_KEY`, `LEGAL_IDENTITY_HASH_SALT`, `INTERNAL_CRON_SECRET`, Twilio, pepper; remove console OTP (S-008, S-009, S-010, I-003).  
5. Stop logging OTP/phone; fail closed without Twilio in production.

### P1 — Required before sensitive production data

6. MFA for platform owner and office owner/admin (S-004).  
7. Rate-limit owner login; generic owner-recovery responses (S-006, S-007).  
8. Encrypt or stop storing full Teudat Zehut; keep hash + mask (S-009).  
9. HttpOnly session or BFF (S-005).  
10. Storage policies: authenticated cannot list/download; service-role signed URLs only (S-028).  
11. Two-org HTTP IDOR + PostgREST test suite (S-032).  
12. Backup + **successful restore drill**; document RPO/RTO (I-001).  
13. Erasure / exit path for org and subject data (P-001).  
14. Strip Postgres details from API errors (S-014).  
15. Malware strategy for office documents (S-013).  
16. Israeli privacy/legal review (P-003, P-004).

### P2 — Hardening

17. Enforce CSP after authenticated regression (S-012).  
18. Redis (or equivalent) rate limit; tighten login keying; limit change-password and uploads (S-017, S-018).  
19. Hash invite tokens (S-016).  
20. Isolate PDF renderer (network off, sandbox) (S-013).  
21. Remove or wrap leftover PATCH; finish ClientCard/DocumentCard aggregate refresh (A-001, A-002).  
22. Incident runbook + audit retention (I-002, P-002).  
23. Generic register errors (S-015).  
24. Inventory/remove legacy `member` rows (S-011).

### P3 — Long-term

25. Tax Brain as specified (or drop the claim).  
26. Move remaining IL tax rules into Country Pack.  
27. Append-only audit in the database.  
28. Staging environment that is not production.  
29. Processor register / DPAs.  
30. Continuous dependency and secret scanning.

---

## 9. Tests performed vs still required

| Performed | Result |
|---|---|
| Rate-limit unit tests | PASS (13 security/TZ tests total in this run) |
| File magic-byte tests | PASS |
| Teudat Zehut checksum / bypass / register-contract tests | PASS |
| Live API health | `153556c7`, db ok, pdf_engine ok |
| Live www headers | CSP Report-Only, nosniff, DENY, HSTS, assets `index-IGcXPb_J.js` |
| Two-org HTTP IDOR | **NOT RUN** |
| PostgREST / live RLS | **NOT RUN** |
| Authenticated browser / CSP enforce | **NOT RUN** |
| Backup restore | **NOT RUN** |
| Production env inspection | **NOT RUN** (`RENDER_API_KEY` absent; dashboards not opened) |

---

## 10. Deployment classification

This audit produced a report only.

- **API: NO**  
- **WEB: NO**  
- **MIGRATION: NO**

Git SHA of this report commit is recorded after commit. Unrelated WIP was not staged.

---

## 11. Trust-boundary diagram (text)

```
Browser (localStorage JWT, anon key)
    │  HTTPS
    ├─► Vercel WEB (CSP Report-Only)
    ├─► Render API  ──service_role──► Supabase Postgres / Storage
    │                      ▲
    │                      │ RLS does not apply
    └─► Supabase Auth + PostgREST (user JWT) ──► RLS (legacy OU helper)
GitHub Actions ──X-Internal-Cron-Secret──► API schedulers (all orgs)
```

---

*End of audit. Do not treat the existence of middleware, RLS enablement, or unit tests as a PASS for confidential client data.*
