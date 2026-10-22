# NodexPro — Backup and Restore Plan

**Date:** 2026-10-22  
**Companion to:** `SECURITY_ENTERPRISE_BENCHMARK.md` gate G8, `SECURITY_READINESS_AUDIT.md` I-001 / P-001.  
**Rule:** a backup that has never been restored is **not** a recovery capability.

**Current status: NOT VERIFIED.** Phase 0 `docs/architecture/phase-0/07-security-baseline.md` §7.7 still says backup SLA is **Deferred**. This repository has **no** restore runbook, RPO/RTO, or drill minutes.

Do **not** restore over production. Do **not** run destructive tests on the live Supabase project.

---

## 1. What is verified today

| Item | Status | Evidence |
|---|---|---|
| Application “restore” of an archived **client** | **NOT a DR control** | `orgClientRestore` / clients archive — tenant UX, not database recovery |
| Automated Postgres backups | **PROVIDER-DEPENDENT — NOT VERIFIED** | Supabase typically offers daily backups / PITR on paid plans. **Dashboard not inspected** |
| Backup frequency / retention | **NOT VERIFIED** | — |
| PITR window | **NOT VERIFIED** | — |
| Backup encryption | **PROVIDER-DEPENDENT — NOT VERIFIED** | Usually yes on Supabase; no attestation on file |
| Who can download backups | **NOT VERIFIED** | Project owner / service role risk |
| Storage object versioning / backup | **NOT VERIFIED** | Buckets `client-files`, `document-files`, `organization-assets`, `income-documents` |
| Render / Vercel config backup | **NOT VERIFIED** | Env vars live in dashboards; no `render.yaml` |
| Git as config backup | **ALTERNATIVE CONTROL** | Source and migrations are in git; **secrets and live data are not** |
| Evidence of a successful restore | **ABSENT** | No minutes, no staging project |
| RPO / RTO targets | **ABSENT** | Proposed below, not approved |

---

## 2. Data classes and recovery needs

| Class | Store | If lost | Suggested RPO | Suggested RTO |
|---|---|---|---|---|
| Organizations, memberships, RBAC | Postgres | Platform unusable | 1 hour (PITR) | 4 hours |
| Clients, tax, payroll, accounting, income | Postgres | Financial/legal harm | 1 hour | 4–8 hours |
| Teudat Zehut (plaintext today) | Postgres | Identity incident | 1 hour + treat restore as **sensitive** | 4 hours |
| Payment secrets (AES-GCM blobs) | Postgres | Need **same** `CLIENT_DATA_ENCRYPTION_KEY` | 1 hour | 4 hours (key restore too) |
| File bytes | Supabase Storage | Documents gone even if rows remain | 24 hours (versioning) | 8–24 hours |
| Audit logs | Postgres | Forensics gap | 1 hour; **never purge during IR** | 4 hours |
| Auth users | Supabase Auth | Login broken | Provider backup | 4 hours |
| WEB/API code | Git | Redeploy | n/a | 1 hour |
| Env / secrets | Provider vaults | Encrypt/cron/owner fail | Offline sealed copy | 2 hours |

These numbers are **proposals** for a launch-grade accounting product. They are not contractual SLOs until product/legal sign.

---

## 3. Missing evidence to collect (read-only)

From **Supabase** (screenshot + date, no secrets):

- Plan name (Free / Pro / Team) and whether PITR is enabled.  
- Backup schedule and retention days.  
- Region and whether backups leave the region.  
- Storage: versioning, replication, soft-delete.  
- Who has `Owner` / `Administrator` on the project.

From **Render** (`nodexpro` only):

- Disk vs ephemeral. Puppeteer cache is not customer data.  
- Whether any persistent disk holds temp PDFs.

From **Vercel**:

- Project is rebuildable from git (yes, if SHA known).

Store attestations in an internal folder **outside** this git repo if they contain account identifiers.

---

## 4. Safe staging restore drill (synthetic only)

