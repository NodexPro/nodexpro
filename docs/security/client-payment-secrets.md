# Client payment secrets (NodexPro)

## 1. Diagnosis (before this change)

- **Already good:** `client_tax_settings` stores PAN/CVV/expiry only in `*_payment_details_encrypted` (AES-256-GCM via `CLIENT_DATA_ENCRYPTION_KEY`), with `*_card_last4` and `*_card_expiry_masked` for safe display. RLS on org from migration `035_client_tax_settings.sql`. Workspace/tax GET returns **no** ciphertext and **no** full card via `rowToPublic`.
- **Gaps fixed:** The legacy `POST .../tax-settings/full-card` returned **all** card fields in one response (bulk reveal). Frontend used a text button to copy everything. **Audit** logged access but not per-field granularity.

## 2. Schema plan

| Item | Decision |
|------|----------|
| `client_tax_settings` | **Reused** — no duplicate table, no new columns. |
| `client_tax_settings_event_log` | **Reused** — new `action_type` values: `reveal_payment_secret` (and existing `update_tax_settings`). |
| `audit_log` | **Reused** — action `client_tax_settings.payment_secret_revealed` with non-secret payload. |

**No new migration** in this iteration (schema already supports encrypted blobs + audit).

## 3. Migration SQL

Not required for this feature. If you add constraints on `client_tax_settings_event_log.action_type`, add an idempotent enum/check in a new migration.

## 4. Backend

| Endpoint | Role |
|----------|------|
| `GET /m/client-operations/clients/:clientId/tax-settings` | Masked settings + `card_number_masked` derived server-side. |
| `PATCH .../tax-settings` | Encrypt on save; `encryptJson`; log updates without plaintext secrets. |
| `POST .../tax-settings/reveal-payment-secret` | Body: `{ type: 'vat' \| 'income_tax', secret_kind: 'card_number' \| 'cvv' \| 'expiry' }` → `{ value: string }`. |

**Functions:** `revealClientPaymentSecret(ctx, clientId, paymentType, secretKind)` in `client-tax-settings.service.ts`.

- Checks org membership, client in org, encrypted blob present.
- Decrypts **once**, returns **one** field.
- `writeAudit` + `client_tax_settings_event_log` row **without** secret values.

## 5. Frontend (`ClientTaxesTab.tsx`)

- Renders `card_number_masked` (or fallback `**** **** **** {last4}`) and masked CVV line.
- **Copy:** icon-only (two overlapping squares), per field; calls `reveal-payment-secret`, then `clipboard.writeText(value)`; no long-lived full PAN/CVV in React state.
- Text button “העתק פרטי כרטיס מלאים” **removed**.

## 6. Security notes

- **Encryption:** Node `crypto` AES-256-GCM in `field-encryption.ts`; key from env only.
- **Access:** `requirePermission('client_operations.edit')` on reveal; `withView` on GET; `X-Organization-Id` + server checks.
- **Logs:** Audit payload = `{ client_id, payment_type, secret_kind }`. Event log `new_value` = `[access]` placeholder, not PAN/CVV.

## 7. Testing checklist

1. [ ] Save card → DB has ciphertext in `*_encrypted`, not plaintext PAN/CVV.
2. [ ] GET tax-settings / workspace → no `*_encrypted` fields in JSON; no full card.
3. [ ] UI shows masked PAN pattern + bullets for CVV.
4. [ ] CVV never appears from GET alone.
5. [ ] Each icon click → one POST with one `secret_kind`.
6. [ ] Copy card number works via reveal endpoint.
7. [ ] Copy CVV works via reveal endpoint.
8. [ ] Copy expiry works via reveal endpoint.
9. [ ] Each reveal → `audit_log` + `client_tax_settings_event_log` with `reveal_payment_secret`.
10. [ ] PATCH still logs `update_tax_settings` / encrypted blob `***` where applicable.
11. [ ] Logs contain no full PAN/CVV.
12. [ ] Other org’s client → 403/forbidden.
13. [ ] No bulk endpoint returning all secrets (full-card removed).
14. [ ] Frontend does not preload full secrets (only masked).
15. [ ] No duplicate DB fields.
16. [ ] Aggregator route layout unchanged.
