# NodexPro — Security Launch Gates

**Date:** 2026-10-22  
**Companion to:** `SECURITY_ENTERPRISE_BENCHMARK.md`, `SECURITY_READINESS_AUDIT.md`  
**Decision rule:** a launch is allowed only if every **critical gate** is **PASS**.  
`NOT VERIFIED` on a critical gate is a **launch fail**. Unknown is not a pass.

**Release decision: DO NOT LAUNCH** for real confidential customer data.

This is not a certification. Passing future gates still requires an independent pentest before a “professionally audited” claim.

---

## How to use this file

- **PASS** — implementation exists **and** evidence (test, header, dashboard export, drill minutes) was recorded on a dated line.  
- **FAIL** — control missing or proven ineffective.  
- **NOT VERIFIED** — may exist at a provider; no evidence in this audit.

Owners: NodexPro (engineering/product), Supabase, Render, Vercel, GitHub, Legal, independent QA.

Do not change production RLS, rotate secrets, or deploy from this document. Execute remediations as separate, reviewed tasks.

---

## Critical gates

| Gate | Statement | Status now | Evidence on file | Required evidence to PASS | Owner |
|---|---|---|---|---|---|
| G1 | No known exploitable CRITICAL vulnerabilities | **FAIL** | Parallel S-001 (blocked users keep API access). S-002/S-003 critical if live grants match migrations | Fix S-001. Prove PostgREST grants revoked. RLS on OTP/idempotency tables. Re-test. | NodexPro |
| G2 | No unresolved HIGH-risk cross-tenant exposure | **NOT VERIFIED** (treated as fail) | Spot-check only; PostgREST write policies in migrations | Office A/B HTTP matrix + PostgREST JWT tests on staging. Zero cross-tenant reads/writes/downloads. | NodexPro + independent QA |
| G3 | No unresolved HIGH-risk privilege escalation | **FAIL** | S-001 privilege retention; S-011 member→admin unproven; no MFA | Middleware deny non-active; inventory legacy roles; MFA for privileged roles | NodexPro |
| G4 | No unauthorized confidential file access | **NOT VERIFIED** | Signed URLs 60–120s; no storage.objects policies in repo | Storage policy dump; A/B signed-URL tests; no public buckets | NodexPro / Supabase |
| G5 | Privileged account protection verified | **FAIL** | No MFA; owner login bypasses API limiter; recovery enumerates email | Supabase TOTP enforced for Platform Owner + office owner/admin; owner login rate-limited; generic recovery | NodexPro / Supabase |
| G6 | Production secrets appropriately protected | **NOT VERIFIED** | No secrets in first-party source. Default TZ salt and OTP pepper exist in code. `RENDER_ENV.md` incomplete | Dashboard attestation: unique `LEGAL_IDENTITY_HASH_SALT`, `INTERNAL_CRON_SECRET`, `CLIENT_DATA_ENCRYPTION_KEY`, pepper, no default salts. GitHub/Render access logged | NodexPro / Render / GitHub |
| G7 | Database and storage access controls verified | **NOT VERIFIED** | RLS helper stale; two tables without RLS; service role for API | Live `\dp` / policies export; `REVOKE` authenticated writes; storage deny-all; helper uses `organization_memberships` | NodexPro / Supabase |
| G8 | Backups exist and restoration has been tested | **NOT VERIFIED** | Phase 0 §7.7 Deferred | PITR/backup screenshot + **staging** restore drill minutes (see backup plan). Never restore over production | NodexPro / Supabase |
| G9 | Security logging and IR operational | **FAIL** | Office login failures not audited; no alerts/runbook operators | Failed-login audit; alert destination; tabletop completed (`SECURITY_INCIDENT_RESPONSE.md`) | NodexPro |
| G10 | Production API and WEB versions compatible | **PASS** | API `153556c7`; WEB assets `index-IGcXPb_J.js` (`5f649e04`). API contains WEB command surface | Re-check health + index.html on every release | NodexPro / Render / Vercel |
| G11 | Sensitive financial/tax ops authorized and audited | **NOT VERIFIED** | AB payment permission checks exist; leftover PATCH; Tax Brain absent | Command-only writes; audit samples; leftover PATCH disabled or equivalently authorized | NodexPro |
| G12 | Required security regression tests pass | **NOT VERIFIED** as a release gate | 13 local tests passed this week; not in CI as a security gate; AB two-org needs DB | CI job: rate-limit, file-guard, TZ, AB isolation, new A/B IDOR, blocked-user deny | NodexPro / GitHub |

