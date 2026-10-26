# Render production env for `apps/api`

## Service settings (Root Directory = `apps/api`)

Typical commands:

- **Build:** `npm install && npm run build`
- **Start:** `npm start` (`node dist/index.js`)

`postinstall` runs `scripts/ensure-puppeteer-chrome.mjs`, which installs Chrome into
`apps/api/.cache/puppeteer` (`PUPPETEER_CACHE_DIR`). On Render (`RENDER=true`) / production
this step **hard-fails** if Chrome cannot be installed or resolved — do not deploy a broken PDF engine.

Optional override (not required when postinstall succeeds):

- `PUPPETEER_EXECUTABLE_PATH` — absolute path to Chrome/Chromium
- `CHROMIUM_PATH` — same, alternate env name
- `PUPPETEER_CACHE_DIR` — defaults to `<api cwd>/.cache/puppeteer`
- `NODEXPRO_REQUIRE_PDF_BROWSER=1` — force hard-fail even outside Render
- `NODEXPRO_ALLOW_MISSING_PDF_BROWSER=1` — emergency escape hatch (not for normal prod)

## Required env

Set these environment variables in Render for production deploy:

- `NODE_ENV=production`
- `PORT` (provided by Render automatically; backend reads `process.env.PORT`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_DATA_ENCRYPTION_KEY`
- `CORS_ALLOWED_ORIGINS=https://app.nodexpro.com,https://nodexpro.com,https://nodexpro.vercel.app`
- `CORS_ALLOW_CREDENTIALS=false`
- `PLATFORM_OWNER_EMAIL=marinator.321@gmail.com` (single platform owner; use a different email for org/tenant users)
- `PLATFORM_OWNER_PHONE` (SMS OTP for owner password recovery)
- `PLATFORM_OWNER_PASSWORD_HASH` (optional legacy)

DocFlow invite delivery / email provider (only if used in production):

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Phase 5 containment kill switch (Render → nodexpro → Environment):

- `SECURITY_CONTAINMENT_ENABLED` — optional. Exact value `true` enables automatic containment enforcement.
- If the variable is missing, empty, `false`, or any other value, enforcement stays **disabled**.
- Detection, incident logging and security-alert notifications continue while enforcement is off.
- Existing containment rows remain stored; they are not enforced until the switch is `true`.
- This does not disable login, RBAC, tenant isolation or ordinary authorization.

Emergency disable (no UI required):

1. Render → service `nodexpro` → Environment.
2. Set `SECURITY_CONTAINMENT_ENABLED=false` or delete the variable.
3. Save and wait for the service restart.
4. Confirm `GET /api/v1/health` is healthy. Owner Security will show containment enforcement disabled.

Edge / WAF (do not set EDGE_PROTECTION_VERIFIED until DNS and live rules are confirmed):

- `CLOUDFLARE_ORIGIN_PROTECTION` — exact `true` rejects requests without the origin-pull secret. Health stays open for Render.
- `CLOUDFLARE_ORIGIN_PULL_SECRET` — shared secret added by the Cloudflare Transform Rule. Direct `nodexpro.onrender.com` bypass is then rejected.
- `EDGE_PROTECTION_VERIFIED` — exact `true` only after Owner confirms WAF is live on both `www.nodexpro.com` and the API hostname. The API never self-claims WAF is active.

Document malware scanning (fail closed only when required):

- `DOCUMENT_MALWARE_SCAN_REQUIRED` — exact `true` rejects uploads when ClamAV/HTTP scanner is missing or down.
- `CLAMD_HOST` / `CLAMD_PORT` — ClamAV daemon. Or `DOCUMENT_SCAN_URL` for an HTTP scanner that returns `{ "infected": boolean }`.
- Unset required flag: content guard still runs; files are stored as `not_configured` and are never labeled malware-free.

Re-enable only after explicit Owner approval:

1. Set `SECURITY_CONTAINMENT_ENABLED=true`.
2. Save and wait for restart.
3. Confirm Owner Security shows containment enforcement enabled.

Health check endpoint for Render:

- `GET /api/v1/health` (expects `200` and `{ "ok": true, "db": "ok", "pdf_engine": "ok"|"unavailable" }`)
- `pdf_engine` is path-existence only (no Chrome launch on health)
