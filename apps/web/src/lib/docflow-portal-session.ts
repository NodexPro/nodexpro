/** Shared with API contract: header `X-Client-Portal-Session` */
export const DOCFLOW_PORTAL_SESSION_KEY = 'docflow_portal_session';

/** Align with server `client_portal_sessions.expires_at` (7 days). */
const PORTAL_SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function registrableCookieDomain(hostname: string): string | null {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) return null;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return `.${parts.slice(-2).join('.')}`;
}

function readCookieRaw(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const segments = document.cookie.split(';');
  for (const seg of segments) {
    const s = seg.trim();
    if (s.startsWith(prefix)) {
      try {
        return decodeURIComponent(s.slice(prefix.length));
      } catch {
        return s.slice(prefix.length);
      }
    }
  }
  return null;
}

/**
 * Persists portal session on the registrable parent domain (e.g. `.nodexpro.com`) so
 * `www` and apex share the same cookie; localStorage is still written for fast reads.
 */
export function setDocflowPortalSessionToken(token: string): void {
  try {
    localStorage.setItem(DOCFLOW_PORTAL_SESSION_KEY, token);
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof document === 'undefined') return;
  const host = window.location.hostname;
  const domain = registrableCookieDomain(host);
  const secure = window.location.protocol === 'https:';
  const base = `${DOCFLOW_PORTAL_SESSION_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${PORTAL_SESSION_MAX_AGE_SEC}; SameSite=Lax${secure ? '; Secure' : ''}`;
  document.cookie = domain ? `${base}; Domain=${domain}` : base;
}

export function getDocflowPortalSessionToken(): string | null {
  try {
    const fromLs = localStorage.getItem(DOCFLOW_PORTAL_SESSION_KEY);
    if (fromLs && fromLs.trim()) return fromLs;
  } catch {
    /* continue to cookie */
  }
  const fromCookie = readCookieRaw(DOCFLOW_PORTAL_SESSION_KEY);
  if (fromCookie && fromCookie.trim()) {
    try {
      localStorage.setItem(DOCFLOW_PORTAL_SESSION_KEY, fromCookie);
    } catch {
      /* ignore */
    }
    return fromCookie;
  }
  return null;
}
