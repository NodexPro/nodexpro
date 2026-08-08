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

Health check endpoint for Render:

- `GET /api/v1/health` (expects `200` and `{ "ok": true, "db": "ok", "pdf_engine": "ok"|"unavailable" }`)
- `pdf_engine` is path-existence only (no Chrome launch on health)
