# NodexPro — Enterprise Security Readiness & SaaS Benchmark

**Date:** 2026-10-22  
**Role:** complementary enterprise / SaaS benchmark (ASVS L2 target, risk-based extras)  
**Parallel audit:** `SECURITY_READINESS_AUDIT.md` (commit `48d29668`). This document does **not** replace or overwrite it. Finding IDs `S-*` / `A-*` / `P-*` / `I-*` live there.  
**Method:** repository inspection, non-intrusive live HTTPS/header checks, reuse of already-run local tests. No production attacks, no TLS deep scan, no restore, no deploy.

**Compliance claim:** none. Mapping a control to OWASP ASVS L2, OWASP API Top 10, OWASP Top 10, or NIST CSF 2.0 is **not** ASVS, SOC 2, ISO 27001, or legal certification.

**Overall launch readiness: NOT READY**

Confirmed exploitable/control-design defects exist (suspended-user API access, PostgREST write surface, missing MFA, plaintext national IDs). Several gates that a Zoho/Xero-class buyer would treat as table stakes are **NOT VERIFIED** at the provider (backups, live RLS grants, encryption-at-rest settings). Unknowns do not upgrade the score.

---

## 1. What “mature professional SaaS” actually means here

Zoho Books, Xero, and comparable accounting platforms are not used as a feature checklist. They set **buyer expectations** for a product that will hold payroll, tax returns, banking details, and Israeli identity numbers:

| Expectation | Typical mature SaaS | NodexPro (this audit) |
|---|---|---|
| HTTPS everywhere | Enforced, HSTS, no mixed content | HTTPS + HTTP→HTTPS **verified** on www and Render API. HSTS on Vercel **verified**. API HSTS **PROVIDER-DEPENDENT**. |
| Encryption at rest | Provider default + documented; extra crypto for secrets | App-level AES-GCM for payment-card JSON **IMPLEMENTED — NOT VERIFIED** in prod. TZ stored plaintext. DB/storage/backup crypto **PROVIDER-DEPENDENT**. |
| MFA for privileged users | Enforced | **ABSENT** in first-party code. Supabase can provide it; enrollment/enforcement **NOT VERIFIED**. |
| Tenant isolation defense in depth | App authz **and** DB/storage deny | App-layer **IMPLEMENTED — NOT VERIFIED** exhaustively. RLS/storage **not effective** for the API (service role). PostgREST writes **IMPLEMENTED** as a risk. |
| Session hardening | HttpOnly cookies or BFF | **ALTERNATIVE CONTROL**: Bearer JWT in `localStorage` (weaker than cookie/BFF). |
| Rate limit / abuse | Edge + shared store | In-memory process map. **IMPLEMENTED — NOT VERIFIED** vs Render topology. |
| Malware on uploads | AV or justified equivalent | Magic-byte only. Type validation ≠ antivirus. |
| Audit + IR | Searchable, alerting, runbook | Insert-only `audit_log`. No failed-login audit. No IR operators/alerts. |
| Backup + tested restore | PITR + drill evidence | Phase 0 **Deferred**. No restore evidence. |
| Independent QA | External pentest, vuln SLAs | Architecture CI only. Cursor/repo review ≠ pentest. |
| Privacy / erasure | Documented subject rights | **ABSENT** in product. Legal review required. |

NodexPro is closer to a **serious mid-stage product with a real Core spine** than to a consumer toy. It is **not** yet in the same operational security class as those products.

---

## 2. Framework mapping (non-certifying)

