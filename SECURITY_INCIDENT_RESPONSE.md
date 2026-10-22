# NodexPro — Incident Response Checklist

**Date:** 2026-10-22  
**Status of the program:** **NOT OPERATIONAL.** This is a playbook to stand up, not evidence that alerts already fire.  
**Parallel audit:** no SIEM, no on-call, no failed-office-login audit (`SECURITY_READINESS_AUDIT.md` I-002, S-001, S-014).

Do not pretend detection exists. Until alerts are wired, **humans** must assume they will discover incidents via customer report, provider email, or manual log review.

Preserve **Core → Commands → Aggregate → UI**. Containment uses existing Auth (Supabase session revoke), membership revoke, and provider dashboards. Do not bolt on a second identity system during an incident.

---

## 1. Classification

| Severity | Examples | Initial goal | Comms |
|---|---|---|---|
| **SEV-1** | Confirmed cross-tenant data exposure; service-role leak; mass file download; ransomware on DB; Platform Owner compromise | Contain in minutes | Immediate internal; legal/customers when impact confirmed |
| **SEV-2** | Privileged account takeover (office owner); payment-secret log leak; PostgREST write abuse; TZ dump | Contain in hours | Affected tenants |
| **SEV-3** | Single-tenant unauthorized access; XSS leading to one session theft; brute-force noise | Investigate same day | Tenant admin |
| **SEV-4** | Failed attacks, scanner noise, dependency CVE with no exploit path | Track | Internal only |

If classification is unclear, start as SEV-2.

---

## 2. First 30 minutes (all SEV-1/2)

1. **Name an incident lead.** One person speaks to providers and customers.  
2. **Open a written timeline** (time, actor, action, evidence path). Do not edit production data “to clean up.”  
3. **Snapshot evidence** before rotation:
   - API `correlation_id`s from client reports  
   - Render logs window  
   - Supabase Auth logs / API logs if available  
   - `audit_log` and `system_audit_log` **export** (do not DELETE)  
   - Health: `GET https://nodexpro.onrender.com/api/v1/health` (marker, db, pdf)  
   - WEB asset hashes from `index.html`  
4. **Do not** restore over production. **Do not** `git push --force`. **Do not** disable TLS or CSP as a “fix.”  
5. **Decide containment** (section 3) before public statements.

---

## 3. Session and credential containment

Use existing mechanisms only.

| Action | How | Owner |
|---|---|---|
| Revoke one user | Supabase Auth: sign out / logout all sessions for `auth.users` id. Also set `users.status` to `suspended` — **today the API still authorizes suspended users (S-001).** Until that is fixed, **revoking the JWT/refresh is the real control.** | NodexPro + Supabase |
| Revoke Platform Owner | Same + change owner password via recovery **after** confirming the recovery channel is not the attacker. Rotate `PLATFORM_OWNER_*` only through Render dashboard. | NodexPro |
| Revoke office membership | `revokeUserAccessRbac` (owner). Confirm `organization_memberships` **and** `organization_users` are not left `active`. | NodexPro |
| Rotate leaked service role | Supabase dashboard → new service role → update Render `SUPABASE_SERVICE_ROLE_KEY` → restart `nodexpro` (**not** `nodexpro-dev`) → invalidate old key | NodexPro / Supabase / Render |
| Rotate cron secret | New `INTERNAL_CRON_SECRET` on Render **and** matching GitHub Actions secrets | NodexPro / GitHub / Render |
| Rotate field-encryption key | **Dangerous.** Old payment blobs become unreadable. Plan dual-key unwrap; do not blindly rotate `CLIENT_DATA_ENCRYPTION_KEY` | NodexPro |
| Rotate TZ hash salt | Breaks trial uniqueness correlation; do not rotate in panic without a migration plan | NodexPro |
| Take API offline | Render suspend `nodexpro` only if leak is active and uncontainable | NodexPro / Render |

Office logout `POST /auth/logout` is **not** proven to revoke refresh tokens (S-022). Prefer Supabase admin revoke.

---

## 4. Tenant impact analysis

