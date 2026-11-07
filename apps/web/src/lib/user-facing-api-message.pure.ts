import { overlayValueAllowedForLocale, textHasHebrew } from './i18n-script.pure';

export const USER_FACING_API_MESSAGE_KEYS = {
  workItemVersionConflict: 'common.errors.workItemVersionConflict',
  versionConflict: 'common.errors.versionConflict',
  invitationExpired: 'common.errors.invitationExpired',
  invitationRevoked: 'common.errors.invitationRevoked',
  invalidInvitationToken: 'common.errors.invalidInvitationToken',
  invitationNotAcceptable: 'common.errors.invitationNotAcceptable',
  portalAccessRevoked: 'common.errors.portalAccessRevoked',
  portalActivationFailed: 'common.errors.portalActivationFailed',
  forbidden: 'common.errors.forbidden',
  portalSessionExpired: 'common.errors.portalSessionExpired',
  portalSessionInvalid: 'common.errors.portalSessionInvalid',
  unauthorized: 'common.errors.unauthorized',
  notImplemented: 'common.errors.notImplemented',
  serverError: 'common.errors.serverError',
  conflict: 'common.errors.conflict',
  failed: 'common.errors.failed',
  aborted: 'common.errors.aborted',
  network: 'common.errors.network',
  generic: 'common.errors.generic',
} as const;

type ApiErrorLike = {
  code?: string;
  status?: number;
  message?: string;
};

export function lookupNestedMessage(dict: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let value: unknown = dict;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

function asApiError(e: unknown): ApiErrorLike | null {
  if (!e || typeof e !== 'object') return null;
  const rec = e as Record<string, unknown>;
  const status = typeof rec.status === 'number' ? rec.status : undefined;
  const code = typeof rec.code === 'string' ? rec.code : undefined;
  const message = typeof rec.message === 'string' ? rec.message : undefined;
  if (status == null && !code) return null;
  return { code, status, message };
}

function safeServerMessage(message: string | undefined, locale: string): string | null {
  const m = (message ?? '').trim();
  if (!m) return null;
  if (overlayValueAllowedForLocale(m, locale)) return m;
  if (m.length < 160 && !textHasHebrew(m) && !/duplicate|violates|null value|column|relation|syntax|supabase|postgres/i.test(m)) {
    return m;
  }
  return null;
}

export function userFacingApiMessageKey(e: unknown): string {
  const api = asApiError(e);
  if (api) {
    const c = api.code ?? '';
    const status = api.status ?? 0;
    if (c === 'WORK_ITEM_VERSION_CONFLICT' || c === 'version_conflict_on_update') {
      return USER_FACING_API_MESSAGE_KEYS.workItemVersionConflict;
    }
    if (c === 'VERSION_CONFLICT' || c === 'CONFLICT') {
      return USER_FACING_API_MESSAGE_KEYS.versionConflict;
    }
    if (c === 'INVITATION_EXPIRED') return USER_FACING_API_MESSAGE_KEYS.invitationExpired;
    if (c === 'INVITATION_REVOKED') return USER_FACING_API_MESSAGE_KEYS.invitationRevoked;
    if (c === 'INVALID_INVITATION_TOKEN') return USER_FACING_API_MESSAGE_KEYS.invalidInvitationToken;
    if (c === 'INVITATION_NOT_ACCEPTABLE') return USER_FACING_API_MESSAGE_KEYS.invitationNotAcceptable;
    if (c === 'PORTAL_ACCESS_REVOKED') return USER_FACING_API_MESSAGE_KEYS.portalAccessRevoked;
    if (c === 'PORTAL_USER_MISSING' || c === 'PORTAL_ACTIVATION_FAILED') {
      return USER_FACING_API_MESSAGE_KEYS.portalActivationFailed;
    }
    if (c === 'FORBIDDEN' || status === 403) return USER_FACING_API_MESSAGE_KEYS.forbidden;
    if (c === 'PORTAL_SESSION_EXPIRED') return USER_FACING_API_MESSAGE_KEYS.portalSessionExpired;
    if (c === 'PORTAL_SESSION_REVOKED' || c === 'PORTAL_SESSION_INVALID') {
      return USER_FACING_API_MESSAGE_KEYS.portalSessionInvalid;
    }
    if (c === 'UNAUTHORIZED' || status === 401) return USER_FACING_API_MESSAGE_KEYS.unauthorized;
    if (c === 'NOT_IMPLEMENTED' || status === 501) return USER_FACING_API_MESSAGE_KEYS.notImplemented;
    if (c === 'SUPABASE_ERROR' || (status >= 500 && status !== 501)) {
      return USER_FACING_API_MESSAGE_KEYS.serverError;
    }
    if (status === 409) return USER_FACING_API_MESSAGE_KEYS.conflict;
    return USER_FACING_API_MESSAGE_KEYS.failed;
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError') return USER_FACING_API_MESSAGE_KEYS.aborted;
    if (/failed to fetch|network|load failed/i.test(e.message || '')) {
      return USER_FACING_API_MESSAGE_KEYS.network;
    }
    return USER_FACING_API_MESSAGE_KEYS.generic;
  }
  return USER_FACING_API_MESSAGE_KEYS.generic;
}

export function resolveUserFacingApiMessage(
  e: unknown,
  locale: string,
  lookup: (locale: string, key: string) => string | undefined,
): string {
  const api = asApiError(e);
  const key = userFacingApiMessageKey(e);
  const localized = lookup(locale, key) ?? lookup('en', key);

  if (api) {
    const c = api.code ?? '';
    const status = api.status ?? 0;
    const preferServer =
      c === 'NOT_IMPLEMENTED' ||
      status === 501 ||
      (status >= 500 && status !== 501) ||
      key === USER_FACING_API_MESSAGE_KEYS.failed;
    if (preferServer) {
      const server = safeServerMessage(api.message, locale);
      if (server) return server;
    }
    return localized ?? key;
  }

  if (e instanceof Error) {
    if (e.name === 'AbortError') return localized ?? key;
    if (/failed to fetch|network|load failed/i.test(e.message || '')) return localized ?? key;
    return e.message || localized || key;
  }
  return localized ?? key;
}
