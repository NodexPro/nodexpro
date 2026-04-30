# Render production env for `apps/api`

Set these environment variables in Render for production deploy:

- `NODE_ENV=production`
- `PORT` (provided by Render automatically; backend reads `process.env.PORT`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_DATA_ENCRYPTION_KEY`
- `CORS_ALLOWED_ORIGINS=https://app.nodexpro.com,https://nodexpro.com,https://nodexpro.vercel.app`
- `CORS_ALLOW_CREDENTIALS=false`
- `PLATFORM_OWNER_EMAIL`
- `PLATFORM_OWNER_PASSWORD_HASH`

DocFlow invite delivery / email provider (only if used in production):

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Health check endpoint for Render:

- `GET /api/v1/health` (expects `200` and `{ "ok": true }`)
