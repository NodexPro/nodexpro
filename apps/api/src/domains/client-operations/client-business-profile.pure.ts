/**
 * Accounting Settings business-profile projection helpers.
 * Canonical open/close dates live on the Client Details aggregate
 * (`clients.created_at` / `clients.ended_at`) — this module only projects
 * them for display. It does not persist a second source of truth.
 */

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFICE_TIME_ZONE = 'Asia/Jerusalem';

export function toCanonicalIsoDateOnly(iso: string | null | undefined): string | null {
  if (iso == null) return null;
  const s = String(iso).trim();
  if (!s) return null;
  if (ISO_DATE_ONLY.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: OFFICE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function projectBusinessProfileCanonicalDates(input: {
  clientCreatedAt: string | null | undefined;
  clientEndedAt: string | null | undefined;
}): { business_open_date: string | null; business_close_date: string | null } {
  return {
    business_open_date: toCanonicalIsoDateOnly(input.clientCreatedAt),
    business_close_date: toCanonicalIsoDateOnly(input.clientEndedAt),
  };
}
