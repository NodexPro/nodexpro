import { AppError } from '../errors.js';
import { aes256GcmDecryptJson, aes256GcmEncryptJson } from '../field-encryption.js';

const ENV_NAME = 'AI_GATEWAY_ENCRYPTION_KEY';
const BASE64_KEY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** API JSON `code` when AI Gateway credential encryption cannot be used. */
export const AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE = 'AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED' as const;

/**
 * User-facing Hebrew only — no env var names, paths, or key lengths.
 */
export const AI_GATEWAY_ENCRYPTION_NOT_READY_MESSAGE_HE =
  'לא ניתן לשמור או להשתמש במפתח ספק הבינה המלאכותית: הגדרות האבטחה של השרת אינן מלאות. פנה למנהל המערכת.';

const AI_GATEWAY_CREDENTIAL_UNREADABLE_CODE = 'AI_GATEWAY_CREDENTIAL_UNREADABLE' as const;
const AI_GATEWAY_CREDENTIAL_UNREADABLE_MESSAGE_HE =
  'לא ניתן לקרוא את מפתח הספק המאוחסן. פנה למנהל המערכת.';

export type AiGatewayEncryptionEnvDiagnostic = {
  env_set: boolean;
  decoded_length_bytes: number | null;
  valid_for_aes256: boolean;
};

function readDedicatedKeyRaw(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[ENV_NAME];
  return typeof raw === 'string' ? raw : undefined;
}

function decodeDedicatedAes256Key(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length % 4 !== 0 || !BASE64_KEY_RE.test(trimmed)) return null;
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== 32) return null;
  if (key.toString('base64') !== trimmed) return null;
  return key;
}

/** Safe startup/logging diagnostic — never prints the key. */
export function getAiGatewayEncryptionEnvDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
): AiGatewayEncryptionEnvDiagnostic {
  const raw = readDedicatedKeyRaw(env);
  const env_set = Boolean(raw?.trim());
  if (!env_set) {
    return { env_set: false, decoded_length_bytes: null, valid_for_aes256: false };
  }
  const trimmed = raw!.trim();
  if (trimmed.length % 4 !== 0 || !BASE64_KEY_RE.test(trimmed)) {
    return { env_set: true, decoded_length_bytes: null, valid_for_aes256: false };
  }
  const key = Buffer.from(trimmed, 'base64');
  return {
    env_set: true,
    decoded_length_bytes: key.length,
    valid_for_aes256: key.length === 32 && key.toString('base64') === trimmed,
  };
}

export function isAiGatewayEncryptionReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAiGatewayEncryptionEnvDiagnostic(env).valid_for_aes256;
}

export function assertAiGatewayEncryptionConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!isAiGatewayEncryptionReady(env)) {
    throw new AppError(
      503,
      AI_GATEWAY_ENCRYPTION_NOT_READY_MESSAGE_HE,
      AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
    );
  }
}

export function isAiGatewayEncryptionNotConfiguredError(error: unknown): boolean {
  return error instanceof AppError && error.code === AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE;
}

function getDedicatedKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  assertAiGatewayEncryptionConfigured(env);
  const key = decodeDedicatedAes256Key(readDedicatedKeyRaw(env) ?? '');
  if (!key) {
    throw new AppError(
      503,
      AI_GATEWAY_ENCRYPTION_NOT_READY_MESSAGE_HE,
      AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
    );
  }
  return key;
}

/** Encrypt AI Gateway JSON with AI_GATEWAY_ENCRYPTION_KEY only. Never stores plaintext. */
export function encryptAiGatewayJson(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return aes256GcmEncryptJson(getDedicatedKey(env), payload);
}

export function decryptAiGatewayJson<T extends Record<string, unknown>>(
  ciphertextB64: string,
  env: NodeJS.ProcessEnv = process.env,
): T {
  try {
    return aes256GcmDecryptJson<T>(getDedicatedKey(env), ciphertextB64);
  } catch (error) {
    if (isAiGatewayEncryptionNotConfiguredError(error)) throw error;
    throw new AppError(
      400,
      AI_GATEWAY_CREDENTIAL_UNREADABLE_MESSAGE_HE,
      AI_GATEWAY_CREDENTIAL_UNREADABLE_CODE,
    );
  }
}

export function logAiGatewayEncryptionBootDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
  write: (message: string) => void = (message) => {
    console.log(message);
  },
): void {
  const diagnostic = getAiGatewayEncryptionEnvDiagnostic(env);
  const len = diagnostic.decoded_length_bytes === null ? 'n/a' : String(diagnostic.decoded_length_bytes);
  write(
    `[api] AI_GATEWAY_ENCRYPTION_KEY: env_set=${diagnostic.env_set ? 'yes' : 'no'}, decoded_bytes=${len}, aes256_ok=${diagnostic.valid_for_aes256 ? 'yes' : 'no'}`,
  );
}