**Goal:** prove that a backup can become a working API+WEB against **synthetic** offices, with tenant isolation intact.

### 4.1 Preconditions

- A **separate** Supabase project (e.g. `nodexpro-restore-drill`). Never the production project.  
- A **separate** Render service or local API pointed at the drill project. Never switch production `SUPABASE_*` at the drill.  
- Synthetic seed: Office A, Office B, one client each, one file each, one payment-secret blob encrypted with a **drill** key.  
- Written rollback: drill project can be destroyed.

### 4.2 Steps

1. Record production backup timestamp (do not download prod data into a laptop unnecessarily; if using a **copy** of prod, **tokenize/anonymize** first — a raw prod restore into staging is a **privacy event** and needs legal approval).  
   **Preferred first drill:** backup/restore of the **synthetic** project only (prove the mechanics).  
2. Create drill project. Restore the synthetic backup or PITR to time T.  
3. Set drill API env: drill Supabase URL/keys, **drill** `CLIENT_DATA_ENCRYPTION_KEY`, drill cron secret.  
4. Run:  
   - `GET /api/v1/health` → db ok.  
   - Login as A: see only A’s client and file.  
   - Login as B: see only B.  
   - Decrypt A’s payment secret with the drill key; confirm B cannot.  
   - Open A’s signed URL; confirm B cannot sign A’s object.  
5. Record: start time, restore finished time (RTO sample), data age (RPO sample), pass/fail of isolation checks, names of operators.  
6. Destroy drill project keys. Delete local dumps with a checklist.

### 4.3 What this drill does **not** prove

- Geographic failover.  
- Ransomware if the attacker also has the backup bucket.  
- Storage objects if only Postgres was restored.  
- Auth user passwords if Auth was not included.  
- Production performance.

---

## 5. Recovery scenarios

| Scenario | Intended action | Blocker today |
|---|---|---|
| Accidental `DELETE` of one org’s rows | PITR to staging, extract org, apply measured repair | PITR unverified |
| Bad migration | Revert migration on a branch; restore drill first | Extra uncommitted migrations 140–163 exist as WIP — do not confuse with prod |
| Ransomware / stolen service role | Rotate keys (IR doc); restore to **new** project; cut DNS | No drill; storage may also be encrypted/deleted |
| Lost `CLIENT_DATA_ENCRYPTION_KEY` | Payment secrets **unrecoverable** | Keep sealed offline copy; dual-control |
| Render service wipe | Redeploy `apps/api` at known SHA to `nodexpro` | Auto-Deploy OFF (operator convention); need the SHA |
| Vercel wipe | Redeploy isolated WEB worktree at known SHA | Record asset hashes |

---

## 6. Recovery verification checklist (attach to every drill)

- [ ] Drill project ≠ production URL  
- [ ] No production secrets pasted into drill  
- [ ] Health ok  
- [ ] Office A cannot read Office B (API + file)  
- [ ] Payment blob decrypts with drill key only  
- [ ] Audit rows from the backup era present  
- [ ] Storage objects for the sample files present **or** explicitly recorded as missing  
- [ ] Minutes signed (date, RPO observed, RTO observed, gaps)  
- [ ] Drill destroyed  

Until a completed copy of this checklist exists, **Gate G8 remains NOT VERIFIED** and launch remains **NO**.

---

## 7. P0/P1 work to make G8 pass

**P0**

1. Open Supabase dashboard; record plan, PITR, retention (read-only).  
2. Turn on PITR if the plan allows and it is off.  
3. Schedule the **synthetic** restore drill; attach minutes.  
4. Sealed backup of production env var **names** (not values) + procedure to retrieve values from Render.

**P1**

5. Storage versioning or bucket replication.  
6. Document Auth backup coverage.  
7. Quarterly drill; after every major schema release.  
8. Legal review of whether a masked prod-subset restore is allowed.

**P2**

9. Cross-region strategy.  
10. Automated “restore smoke” in a disposable project.

**P3**

11. Contractual RPO/RTO in customer terms (only after drills exist).