| Framework | Relevant items observed | NodexPro posture |
|---|---|---|
| OWASP ASVS L2 V2 Auth | MFA, session, password, recovery | Fail MFA, fail privileged step-up, fail HttpOnly session |
| ASVS L2 V3 Session | Token storage, logout revoke, idle timeout | Token in localStorage; server logout revoke unproven |
| ASVS L2 V4 Access | RBAC deny-by-default, IDOR | Server RBAC exists; exhaustive IDOR unproven; PostgREST gap |
| ASVS L2 V6 Crypto | TLS, at-rest, key mgmt | Transit good on checked hosts; at-rest mostly provider-unknown |
| ASVS L2 V7 Error/log | Security events, integrity | Partial audit; failed office login not logged |
| ASVS L2 V8 Data | PII minimization, encryption | TZ plaintext; no erasure |
| ASVS L2 V9 Comms | HTTPS, HSTS, WSS | HTTPS verified; WSS allowed in CSP for Supabase |
| ASVS L2 V12 Files | Type, size, malware | Magic-byte **verified** in unit tests; malware **absent** |
| ASVS L2 V14 Config | Secrets, headers, CSP | Secrets in env (values unverified); CSP Report-Only |
| OWASP API1 Broken Object Auth | Cross-tenant IDs | Spot-checked; not proven |
| OWASP API2 Broken Auth | MFA, blocked users, owner login limiter | Fail |
| OWASP API4 Resource | 15mb JSON, in-memory limiter | Residual DoS risk (not production-flooded) |
| OWASP API5 BFLA | Role change, owner routes | Self-owner blocked; admin can promote admin |
| OWASP API8 Security misconfig | PostgREST grants, no storage policies | High |
| OWASP A03 Injection / A05 Misconfig / A07 Auth | XSS+CSP RO; service role | See parallel audit |
| NIST CSF 2.0 | Identify / Protect / Detect / Respond / Recover | Identify: partial. Protect: partial. Detect/Respond/Recover: largely absent. |

---

## 3. Control-by-control matrix

Classification is exactly one of:  
`VERIFIED EFFECTIVE` · `IMPLEMENTED — NOT VERIFIED` · `ABSENT` · `ALTERNATIVE CONTROL` · `PROVIDER-DEPENDENT — NOT VERIFIED` · `NOT APPLICABLE`

“Covered by parallel audit” means the defect/control is already catalogued there; this row adds the enterprise classification, not a second finding ID.

### 3.1 Encryption in transit

| ID | Control | Objective | Implementation | Evidence | Effectiveness | Bypass / failure | Residual risk | Required improvement | Test needed | Priority | Owner | Parallel |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-T-01 | HTTPS on WEB | Confidentiality of browser traffic | Vercel TLS | Live `https://www.nodexpro.com` 200 | **VERIFIED EFFECTIVE** (www) | `app.nodexpro.com` returned 500 | Apex/app host inconsistency | Fix `app` host or drop it from CORS | Periodic cert/host check | P1 | Vercel / NodexPro | Partial (headers) |
| C-T-02 | HTTPS on API | Same for API | Render TLS | Live health over HTTPS; `deploy_marker` 153556c7 | **VERIFIED EFFECTIVE** (API host) | HTTP still exists as redirect source | Clients must not pin HTTP | Keep HTTPS-only clients | Health over HTTPS in CI | P1 | Render | Yes (health) |
| C-T-03 | HTTP→HTTPS redirect | Block plaintext | Provider redirect | `http://www.nodexpro.com` → **308** `https://www.nodexpro.com/`; `http://nodexpro.onrender.com/api/v1/health` → **301** HTTPS | **VERIFIED EFFECTIVE** for those two hosts | Other hostnames untested | Bookmark/http client on unused hosts | Inventory all DNS names | Redirect check in staging | P2 | Vercel / Render | No |
| C-T-04 | TLS config / cert | Modern TLS, valid cert | Provider | HTTPS works; **no** handshake/cipher scan (unauthorized) | **PROVIDER-DEPENDENT — NOT VERIFIED** | Weak ciphers unknown | Interception if misconfigured | Authorized SSL Labs / provider TLS view | Staging scan only | P2 | Vercel / Render | No |
| C-T-05 | HSTS | Force HTTPS after first visit | Vercel sent `Strict-Transport-Security: max-age=63072000` on www. Not in `vercel.json`. API helmet defaults include HSTS **if** not disabled | www header capture 2026-10-22 | WEB: **VERIFIED EFFECTIVE**. API: **IMPLEMENTED — NOT VERIFIED** | First visit still HTTP then redirect | Preload not confirmed | Document HSTS; do not preload until all hosts HTTPS | Header regression | P2 | Vercel / NodexPro | Partial |
| C-T-06 | Mixed content | No http:// assets | CSP `img-src` allows `https:`; fonts Google HTTPS | `vercel.json` CSP RO; live HTML uses HTTPS fonts | **IMPLEMENTED — NOT VERIFIED** | CSP is Report-Only | Injected http resource would load | Enforce CSP after regression | Authenticated mixed-content pass | P2 | NodexPro | Yes (CSP) |
| C-T-07 | WebSocket | Encrypted realtime | CSP `connect-src` includes `wss://*.supabase.co` | `vercel.json` 12 | **IMPLEMENTED — NOT VERIFIED** | If client used `ws://` | Token leak on WS | Confirm client only uses wss | Network tab on login | P2 | NodexPro / Supabase | No |
| C-T-08 | API→Supabase | Backend TLS | `@supabase/supabase-js` over `SUPABASE_URL` (https expected) | `config.ts`, `db/client.ts` | **IMPLEMENTED — NOT VERIFIED** | If URL were `http://` | Service-role on plaintext | Fail boot if URL not https | Config assert test | P1 | NodexPro / Supabase | No |
| C-T-09 | Webhooks inbound | Signed HTTPS | No billing webhook router in `apps/api/src` | Source search | **NOT APPLICABLE** (no inbound webhooks found) | Future Stripe/etc. | Must add signature verify | N/A today | N/A | P3 | NodexPro | Yes |
| C-T-10 | Cookie Secure | Session cookies only on HTTPS | Portal cookie sets `Secure` when `location.protocol === 'https:'`; office session is **not** a cookie | `docflow-portal-session.ts` 44–45 | Portal: **IMPLEMENTED — NOT VERIFIED**. Office: **ALTERNATIVE CONTROL** (Bearer header) | Non-HttpOnly; XSS reads cookie | Session theft | HttpOnly + Secure always | Browser cookie flags | P1 | NodexPro | Yes (S-005) |