**Critical gate tally:** PASS 1 · FAIL 4 · NOT VERIFIED 7  
**Launch:** **FAIL**

---

## Supporting gates (not sufficient alone)

| Gate | Status | Notes | Owner |
|---|---|---|---|
| S-G-01 HTTPS + HTTP→HTTPS on www and API | **PASS** | 308 / 301 observed 2026-10-22 | Vercel / Render |
| S-G-02 HSTS on WEB | **PASS** (www) | Vercel header; not in `vercel.json` | Vercel |
| S-G-03 CSP enforcement | **FAIL** | Report-Only live. Do not enforce until authenticated regression | NodexPro |
| S-G-04 `app.nodexpro.com` healthy | **FAIL** | HTTP 500 during audit | Vercel / NodexPro |
| S-G-05 Magic-byte upload tests | **PASS** | `file-content-guard.pure.spec.ts` | NodexPro |
| S-G-06 Malware strategy documented | **FAIL** | Type check ≠ AV | NodexPro |
| S-G-07 No service-role in WEB source | **PASS** (repo) | Live bundle scan still needed | NodexPro |
| S-G-08 Dependency / secret scanning | **NOT VERIFIED** / **FAIL** in CI | No dependabot/CodeQL workflow | GitHub |
| S-G-09 Independent pentest letter | **FAIL** | Cursor audit ≠ pentest | Independent QA |
| S-G-10 Privacy / erasure / legal review | **FAIL** | No erasure; IL counsel required | Legal + NodexPro |
| S-G-11 Architecture: no new generic PATCH | **FAIL** | Legacy PATCH still mounted | NodexPro |
| S-G-12 WEB/API deploy markers recorded | **PASS** for this snapshot | Must be a release checklist item | NodexPro |

---

## Required tests (staging / isolated)

Use **synthetic** Office A / Office B only. Never production customer data.

### Isolation (Gate G2, G4)

1. Create users A-owner, A-staff, B-owner.  
2. For each tenant resource type: A requests B’s UUID on GET, command POST, leftover PATCH, export, PDF, signed URL. Expect 404/403, never 200 with B data.  
3. Repeat with `X-Organization-Id: B` while authenticated as A — header must be ignored.  
4. Repeat via PostgREST (`/rest/v1/...`) with A’s JWT.  
5. After A revoke of a member, leftover `organization_users` must not grant REST access.

### Privilege (G3, G5)

6. Suspended user: `/auth/session` blocked **and** `/clients` 401/403.  
7. Staff cannot `change_member_role` or hit `/owner/*`.  
8. Admin cannot set role `owner` or change self.  
9. Platform owner with a tenant membership is denied owner APIs (current design).  
10. Privileged login without AAL2 is denied once MFA is on.

### Files (G4)

11. Object in B’s prefix is not signable by A.  
12. Expired signed URL 403.  
13. HTML/SVG/polyglot rejected or sanitized as specified.

### Secrets / crypto (G6)

14. API refuses to boot or refuses TZ/payment paths if default salt / missing encryption key.  
15. Audit payloads never contain raw TZ or OTP.

### Backup (G8)

16. Execute `SECURITY_BACKUP_RESTORE_PLAN.md` staging drill. Attach minutes.

### IR (G9)

17. Generate failed logins; confirm rows + alert.  
18. Complete tabletop in the IR doc.

### Compatibility (G10)

19. `GET /api/v1/health` marker equals intended API SHA.  
20. Production `index.html` asset hashes equal intended WEB SHA.

---

## External QA evidence (professional sign-off)

An independent reviewer (not the implementing author) must supply:

- Dated pentest report (API + WEB + PostgREST + storage).  
- CVE triage of `npm audit --omit=dev` for `apps/api` and `apps/web`.  
- Confirmation that GitHub secret scanning and provider MFA are on.  
- Restore-drill attestation.  
- Statement that they did **not** rely solely on unit tests or this markdown.

Until that exists, marketing must not say “independently security audited.”

---

## Explicit release decision

| Question | Answer |
|---|---|
| May NodexPro accept real client PII, tax, payroll, banking, TZ, and confidential files in production? | **NO** |
| May a closed beta use synthetic or consented dummy data? | Product decision; security gates still FAIL for confidential classes |
| Are WEB and API compatible today? | **YES** (G10 PASS) |
| Did this audit deploy anything? | **NO** — API NO / WEB NO / MIGRATION NO |

Re-evaluate only after P0 items in the benchmark are closed **and** G1–G12 are PASS with attached evidence.
