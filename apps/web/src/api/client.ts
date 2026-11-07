import { resolvePublicApiBaseUrl } from '../lib/resolve-public-api-base-url.pure';
import { getActiveUiLang, overlayValueAllowedForLocale } from '../lib/i18n-script.pure';
import {
  lookupNestedMessage,
  resolveUserFacingApiMessage,
} from '../lib/user-facing-api-message.pure';
import { peekPublishedTranslationOverlay } from '../i18n/I18nProvider';
import en from '../i18n/en.json';
import he from '../i18n/he.json';
import { getBackendActiveOrganizationId } from './org-context';

const API_URL = resolvePublicApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);

/** API error JSON `{ code, message, ...details }` — use `code` for secure-session / encryption flows */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  /** Extra fields from error JSON (e.g. `field_errors` for validation). */
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const bundledUiMessages: Record<string, unknown> = { en, he };

function lookupUserFacingApiMessage(locale: string, key: string): string | undefined {
  const overlay = peekPublishedTranslationOverlay(locale)[key];
  if (overlay && overlayValueAllowedForLocale(overlay, locale)) return overlay;
  return lookupNestedMessage(bundledUiMessages[locale] ?? bundledUiMessages.en, key);
}

/** Localized user-facing API copy. Does not change API error codes. */
export function userFacingApiMessage(e: unknown, locale = getActiveUiLang()): string {
  return resolveUserFacingApiMessage(e, locale, lookupUserFacingApiMessage);
}

async function getToken(): Promise<string | null> {
  try {
    const { supabase } = await import('../lib/supabase');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const orgId = getBackendActiveOrganizationId();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Platform-owner endpoints must never run in tenant organization context.
  // DocFlow client portal is scoped by portal session only — never send office org context.
  if (orgId && !path.startsWith('/owner/') && !path.startsWith('/docflow/portal')) {
    headers['X-Organization-Id'] = orgId;
  }
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

/** DocFlow client portal: no Core Bearer token, no org header; optional `X-Client-Portal-Session`. */
export async function apiDocflowPortalFetch(path: string, options: RequestInit = {}, portalSessionToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (portalSessionToken) headers['X-Client-Portal-Session'] = portalSessionToken;
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

export async function apiDocflowPortalJson<T>(
  path: string,
  options: RequestInit = {},
  portalSessionToken: string | null
): Promise<T> {
  let res: Response;
  try {
    res = await apiDocflowPortalFetch(path, options, portalSessionToken);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw e;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body.message === 'string' ? body.message : undefined;
    const { code: _c, message: _m, ...rest } = body;
    void _c;
    void _m;
    const details = Object.keys(rest).length ? rest : undefined;
    throw new ApiError(message || res.statusText, code, res.status, details);
  }
  return res.json();
}

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, options);
  } catch (e) {
    // AbortController cleanup (e.g. React StrictMode double mount)
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw e;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body.message === 'string' ? body.message : undefined;
    const { code: _c, message: _m, ...rest } = body;
    void _c;
    void _m;
    const details = Object.keys(rest).length ? rest : undefined;
    const encryptionFallbackHe =
      'לא ניתן לשמור או להציג פרטי תשלום רגישים: הגדרות האבטחה של השרת אינן מלאות. פנה למנהל המערכת.';
    throw new ApiError(
      message ||
        (code === 'ENCRYPTION_NOT_CONFIGURED' ? encryptionFallbackHe : undefined) ||
        res.statusText,
      code,
      res.status,
      details
    );
  }
  return res.json();
}

/** Public POST JSON — no Authorization / org headers (platform-owner SMS recovery, etc.). */
export async function apiJsonPublic<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw e;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body.message === 'string' ? body.message : undefined;
    const { code: _c, message: _m, ...rest } = body;
    void _c;
    void _m;
    const details = Object.keys(rest).length ? rest : undefined;
    throw new ApiError(message || res.statusText, code, res.status, details);
  }
  return res.json();
}

/** POST that returns a file (e.g. history export). Parses JSON errors like `apiJson`. */
export async function apiPostDownload(path: string, body: unknown, defaultFilename: string): Promise<void> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ec = typeof errBody.code === 'string' ? errBody.code : undefined;
    const em = typeof errBody.message === 'string' ? errBody.message : undefined;
    const { code: _c2, message: _m2, ...rest2 } = errBody;
    void _c2;
    void _m2;
    const det = Object.keys(rest2).length ? rest2 : undefined;
    throw new ApiError(em || res.statusText, ec, res.status, det);
  }
  const cd = res.headers.get('Content-Disposition');
  let filename = defaultFilename;
  const q = cd?.match(/filename="([^"]+)"/);
  const star = cd?.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (q?.[1]) filename = q[1];
  else if (star?.[1]) {
    try {
      filename = decodeURIComponent(star[1]);
    } catch {
      filename = star[1];
    }
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || defaultFilename;
  a.rel = 'noopener';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