1. Identify `organization_id`s from audit rows, signed-URL paths (`{orgId}/...`), and customer tickets.  
2. For each org: list actors (`actor_user_id`), resource types (clients, documents, income, payroll, TZ), time window.  
3. Check whether the actor was a member at that time (membership + invite tables).  
4. If PostgREST is suspected: assume **any table with authenticated write policies** may have been touched (parallel audit S-002). Export those tables’ `updated_at` in the window.  
5. Files: list `file_assets` / document versions created or signed in the window. Treat signed URLs as already world-reachable for their TTL (60–120s) plus any copy.  
6. Produce: “orgs affected / not affected / unknown.” **Unknown stays unknown.**

---

## 5. Evidence preservation

- Export `audit_log`, `system_audit_log`, Auth logs, Render logs to **write-once** storage (object bucket with object lock if available).  
- Record API deploy_marker and WEB asset hashes.  
- Do not run `DELETE FROM audit_log` (tests do this in CI; production must not).  
- Screenshot provider dashboards (IAM, API keys last-used).  
- If malware in an upload is suspected: **do not open the file on an office laptop.** Copy the storage object to a quarantine project.

Legal hold: Israeli professional-secrecy and Privacy Protection Law may apply. Escalate to counsel before sending tenant data off-platform.

---

## 6. Recovery

1. Attacker sessions dead (section 3).  
2. Patch the failing control on a branch; review; deploy **only** the affected surface (API Render `nodexpro` and/or isolated WEB).  
3. Re-check G10: health marker + `index.html` hashes.  
4. If data was changed: restore **into staging** first (`SECURITY_BACKUP_RESTORE_PLAN.md`), then a measured production repair — never a blind overwrite.  
5. Re-issue documents/passwords only for proven-affected users.  
6. Post-incident: add a regression test for the exact hole. That test becomes part of G12.

---

## 7. Communications (template)

**Internal (immediately):** severity, lead, what is known, what is unknown, next checkpoint time.

**Customer (after impact confirmed, not before):**

- What happened (plain language, no speculative root cause).  
- What data classes **may** be involved (do not list other tenants).  
- What you already did (session revoke, patch).  
- What they should do (reset password, enroll MFA when available).  
- Contact for questions.

Do not claim “no evidence of access” unless logs could have shown it. Today, failed office logins and PostgREST are **not** fully logged.

---

## 8. Detection gaps (do not rely on these until built)

| Desired detection | Current |
|---|---|
| Suspicious logins / spray | Office failures **not** audited; owner recovery rate-limited only |
| Abnormal API traffic | No metrics/alerts in repo |
| Cross-tenant 403 spikes | Not aggregated |
| Excessive downloads | Signed URL issuance not centrally alerted |
| Privilege escalation | Role-change **is** audited if the command path is used |
| Alert delivery | **None configured in repo** |

**Minimum to call IR “operational” (Gate G9):**

1. Audit office login failures (no raw password).  
2. Alert (email/SMS) to a named human on: N failed logins, owner recovery, service 5xx burst, cron 403 burst.  
3. This document assigned to an on-call.  
4. One tabletop completed (below).

---

## 9. Tabletop exercise (90 minutes, synthetic)

**Scenario:** A former staff member still has a refresh token after “suspend.” They `GET` another office’s client UUID they wrote down last month, then `POST` a PostgREST update on `clients`.

**Injects (every 15 min):**

1. Customer of Office B reports a wrong phone number on a client.  
2. Health still `ok`.  
3. `users.status=suspended` for the actor; APIs still 200 (if S-001 unfixed).  
4. Render logs show `/rest/v1` is **not** visible (browser hit Supabase directly).  
5. Legal asks which orgs were read.

**Score the team:**

- Did they revoke **tokens**, not only flip status?  
- Did they check PostgREST, not only the NodexPro API?  
- Did they export audit before rotating keys?  
- Did they avoid restoring production?  
- Did comms distinguish known vs unknown?

Record date, attendees, gaps. Re-run after S-001 and S-002 are closed.

---

## 10. Roles

| Role | Responsibility |
|---|---|
| Incident lead | Decisions, comms |
| Engineering | Logs, patch, deploy markers |
| Provider operators | Supabase / Render / Vercel / GitHub access (MFA **NOT VERIFIED**) |
| Legal / privacy | IL notice duties |
| Customer success | Tenant list, wording |

Until names are filled, the program is **not** operational.
