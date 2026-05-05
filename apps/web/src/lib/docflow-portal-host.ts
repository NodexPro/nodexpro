/**
 * DocFlow client portal: force browser onto the same host as platform Public App URL
 * (e.g. https://www.nodexpro.com) so invite links, localStorage, and cookies stay aligned.
 * @returns true if a redirect was started (caller must not continue same-tick work e.g. accept).
 */
export function redirectDocflowPortalToCanonicalHost(): boolean {
  const raw = (import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim();
  if (!raw || typeof window === 'undefined') return false;
  let canonical: URL;
  try {
    canonical = new URL(raw);
  } catch {
    return false;
  }
  if (canonical.protocol !== 'http:' && canonical.protocol !== 'https:') return false;
  const cur = window.location;
  if (canonical.hostname === cur.hostname) return false;
  const target = `${canonical.origin}${cur.pathname}${cur.search}${cur.hash}`;
  window.location.replace(target);
  return true;
}
