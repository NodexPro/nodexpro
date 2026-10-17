import {
  FEE_BREAKDOWN_CATEGORIES,
  type ClientExpectedFeeResult,
  type FeeBreakdownCategory,
} from './dashboard-office-fees.pure.js';

export const FEE_BREAKDOWN_PAGE_SIZES = [25, 50] as const;
export const FEE_BREAKDOWN_SORTS = ['display_name', 'monthly_before_vat', 'category'] as const;
export type FeeBreakdownSortKey = (typeof FEE_BREAKDOWN_SORTS)[number];

export type FeeBreakdownQuery = {
  q?: string | null;
  page?: number | string | null;
  page_size?: number | string | null;
  sort?: string | null;
  sort_dir?: string | null;
  filter?: string | null;
};

export function parseFeeBreakdownPageSize(raw: unknown): 25 | 50 {
  const n = Number(raw);
  return n === 50 ? 50 : 25;
}

export function parseFeeBreakdownPage(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseFeeBreakdownSort(raw: unknown): FeeBreakdownSortKey {
  const s = String(raw ?? '');
  return (FEE_BREAKDOWN_SORTS as readonly string[]).includes(s) ? (s as FeeBreakdownSortKey) : 'display_name';
}

export function parseFeeBreakdownSortDir(raw: unknown): 'asc' | 'desc' {
  return String(raw ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc';
}

export type FeeBreakdownFilter = FeeBreakdownCategory | 'all' | 'needs_configuration' | 'fee_attention';

export const FEE_ATTENTION_CATEGORIES: readonly FeeBreakdownCategory[] = [
  'no_agreement',
  'configured_zero',
  'no_recurring_service',
  'one_time_only',
  'needs_attention',
  'unsupported_vat_fx',
];

export const FEE_ATTENTION_PREVIEW_CAP = 5;

export function isFeeAttentionCategory(category: FeeBreakdownCategory): boolean {
  return (FEE_ATTENTION_CATEGORIES as readonly string[]).includes(category);
}

export function selectFeeAttentionClients(rows: ClientExpectedFeeResult[]): ClientExpectedFeeResult[] {
  return rows.filter((r) => r.category !== 'not_in_scope' && isFeeAttentionCategory(r.category));
}

export function capFeeAttentionPreview<T>(rows: T[], cap = FEE_ATTENTION_PREVIEW_CAP): {
  preview: T[];
  total: number;
  truncated: boolean;
} {
  return { preview: rows.slice(0, cap), total: rows.length, truncated: rows.length > cap };
}

export function parseFeeBreakdownFilter(raw: unknown): FeeBreakdownFilter {
  const s = String(raw ?? '').trim();
  if (s === 'all' || !s) return 'all';
  if (s === 'needs_configuration' || s === 'fee_attention') return 'fee_attention';
  return (FEE_BREAKDOWN_CATEGORIES as readonly string[]).includes(s) ? (s as FeeBreakdownCategory) : 'all';
}

export function paginateFeeBreakdown(
  rows: ClientExpectedFeeResult[],
  query: FeeBreakdownQuery,
): {
  rows: ClientExpectedFeeResult[];
  page: number;
  page_size: 25 | 50;
  total: number;
  total_pages: number;
  sort: FeeBreakdownSortKey;
  sort_dir: 'asc' | 'desc';
  filter: FeeBreakdownFilter;
  q: string;
} {
  const q = String(query.q ?? '').trim().toLowerCase();
  const filter = parseFeeBreakdownFilter(query.filter);
  const sort = parseFeeBreakdownSort(query.sort);
  const sort_dir = parseFeeBreakdownSortDir(query.sort_dir);
  const page_size = parseFeeBreakdownPageSize(query.page_size);
  const inScope = rows.filter((r) => r.category !== 'not_in_scope');
  const filtered = inScope.filter((r) => {
    if (filter === 'fee_attention' || filter === 'needs_configuration') {
      if (!isFeeAttentionCategory(r.category)) return false;
    } else if (filter !== 'all' && r.category !== filter) return false;
    if (!q) return true;
    return r.display_name.toLowerCase().includes(q);
  });
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sort === 'monthly_before_vat') cmp = a.monthly_before_vat - b.monthly_before_vat;
    else if (sort === 'category') cmp = a.category.localeCompare(b.category);
    else cmp = a.display_name.localeCompare(b.display_name, 'he');
    if (cmp === 0) cmp = a.client_id.localeCompare(b.client_id);
    return sort_dir === 'desc' ? -cmp : cmp;
  });
  const total = filtered.length;
  const total_pages = Math.max(1, Math.ceil(total / page_size));
  const page = Math.min(parseFeeBreakdownPage(query.page), total_pages);
  const start = (page - 1) * page_size;
  return {
    rows: filtered.slice(start, start + page_size),
    page,
    page_size,
    total,
    total_pages,
    sort,
    sort_dir,
    filter,
    q: String(query.q ?? '').trim(),
  };
}