No first-party path was found that **intentionally** sends office JSON over HTTP. HTTP endpoints exist only as redirectors on the two hosts tested.

### 3.2 Encryption at rest

| ID | Data class | Implementation | Evidence | Effectiveness | Who can decrypt | Residual risk | Improvement | Priority | Owner | Parallel |
|---|---|---|---|---|---|---|---|---|---|---|
| C-R-01 | Postgres rows | Supabase disk encryption (typical) | Not inspected in dashboard | **PROVIDER-DEPENDENT — NOT VERIFIED** | Supabase + service role + anyone with DB creds | Provider staff / leaked service role = full dump | Confirm project encryption + restrict service role | P1 | Supabase | Yes |
| C-R-02 | Storage objects | Private buckets in repo; provider disk encryption typical | `015_`, `018_` createBucket `public: false` | Bucket privacy: **IMPLEMENTED — NOT VERIFIED**. Disk crypto: **PROVIDER-DEPENDENT** | Service role + signed-URL holder | No storage.objects policies in repo | Add deny-all storage policies | P0 | NodexPro / Supabase | Yes (S-028) |
| C-R-03 | Backups / snapshots | Supabase PITR / daily backups | Phase 0 §7.7 Deferred; no dashboard evidence | **PROVIDER-DEPENDENT — NOT VERIFIED** | Same as DB | Unrecoverable loss | See `SECURITY_BACKUP_RESTORE_PLAN.md` | P0 | Supabase / NodexPro | Yes (I-001) |
| C-R-04 | Payroll / tax / accounting | Same as C-R-01; no field encryption | Schema + services | **PROVIDER-DEPENDENT — NOT VERIFIED** | Service role | Insider / backup leak = full financials | App-layer encryption only if threat model requires | P1 | NodexPro / Supabase | Yes |
| C-R-05 | Teudat Zehut | SHA-256 hash for trial + **plaintext** `legal_identity_value_normalized` | `010_trial_legal_identity.sql`; `config.ts` default salt | Hash: **IMPLEMENTED — NOT VERIFIED** (salt). Plaintext: **ABSENT** field encryption | DB readers | National ID in backups | Encrypt or drop plaintext column | P0 | NodexPro | Yes (S-009) |
| C-R-06 | Banking / payment secrets | AES-256-GCM via `CLIENT_DATA_ENCRYPTION_KEY` | `field-encryption.ts`; startup diagnostic logs key **presence** only | **IMPLEMENTED — NOT VERIFIED** (prod key) | API process + anyone with the env key | Missing key → 503; console OTP if no Twilio | Require key at boot; never log OTP | P0 | NodexPro | Yes (S-010) |
| C-R-07 | Generated PDFs | Written to `income-documents` then signed | PDF services + puppeteer temp UUID files | Temp files: **IMPLEMENTED — NOT VERIFIED** (cleanup) | Service role | Temp dir on Render disk | Confirm unlink; no shared /tmp leak | P2 | NodexPro / Render | Partial |
| C-R-08 | DocFlow attachments | `client-files` + 60s signed URL | Portal open service | **IMPLEMENTED — NOT VERIFIED** | URL bearer | Referrer leak of portal token query | Stop query-token; 60s OK | P1 | NodexPro | Yes (S-019) |
| C-R-09 | Logs | Render/Vercel log stores | OTP/phone can be logged | **ABSENT** as a confidentiality control | Log viewers | PII in logs | Redact; retention | P0 | NodexPro / Render | Yes |
| C-R-10 | Browser | No service-role in `apps/web` | Grep `VITE_SUPABASE_SERVICE` empty | **VERIFIED EFFECTIVE** (source) | N/A | Live bundle extras unknown | Bundle secret scan | P2 | NodexPro | Yes |
| C-R-11 | Hash vs encrypt | Trial hash is anti-abuse, not secrecy | `hashLegalIdentity` | **ALTERNATIVE CONTROL** (correct use of hash) | Rainbow if default salt | Do not treat hash as encryption | Require unique prod salt | P0 | NodexPro | Yes |

