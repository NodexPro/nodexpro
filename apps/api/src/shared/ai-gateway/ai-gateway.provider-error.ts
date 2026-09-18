/**
 * Safe OpenAI-compatible error-code extraction.
 * Reads only error.code / error.type / error.param. Never returns message, body, or headers.
 */

import { looksLikeSecret } from './ai-gateway.redaction.js';

const SAFE_TOKEN_RE = /^[a-z][a-z0-9_.-]{0,63}$/;

const AUTH_PROVIDER_CODES = new Set([
  'invalid_api_key',
  'invalid_authentication',
  'authentication_error',
  'token_expired',
  'permission_denied',
]);

const MODEL_PROVIDER_CODES = new Set([
  'model_not_found',
  'invalid_model',
  'model_not_available',
  'model_not_supported',
]);

export type SafeProviderErrorHint = {
  code: string | null;
  param: string | null;
};

function asSafeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!SAFE_TOKEN_RE.test(normalized)) return null;
  if (normalized.startsWith('sk-') || looksLikeSecret(normalized)) return null;
  return normalized;
}

function readErrorObject(bodyText: string): Record<string, unknown> | null {
  if (typeof bodyText !== 'string' || !bodyText.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const error = (parsed as { error?: unknown }).error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
    return error as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Normalized provider error.code or error.type. Null if missing or unsafe. */
export function extractSafeProviderErrorCode(bodyText: string): string | null {
  const error = readErrorObject(bodyText);
  if (!error) return null;
  return asSafeToken(error.code) ?? asSafeToken(error.type);
}

/** Normalized error.param when it is a short identifier such as `model`. */
export function extractSafeProviderErrorParam(bodyText: string): string | null {
  const error = readErrorObject(bodyText);
  if (!error) return null;
  return asSafeToken(error.param);
}

export function extractSafeProviderErrorHint(bodyText: string): SafeProviderErrorHint {
  return {
    code: extractSafeProviderErrorCode(bodyText),
    param: extractSafeProviderErrorParam(bodyText),
  };
}

export function isAuthProviderErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && AUTH_PROVIDER_CODES.has(code));
}

export function isModelProviderErrorCode(code: string | null | undefined, param: string | null | undefined): boolean {
  if (code && MODEL_PROVIDER_CODES.has(code)) return true;
  return param === 'model';
}
