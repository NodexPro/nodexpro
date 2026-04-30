import crypto from 'crypto';
import { AppError } from './errors.js';
const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;
/** API JSON `code` when server cannot encrypt/decrypt client payment secrets */
export const ENCRYPTION_NOT_CONFIGURED_CODE = 'ENCRYPTION_NOT_CONFIGURED';
/**
 * User-facing Hebrew only — no env var names, paths, or key lengths.
 * Returned as `message` in HTTP JSON for PATCH/reveal when encryption is unavailable.
 */
export const CLIENT_DATA_ENCRYPTION_NOT_READY_MESSAGE_HE = 'לא ניתן לשמור או להציג פרטי תשלום רגישים: הגדרות האבטחה של השרת אינן מלאות. פנה למנהל המערכת.';
const PAYMENT_SECRET_DECODE_FAILED_CODE = 'PAYMENT_SECRET_UNREADABLE';
const PAYMENT_SECRET_DECODE_FAILED_MESSAGE_HE = 'לא ניתן לקרוא את נתוני התשלום המאוחסנים. פנה למנהל המערכת.';
/**
 * Safe startup logging — never prints the key. Call once from API bootstrap.
 */
export function getClientDataEncryptionEnvDiagnostic() {
    const raw = process.env.CLIENT_DATA_ENCRYPTION_KEY;
    const env_set = Boolean(raw?.trim());
    if (!env_set) {
        return { env_set: false, decoded_length_bytes: null, valid_for_aes256: false };
    }
    try {
        const key = Buffer.from(raw.trim(), 'base64');
        const decoded_length_bytes = key.length;
        return {
            env_set: true,
            decoded_length_bytes,
            valid_for_aes256: decoded_length_bytes === 32,
        };
    }
    catch {
        return { env_set: true, decoded_length_bytes: null, valid_for_aes256: false };
    }
}
/** True when env has a valid AES-256 key (32 raw bytes from base64). Backend-only; never call from frontend bundler for static values. */
export function isClientDataEncryptionReady() {
    const d = getClientDataEncryptionEnvDiagnostic();
    return d.valid_for_aes256;
}
/** Throws AppError 503 with safe Hebrew message if encryption cannot be used (missing/invalid key). */
export function assertClientDataEncryptionConfigured() {
    if (!isClientDataEncryptionReady()) {
        throw new AppError(503, CLIENT_DATA_ENCRYPTION_NOT_READY_MESSAGE_HE, ENCRYPTION_NOT_CONFIGURED_CODE);
    }
}
function getKey() {
    assertClientDataEncryptionConfigured();
    return Buffer.from(process.env.CLIENT_DATA_ENCRYPTION_KEY.trim(), 'base64');
}
/** Encrypt JSON to a single base64 blob (iv + tag + ciphertext). Never stores plaintext. */
export function encryptJson(payload) {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const plaintext = JSON.stringify(payload);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}
export function decryptJson(ciphertextB64) {
    try {
        const key = getKey();
        const buf = Buffer.from(ciphertextB64, 'base64');
        if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) {
            throw new AppError(400, PAYMENT_SECRET_DECODE_FAILED_MESSAGE_HE, PAYMENT_SECRET_DECODE_FAILED_CODE);
        }
        const iv = buf.subarray(0, IV_LEN);
        const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
        const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
        return JSON.parse(dec.toString('utf8'));
    }
    catch (e) {
        if (e instanceof AppError)
            throw e;
        throw new AppError(400, PAYMENT_SECRET_DECODE_FAILED_MESSAGE_HE, PAYMENT_SECRET_DECODE_FAILED_CODE);
    }
}
/** Normalize decrypted JSON; strips legacy cvv without using it. */
export function normalizeCardPaymentPayload(raw) {
    return {
        card_number: String(raw.card_number ?? ''),
        expiry: String(raw.expiry ?? ''),
    };
}
export function cardLast4(cardNumber) {
    const digits = String(cardNumber).replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '';
}