**Provider-managed encryption is not automatically sufficient** for national IDs and payment secrets once an attacker has the service role or a backup. Those two classes need application controls (already started for payment cards only).

### 3.3 MFA and privileged accounts

| ID | Control | Effectiveness | Evidence | Residual risk | Improvement | Priority | Owner | Parallel |
|---|---|---|---|---|---|---|---|---|
| C-M-01 | Supabase MFA available | **PROVIDER-DEPENDENT — NOT VERIFIED** | No `mfa`/`enrollFactor`/`aal` in first-party src | Product does not enroll users | Enable TOTP in GoTrue; do **not** build a second IdP | P0 | Supabase / NodexPro | Yes (S-004) |
| C-M-02 | User enrollment UX | **ABSENT** | No settings MFA page | Users cannot opt in | Use Supabase MFA APIs via a named command + session aggregate flags | P0 | NodexPro | Yes |
| C-M-03 | Enforced for Platform Owner | **ABSENT** | `PlatformOwnerLogin.tsx` password only | Highest privilege is password + email allowlist | AAL2 required in `assertPlatformOwner` | P0 | NodexPro | Yes |
| C-M-04 | Enforced for office owner/admin | **ABSENT** | `authMiddleware` accepts any valid JWT | Stolen password = office | Require AAL2 for owner/admin + financial commands | P0 | NodexPro | Yes |
| C-M-05 | Step-up for sensitive actions | **ALTERNATIVE CONTROL** (payment-card SMS OTP) | `payment-card-access.service.ts` | SMS ≠ login MFA; OTP may be logged | Keep SMS for reveal; add recent-auth for role/export | P1 | NodexPro | Partial |
| C-M-06 | Recovery codes / lost device | **ABSENT** (product) | — | Owner SMS recovery is password reset, enumerable | Generic recovery + MFA reset runbook | P1 | NodexPro | Yes (S-007) |
| C-M-07 | MFA bypass | **ABSENT** (nothing to bypass) | Owner login skips API rate limit | Password spray | Rate-limit owner login through API | P0 | NodexPro | Yes (S-006) |
| C-M-08 | Session revocation | **IMPLEMENTED — NOT VERIFIED** | `POST /logout` anon `admin.signOut` swallowed | Stolen refresh survives UI logout | Service-role revoke + fail loud | P1 | NodexPro / Supabase | Yes (S-022) |
| C-M-09 | Blocked-user enforcement | **ABSENT** on API | `auth.ts` no status check | Suspended user keeps access | Reject in middleware | P0 | NodexPro | Yes (S-001) |
| C-M-10 | Emergency owner recovery | **IMPLEMENTED — NOT VERIFIED** | SMS OTP + pepper fallback | Pepper default; email oracle | Fail closed without pepper; same 200 | P0 | NodexPro | Yes (S-008) |

**Safest implementation compatible with current Supabase:** keep GoTrue as the only IdP. Enable TOTP MFA in the hosted project. Add `aal` check in `authMiddleware` / `assertPlatformOwner`. Surface enrollment as session-aggregate fields + one command. Do not invent a second password store.

### 3.4 Tenant isolation

