# Platform owner (single account)

Access to `/api/v1/owner/*` is decided **only in the backend** (`assertPlatformOwner` in `src/shared/platform-owner.ts`) by matching the signed-in user’s email to `PLATFORM_OWNER_EMAIL`.

There is **no** `platform_owner` row in app RBAC; do not add frontend email checks.

## Environment (Render / local)

| Variable | Required | Description |
|----------|----------|-------------|
| `PLATFORM_OWNER_EMAIL` | Yes | Lowercase email allowed to use owner APIs (e.g. `marinator.321@gmail.com`). |
| `PLATFORM_OWNER_PHONE` | Yes* | Owner phone for **SMS OTP** during password recovery. Israel format `0544678275` is normalized to E.164. |
| `TWILIO_ACCOUNT_SID` | Yes* | SMS provider. |
| `TWILIO_AUTH_TOKEN` | Yes* | |
| `TWILIO_FROM_NUMBER` | Yes* | E.164 sender. |
| `SENSITIVE_ACCESS_CODE_PEPPER` or `CLIENT_DATA_ENCRYPTION_KEY` | Recommended | Used to hash OTP at rest (never log OTP). |

\*In `development`, if Twilio is missing, recovery SMS is skipped (warning only). In `production`, Twilio is required.

## Fix `PLATFORM_OWNER_NOT_CONFIGURED`

Set `PLATFORM_OWNER_EMAIL` in the API environment and redeploy. This error means the email env var was unset.

## Provisioning the user (Supabase)

1. Create the user in **Supabase Auth** (email + password) with the same email as `PLATFORM_OWNER_EMAIL`.
2. Ensure a row exists in `public.users` with `email` and `auth_user_id` linked to that auth user (normal app registration or sync).
3. Apply migration `098_platform_owner_password_recovery.sql` for the OTP challenge table.

## Password recovery (SMS OTP)

- `POST /api/v1/owner/password-recovery/request` — body `{ "email" }` (must match `PLATFORM_OWNER_EMAIL`).
- `POST /api/v1/owner/password-recovery/verify` — body `{ "recovery_session_id", "code" }`.
- `POST /api/v1/owner/password-recovery/complete` — body `{ "recovery_session_id", "new_password" }`.

Session check for the SPA:

- `GET /api/v1/owner/session` (authenticated) — returns `platform_owner_session_aggregate` or **403** if not the owner.

## Test steps

1. Set env including `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PHONE` and Twilio.
2. Run migration `098_*.sql`.
3. Open `/platform-owner/login`, sign in with the owner user → should reach legal control; sign in with another user → `GET /owner/session` returns 403 and UI shows access denied.
4. Password recovery: open “Forgot password?”, enter owner email → receive SMS → verify code → set new password → sign in with new password.
