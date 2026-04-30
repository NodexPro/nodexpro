# Payment card — final security model (NodexPro)

## 1. Diagnosis

| Before | After |
|--------|--------|
| Encrypted JSON could include CVV | Encrypted payload is **only** `{ card_number, expiry }`; legacy blobs ignore `cvv` on read |
| Copy PAN/expiry with edit permission only | Copy requires **active 1h session** after **SMS OTP** to org phone |
| No OTP tables | `client_sensitive_access_challenges` + `client_sensitive_access_sessions` (migration `037`) |
| `organization_settings.phone` unused for this | OTP sent via **Twilio** if env set; else **console** in dev |

## 2. Schema (migration `037_payment_card_secure_sessions.sql`)

- `client_tax_settings.vat_card_holder_name`, `income_tax_card_holder_name` (plaintext display names, not secrets)
- `client_sensitive_access_challenges` — hashed OTP, expiry, attempts
- `client_sensitive_access_sessions` — one row per `(org, client, user, payment_context)` with `expires_at` (+1 hour)

## 3. Backend

| Endpoint | Purpose |
|----------|---------|
| `GET .../tax-settings` | Includes `payment_secure_sessions`, `client_tax_id`, `client_display_name`, holder names |
| `PATCH .../tax-settings` | Saves card without CVV; encrypts `{ card_number, expiry }` |
| `POST .../payment-card/request-code` | `{ type: vat \| income_tax }` → `{ challenge_id, expires_in_seconds }` |
| `POST .../payment-card/verify-code` | `{ type, challenge_id, code }` → `{ secure_session_active, expires_at }` |
| `POST .../reveal-payment-secret` | `{ type, secret_kind: card_number \| expiry }` — requires active session |

Service: `payment-card-access.service.ts` (OTP hash, Twilio, session checks).

## 4. Audit / `client_tax_settings_event_log`

- `payment_card_access_code_sent`, `payment_card_secure_session_granted`
- `payment_card_number_copied`, `payment_card_expiry_copied` (never PAN/expiry text in `new_value`)

## 5. Frontend

- Dumb UI: masked fields, edit modal with holder + PAN + expiry; **CVV helper text only**
- Copy → reveal; on `SECURE_SESSION_REQUIRED` → request-code → verify modal → retry reveal
- `ApiError` with `code` from JSON

## 6. Testing checklist

1. Save card → DB ciphertext has no CVV field in new saves  
2. Normal GET → masked PAN, no full number  
3. Copy without session → SMS (or console) + verify modal  
4. Verify → session ~1h → copy works  
5. After expiry → copy triggers code again  
6. CVV never in DB / logs  
7. Cross-org blocked (existing checks)  
8. Org phone missing → clear Hebrew error  
