import { clientEndedInPeriod } from './dashboard-office-churn.pure.js';
import { isoToJerusalemDate } from './dashboard-office-period.pure.js';
import type { DashboardFeeClientInput } from './dashboard-office-fees.pure.js';

export const OFFICE_CLIENT_LIST_KEYS = [
  'active',
  'new_in_period',
  'departed',
  'status:active',
  'status:pending',
  'status:inactive',
  'status:archived',
] as const;

export type OfficeClientListKey = (typeof OFFICE_CLIENT_LIST_KEYS)[number];

export function parseOfficeClientListKey(raw: unknown): OfficeClientListKey | null {
  const s = String(raw ?? '').trim();
  return (OFFICE_CLIENT_LIST_KEYS as readonly string[]).includes(s) ? (s as OfficeClientListKey) : null;
}

export function selectOfficeClientList(
  clients: DashboardFeeClientInput[],
  listKey: OfficeClientListKey,
  periodStart: string,
  periodEnd: string,
): DashboardFeeClientInput[] {
  if (listKey === 'active') {
    return clients.filter((c) => !c.is_archived && String(c.status ?? '') === 'active');
  }
  if (listKey === 'new_in_period') {
    return clients.filter((c) => {
      if (c.is_archived) return false;
      const created = isoToJerusalemDate(c.created_at);
      return created != null && created >= periodStart && created <= periodEnd;
    });
  }
  if (listKey === 'departed') {
    return clients.filter((c) => clientEndedInPeriod(c, periodStart, periodEnd));
  }
  if (listKey === 'status:archived') {
    return clients.filter((c) => c.is_archived);
  }
  const status = listKey.slice('status:'.length);
  return clients.filter((c) => !c.is_archived && String(c.status ?? '') === status);
}

export function paginateNamedRows<T extends { display_name: string; id: string }>(
  rows: T[],
  query: { q?: string | null; page?: string | number | null; page_size?: string | number | null },
): { rows: T[]; page: number; page_size: number; total: number; total_pages: number; q: string } {
  const q = String(query.q ?? '').trim();
  const qLower = q.toLowerCase();
  const filtered = qLower
    ? rows.filter((r) => r.display_name.toLowerCase().includes(qLower))
    : rows;
  const sorted = [...filtered].sort((a, b) => {
    const cmp = a.display_name.localeCompare(b.display_name, 'he');
    return cmp === 0 ? a.id.localeCompare(b.id) : cmp;
  });
  const page_sizeRaw = Math.floor(Number(query.page_size));
  const page_size = page_sizeRaw === 50 ? 50 : 25;
  const total = sorted.length;
  const total_pages = Math.max(1, Math.ceil(total / page_size));
  const pageRaw = Math.floor(Number(query.page));
  const page = Math.min(Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1, total_pages);
  const start = (page - 1) * page_size;
  return {
    rows: sorted.slice(start, start + page_size),
    page,
    page_size,
    total,
    total_pages,
    q,
  };
}