| ID | Surface | Effectiveness | Notes |
|---|---|---|---|
| C-I-01 | API queries (service role + `ctx.organizationId`) | **IMPLEMENTED — NOT VERIFIED** | Design is correct in sampled domains. No Office A/B HTTP matrix. Parallel S-032. |
| C-I-02 | Named commands / aggregates | **IMPLEMENTED — NOT VERIFIED** | Commands re-check org. Leftover PATCH is architecture (A-001), not a proven IDOR. |
| C-I-03 | Background workers | **ALTERNATIVE CONTROL** | Cron secret, optional `org_id`, all-org when omitted. Fail-closed if secret unset. Parallel S-029. |
| C-I-04 | Storage | **IMPLEMENTED — NOT VERIFIED** | Org-prefixed keys + app check before sign. No storage RLS in repo. |
| C-I-05 | Export / PDF / search | **IMPLEMENTED — NOT VERIFIED** | Caps exist (e.g. search 50, some 5000). Need A/B tests. |
| C-I-06 | Cache | **NOT APPLICABLE** | No shared Redis tenant cache found. Rate-limit map is per-process, not tenant data. |
| C-I-07 | Email | **IMPLEMENTED — NOT VERIFIED** | Invite email uses invited address; must not attach other-tenant files (not proven). |
| C-I-08 | Audit log | **IMPLEMENTED — NOT VERIFIED** | Org-scoped reader; RLS allows null-org rows (S-030). |
| C-I-09 | PostgREST / RLS | **ABSENT** as effective API defense | Service role bypasses RLS. Helper uses legacy OU. Parallel S-002. |
| C-I-10 | Webhooks | **NOT APPLICABLE** | None found. |

**Office A / Office B matrix (required, not executed against production):**

| Resource | A reads B | A writes B | A downloads B file | A guesses B UUID |
|---|---|---|---|---|
| Client / contact / note | Staging | Staging | n/a | Staging |
| Document + version + signed URL | Staging | Staging | Staging | Staging |
| Accounting entry / payment | Staging | Staging | n/a | Staging |
| Payroll / tax settings | Staging | Staging | Staging | Staging |
| Income document / PDF | Staging | Staging | Staging | Staging |
| Work item / DocFlow thread | Staging | Staging | Staging | Staging |
| Membership / settings / export | Staging | Staging | Staging | Staging |
| PostgREST same tables | Staging JWT | Staging JWT | n/a | Staging |

Use **synthetic** offices only. See `SECURITY_LAUNCH_GATES.md` gate 2.

### 3.5 RBAC matrix (server-side)

| Action | Platform Owner | Office Owner | Office Admin | Staff | Viewer | Invited (pending) | Portal client |
|---|---|---|---|---|---|---|---|
| Create org | n/a (no tenant) | yes (if no active membership) | no extra | no extra | no extra | blocked if pending invite | no |
| Invite users | no | yes | yes | no | no | no | no |
| Change role (not self, not owner) | no | yes | yes (can create other admins) | no | no | no | no |
| Set role = owner | no | no | no | no | no | no | no |
| Revoke access | no | yes | **no** (`revoke_user_access`) | no | no | no | no |
| Billing access | no | yes | **no** | no | no | no | no |
| Legal knowledge activate | **yes** (`assertPlatformOwner`) | no | no | no | no | no | no |
| Start trial / set TZ | no | office admin + `modules:write` | same | no | no | no | no |
| Accounting payment write | no | if permission | if permission | typically no | no | no | no |
| Issue income document | no | if module + perms | if module + perms | if granted | no | no | no |
| Payroll / tax tabs | no | office + module | office + module | assigned clients | view if granted | no | no |
| Export / signed download | no | if permitted | if permitted | if permitted | if permitted | no | portal-scoped |
| Owner console | email allowlist, no tenant role | **denied** | denied | denied | denied | denied | denied |

Effectiveness: **IMPLEMENTED — NOT VERIFIED** as a full matrix test. Deny-by-default is the intent of `requirePermission` + `requireOfficeAdministration` + `requireModuleActive`. Frontend hide is not authority.

### 3.6 API security and resilience

