/**
 * Browser API base URL. Presentation/transport only.
 * Production traffic must reach Render via same-origin `/api/v1`
 * (Vercel rewrite → https://nodexpro.onrender.com/api/v1).
 * Localhost is valid only for development builds.
 */

export const PRODUCTION_RENDER_API_ORIGIN = 'https://nodexpro.onrender.com/api/v1';
export const PRODUCTION_PUBLIC_API_BASE = '/api/v1';

export function isLocalhostApiBaseUrl(raw: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw.trim());
}

export function resolvePublicApiBaseUrl(raw: string | undefined, isProd: boolean): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (isProd && (!value || isLocalhostApiBaseUrl(value))) {
    return PRODUCTION_PUBLIC_API_BASE;
  }
  return value;
}
