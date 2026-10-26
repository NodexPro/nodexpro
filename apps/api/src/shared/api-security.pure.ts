export type ApiSecurityClass =
  | 'health'
  | 'auth'
  | 'mfa'
  | 'sensitive_command'
  | 'upload'
  | 'expensive'
  | 'owner_internal'
  | 'standard';

export type ApiSecurityQuota = {
  windowMs: number;
  max: number;
  failClosed: boolean;
  maxBytes: number;
};

export const AUTH_JSON_MAX_BYTES = 8 * 1024;
export const STANDARD_JSON_MAX_BYTES = 256 * 1024;
export const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_JSON_MAX_BYTES = 28 * 1024 * 1024;
export const ENUMERATION_SAFE_LOGIN_MESSAGE = 'Invalid email or password';
export const ENUMERATION_SAFE_REGISTER_MESSAGE = 'Registration could not be completed.';

export function classifyApiRequest(method: string, path: string): ApiSecurityClass {
  const value = String(path ?? '');
  if (value === '/api/v1/health' || value.endsWith('/health')) return 'health';
  if (value.includes('/internal/')) return 'owner_internal';
  if (/\/auth\/(login|register|forgot|reset|recover)/i.test(value) || value.includes('/password-recovery')) {
    return 'auth';
  }
  if (value.includes('/mfa') || /\/commands\/(enroll_mfa|verify_mfa|recover_mfa|trust_mfa|activate_platform_owner_mfa)/.test(value)) {
    return 'mfa';
  }
  if (
    method !== 'GET' &&
    /documents|file_assets|entity-file|attachment|docflow|client-operations|annual-report|vehicle|branding|file_base64|\/upload/.test(value)
  ) {
    return 'upload';
  }
  if (/\/(pdf|render|export|issue)\b/i.test(value)) return 'expensive';
  if (
    method !== 'GET' &&
    /\/commands?(\/|$)/.test(value) &&
    /revoke|change_user_role|invite|release_security|close_member|set_member/.test(value)
  ) {
    return 'sensitive_command';
  }
  return 'standard';
}

export function quotaForSecurityClass(securityClass: ApiSecurityClass): ApiSecurityQuota {
  if (securityClass === 'health') return { windowMs: 60_000, max: 120, failClosed: false, maxBytes: STANDARD_JSON_MAX_BYTES };
  if (securityClass === 'auth') return { windowMs: 10 * 60_000, max: 80, failClosed: true, maxBytes: AUTH_JSON_MAX_BYTES };
  if (securityClass === 'mfa') return { windowMs: 15 * 60_000, max: 20, failClosed: true, maxBytes: AUTH_JSON_MAX_BYTES };
  if (securityClass === 'sensitive_command') {
    return { windowMs: 10 * 60_000, max: 20, failClosed: true, maxBytes: STANDARD_JSON_MAX_BYTES };
  }
  if (securityClass === 'upload') {
    return { windowMs: 10 * 60_000, max: 40, failClosed: true, maxBytes: UPLOAD_JSON_MAX_BYTES };
  }
  if (securityClass === 'expensive') {
    return { windowMs: 5 * 60_000, max: 20, failClosed: true, maxBytes: STANDARD_JSON_MAX_BYTES };
  }
  if (securityClass === 'owner_internal') {
    return { windowMs: 5 * 60_000, max: 60, failClosed: true, maxBytes: STANDARD_JSON_MAX_BYTES };
  }
  return { windowMs: 60_000, max: 240, failClosed: false, maxBytes: STANDARD_JSON_MAX_BYTES };
}

export function requestExceedsClassSize(contentLength: number | null, maxBytes: number): boolean {
  if (contentLength === null || !Number.isFinite(contentLength) || contentLength < 0) return false;
  return contentLength > maxBytes;
}

export function officeSharedNatWouldLock(input: {
  uniqueActorsInWindow: number;
  sourceScope: 'source_ip' | 'user' | 'session';
}): boolean {
  return input.sourceScope === 'source_ip' && input.uniqueActorsInWindow > 1;
}