| ID | Control | Effectiveness | Evidence | Residual |
|---|---|---|---|---|
| C-A-01 | Authn on tenant routes | **VERIFIED EFFECTIVE** (code + prior review) | Routers use `authMiddleware` except documented public/cron/portal | Public surfaces listed in parallel audit |
| C-A-02 | Authz + tenant | **IMPLEMENTED — NOT VERIFIED** | requireOrg / permissions | Missed filter = IDOR (service role) |
| C-A-03 | Rate limit | **IMPLEMENTED — NOT VERIFIED** | In-memory; login/register/invite/recovery only | Multi-instance bypass; 15mb JSON; no edge WAF evidence |
| C-A-04 | Body size | **IMPLEMENTED — NOT VERIFIED** | `express.json({ limit: '15mb' })` | Cheap large-body resource use. **Do not flood production.** |
| C-A-05 | Timeouts | **PROVIDER-DEPENDENT — NOT VERIFIED** | Render request timeout not in repo | Hung Puppeteer / Supabase |
| C-A-06 | Pagination caps | **IMPLEMENTED — NOT VERIFIED** | Many `.limit(n)`; some 5000 | Heavy aggregates |
| C-A-07 | Idempotency | **IMPLEMENTED — NOT VERIFIED** | WE idempotency table **without RLS** | Parallel S-003 |
| C-A-08 | CORS | **IMPLEMENTED — NOT VERIFIED** | Allowlist + www twin; no-Origin allowed (cron) | Live `CORS_ALLOWED_ORIGINS` unknown; `app` 500 |
| C-A-09 | CSRF | **ALTERNATIVE CONTROL** | Bearer token not cookie for office; portal cookie is SameSite=Lax | XSS still wins |
| C-A-10 | Error leakage | **IMPLEMENTED — NOT VERIFIED** (unsafe) | `details` spread; pg hints | Parallel S-014 |
| C-A-11 | Dependencies | **ABSENT** CI audit | No dependabot/CodeQL/`npm audit` gate | Known-vuln deps | P1 | GitHub / NodexPro |
| C-A-12 | Debug in prod | **IMPLEMENTED — NOT VERIFIED** | Non-AppError message hidden when `NODE_ENV=production` | Live NODE_ENV unknown |

Low-skill disruption: **possible in principle** via 15mb JSON and unauthenticated health/recovery/register. This audit did **not** load-test production. Render/Vercel edge DDoS: **PROVIDER-DEPENDENT — NOT VERIFIED**.

### 3.7 Uploads and malware

| ID | Control | Effectiveness | Distinction |
|---|---|---|---|
| C-F-01 | Magic-byte + extension | **VERIFIED EFFECTIVE** (unit tests 2026-10-22) | File **type** validation |
| C-F-02 | Size limits | **IMPLEMENTED — NOT VERIFIED** | Guard + 15mb JSON |
| C-F-03 | SVG / HTML | **ALTERNATIVE CONTROL** | SVG excluded from settings images; HTML-as-text rejected; preview HTML escaped server-side |
| C-F-04 | Malware / AV | **ABSENT** | **Not the same as C-F-01** |
| C-F-05 | Quarantine | **ABSENT** | |
| C-F-06 | PDF isolation | **ABSENT** (`--no-sandbox`, no request intercept) | |
| C-F-07 | Signed URL TTL | **IMPLEMENTED — NOT VERIFIED** | 60–120s capability token |
| C-F-08 | Retention / delete | **ABSENT** product policy | Soft archive only |

### 3.8 Audit and forensics

| Event | Logged? | Effectiveness |
|---|---|---|
| Login success | Yes (`USER_LOGGED_IN`) | **IMPLEMENTED — NOT VERIFIED** |
| Login failure (office) | **No** `writeAudit` on invalid password | **ABSENT** |
| Owner login failure | Constant `OWNER_LOGIN_FAILED` exists | **IMPLEMENTED — NOT VERIFIED** |
| Account recovery | Owner recovery audited in places | **IMPLEMENTED — NOT VERIFIED** |
| MFA changes | N/A (no MFA) | **ABSENT** |
| Role / membership / org switch | Yes | **IMPLEMENTED — NOT VERIFIED** |
| Sensitive file open | Partial (signed URL paths vary) | **IMPLEMENTED — NOT VERIFIED** |
| Financial commands | Partial AB/income audit | **IMPLEMENTED — NOT VERIFIED** |
| Tax knowledge approve | Owner commands + audit helpers | **IMPLEMENTED — NOT VERIFIED** |
| Exports | Not systematically | **ABSENT** / sparse |
| Correlation ID | Yes (`correlationMiddleware`) | **VERIFIED EFFECTIVE** (code) |
| Integrity / append-only | App insert-only; tests delete rows | **ABSENT** (DB) |
| Retention / search / alerting | UI 12 months; no SIEM | **ABSENT** |

**Breach investigation today:** you can reconstruct some successful admin actions if `audit_log` was not deleted. You **cannot** reliably see failed office logins, bulk downloads, or PostgREST abuse. That is not forensic-ready.

### 3.9 Vulnerability management and independent QA

| Control | Effectiveness | Evidence |
|---|---|---|
| Dependency scanning | **ABSENT** | No dependabot / osv / npm-audit workflow |
| Secret scanning | **PROVIDER-DEPENDENT — NOT VERIFIED** | GitHub secret scanning not inspectable from repo |
| SAST | **ABSENT** | Architecture enforcer is **not** SAST |
| DAST | **ABSENT** | |
| CI security gate | **ALTERNATIVE CONTROL** | `architecture-enforcer.yml` only (`npm run architecture:check`) |
| Security regression tests | **IMPLEMENTED — NOT VERIFIED** as a gate | rate-limit, file-guard, TZ, AB two-org (AB needs DB) |
| External pentest | **ABSENT** | This Cursor review is **not** a pentest |
| Vuln tracking / SLAs / disclosure | **ABSENT** | No root `SECURITY.md` |
| Release security approval | **ABSENT** | Manual Render/Vercel |

**Professional QA sign-off requires:** written two-org IDOR report, live RLS/grant review, authenticated DAST, dependency CVE triage, MFA enforcement evidence, restore drill minutes, and an **independent** (non-author) pentest with a dated letter. Automated editor review does not qualify.

### 3.10 Backup, IR, infrastructure

See `SECURITY_BACKUP_RESTORE_PLAN.md` and `SECURITY_INCIDENT_RESPONSE.md`.

| Control | Effectiveness |
|---|---|
| Automated DB backup | **PROVIDER-DEPENDENT — NOT VERIFIED** |
| Tested restore | **ABSENT** |
| IR detection / alerting | **ABSENT** |
| Staging vs prod | **ABSENT** (`nodexpro-dev` not in repo) |
| Secret storage | **PROVIDER-DEPENDENT** (Render/Vercel/GitHub env) |
| Provider account MFA | **PROVIDER-DEPENDENT — NOT VERIFIED** |
| Public source maps | **IMPLEMENTED — NOT VERIFIED** (Vite default off; no `.map` in local dist) |
| Service-to-service auth | **ALTERNATIVE CONTROL** (cron shared secret, fail-closed) |
| DDoS / edge | **PROVIDER-DEPENDENT — NOT VERIFIED** |

---

## 4. Launch-readiness scorecard

Counts are **controls in §3**, not a 10/10 marketing score. Unknowns stay visible.

| Category | Applicable | Verified effective | Implemented unverified | Absent | Alternative | Provider-unknown | High/crit (parallel) | Evidence coverage | Launch-blocking? |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Identity & authentication | 10 | 0 | 2 | 6 | 1 | 1 | S-001, S-004–S-008, S-022 | Low | **YES** |
| Authorization / RBAC | 8 | 0 | 7 | 0 | 0 | 1 | S-011 | Medium | **YES** until matrix tested |
| Tenant isolation | 10 | 0 | 6 | 1 | 1 | 0 | S-002, S-032 | Low | **YES** |
| API security | 12 | 1 | 7 | 1 | 1 | 2 | S-014, S-017, S-018 | Medium | **YES** (abuse + errors) |
| Database / RLS | 5 | 0 | 1 | 2 | 0 | 2 | S-002, S-003 | Low | **YES** |
| Storage & documents | 8 | 1 | 3 | 3 | 1 | 0 | S-013, S-019, S-028 | Medium | **YES** |
| Encryption | 11 | 2 | 3 | 1 | 1 | 4 | S-009, S-010 | Low | **YES** |
| Logging & monitoring | 12 | 1 | 6 | 5 | 0 | 0 | P-005 | Low | **YES** |
| Infrastructure | 8 | 2 | 1 | 1 | 1 | 3 | I-004, I-005 | Medium | Partial (`app` 500) |
| Backup / recovery | 6 | 0 | 0 | 2 | 0 | 4 | I-001 | None | **YES** |
| Incident response | 8 | 0 | 0 | 8 | 0 | 0 | I-002 | None | **YES** |
| Secure SDLC / QA | 8 | 0 | 1 | 5 | 1 | 1 | — | Low | **YES** |

**Score rule:** a category cannot be “green” if it has an unverified launch-blocking control. No aggregate 7/10 is published because it would hide Detect/Recover = empty.

---

## 5. Launch blockers (top 10)

1. Suspended users retain API access (S-001).  
2. PostgREST authenticated writes + stale RLS helper (S-002) — live grants unconfirmed.  
3. No MFA for Platform Owner or office privileged roles.  
4. Office A/B isolation not proven (API + storage + PostgREST).  
5. Teudat Zehut plaintext + default hash salt possible.  
6. Payment OTP may land in logs; encryption key not verified in prod.  
7. No malware control on office documents.  
8. No tested backup restore.  
9. No detection/alerting/IR operators.  
10. No independent security QA / dependency gate.

---

## 6. Verified protections (narrow scopes)

- HTTPS on `www.nodexpro.com` and `nodexpro.onrender.com`.  
- HTTP→HTTPS 308/301 on those hosts.  
- HSTS header on www (Vercel).  
- WEB security headers: nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (live).  
- API health reports `db=ok`, `pdf_engine=ok`, marker `153556c7`.  
- WEB/API compatibility for live pair (WEB `5f649e04` assets, API `153556c7`).  
- No service-role key in first-party WEB source.  
- Magic-byte upload tests **pass**.  
- Registration rate-limit unit tests **pass**.  
- Teudat Zehut checksum / bypass / register-contract tests **pass**.  
- Cron routes fail closed if `INTERNAL_CRON_SECRET` unset.  
- Office invite return-path allowlist.  
- Platform owner API denied to tenant role context (`assertPlatformOwner`).

## 7. Missing protections

MFA, blocked-user API deny, PostgREST lockdown, storage policies, HttpOnly sessions, malware scan, failed-login audit, SIEM/alerts, IR, tested restore, erasure, dependabot/SAST/DAST, pentest, disclosure program, Tax Brain product surface.

## 8. Alternative protections

| Alternative | vs typical control | Equivalent? |
|---|---|---|
| App-layer org filter + service role | RLS on API queries | **Weaker.** One missed `.eq` is IDOR. Acceptable only with exhaustive tests + PostgREST revoke. |
| Bearer JWT (not cookie) | CSRF token | **Equivalent for CSRF**; **weaker for XSS**. |
| Magic-byte allowlist | Antivirus | **Not equivalent.** Type ≠ malice. |
| Payment-card SMS OTP | Login MFA | **Not equivalent.** Step-up for one reveal flow only. |
| SHA-256 TZ hash | Encryption of TZ | **Not equivalent** for secrecy; OK for trial uniqueness. |
| Architecture enforcer CI | SAST | **Not equivalent.** |
| Shared cron secret | mTLS | **Weaker** but fail-closed; OK if secret is strong and rotated. |

## 9. Provider-dependent unknowns

Supabase: disk encryption, PITR, Auth MFA project flags, leaked-password protection, JWT TTL, live GRANTs, storage policies, region.  
Render: instance count, WAF, HSTS, `NODE_ENV`, all listed secrets, log retention.  
Vercel: project MFA, sourcemap flags, `app.nodexpro.com` 500 root cause.  
GitHub: secret scanning, org MFA, Actions environment protection.  
Twilio / Resend: production enablement.

---

## 10. Architecture preservation (remediation constraint)

Any fix must keep **Core → Commands → Aggregate → UI**. No second identity, RBAC, billing, encryption, or audit framework. MFA must be Supabase AAL, not a home-grown IdP. Isolation fixes belong in Core middleware + DB grants, not in frontend. Financial writes stay Accounting Base commands. Legal activation stays Owner Legal Control. Work Engine keeps the work-event contract. DocFlow stays delivery evidence.

---

## 11. Tests completed vs required

**Completed (this + immediately prior audit, local/synthetic):**  
13 unit tests (rate-limit, file-content-guard, TZ). Live HTTPS/redirect/header/health. Source review. **Not** a pentest.

**Still required:** listed in `SECURITY_LAUNCH_GATES.md`.
