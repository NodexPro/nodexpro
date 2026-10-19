import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiJson } from '../../api/client';
import { dashboardOfficeFeeBreakdown } from '../../api/endpoints';
import { useI18n } from '../../i18n/I18nProvider';

export type OfficeFeeBreakdownAggregate = {
  title_he: string;
  period: { key: string; label_he: string };
  office_total: {
    status: string;
    completeness: string;
    completeness_he: string;
    value_he: string;
    before_discount_he: string | null;
    discount_he: string | null;
    note_he: string | null;
  };
  columns: Array<{ key: string; label_he: string }>;
  filters: Array<{ key: string; label_he: string }>;
  search_placeholder_he: string;
  empty_he: string;
  page_label_he: string;
  rows: Array<{
    client_id: string;
    display_name: string;
    href: string;
    agreement_status_he: string;
    billing_frequency_he: string;
    recurring_before_discount_he: string;
    discount_he: string;
    monthly_before_vat_he: string;
    calculation_status_he: string;
    category: string;
    expandable: boolean;
    lines: Array<{ charging_type_he: string; monthly_before_vat_he: string }>;
  }>;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    sort: string;
    sort_dir: 'asc' | 'desc';
    filter: string;
    q: string;
  };
};

const SORT_BY_COLUMN: Record<string, string> = {
  client: 'display_name',
  monthly: 'monthly_before_vat',
  status: 'category',
};

function cellFor(
  columnKey: string,
  row: OfficeFeeBreakdownAggregate['rows'][number],
  expanded: string | null,
  setExpanded: (id: string | null) => void,
  onOpenClient: (href: string) => void,
) {
  if (columnKey === 'client') {
    return (
      <>
        <button type="button" className="nx-dashboard-breakdown__link" onClick={() => onOpenClient(row.href)}>
          {row.display_name}
        </button>
        {row.expandable ? (
          <button
            type="button"
            className="nx-dashboard-breakdown__expand"
            onClick={() => setExpanded(expanded === row.client_id ? null : row.client_id)}
          >
            +
          </button>
        ) : null}
      </>
    );
  }
  if (columnKey === 'frequency') return row.billing_frequency_he;
  if (columnKey === 'before_discount') return row.recurring_before_discount_he;
  if (columnKey === 'discount') return row.discount_he;
  if (columnKey === 'monthly') return row.monthly_before_vat_he;
  if (columnKey === 'status') return row.calculation_status_he;
  return null;
}

export function DashboardFeeBreakdownModal(props: {
  open: boolean;
  period: string;
  locale: string;
  initialFilter?: string;
  onClose: () => void;
  onOpenClient: (href: string) => void;
}) {
  const { open, period, locale, initialFilter, onClose, onOpenClient } = props;
  const { t } = useI18n();
  const dir = locale === 'he' || locale.startsWith('he-') ? 'rtl' : 'ltr';
  const [data, setData] = useState<OfficeFeeBreakdownAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(initialFilter ?? 'all');
  const [sort, setSort] = useState('display_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQDebounced(q), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      period,
      locale,
      page: String(page),
      page_size: '25',
      filter,
      sort,
      sort_dir: sortDir,
    });
    if (qDebounced.trim()) params.set('q', qDebounced.trim());
    apiJson<OfficeFeeBreakdownAggregate>(`${dashboardOfficeFeeBreakdown()}?${params.toString()}`, { signal: ac.signal })
      .then((d) => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!ac.signal.aborted && (e as Error)?.name !== 'AbortError') {
          setError(e instanceof Error ? e.message : t('dashboard.breakdownLoadFailed'));
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, period, locale, page, filter, qDebounced, sort, sortDir, t]);

  if (!open) return null;
  const pg = data?.pagination;
  const columns = data?.columns ?? [];

  const toggleSort = (columnKey: string) => {
    const next = SORT_BY_COLUMN[columnKey];
    if (!next) return;
    if (sort === next) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(next);
      setSortDir('asc');
    }
    setPage(1);
  };

  return createPortal(
    <div className="nx-dashboard-breakdown-overlay" role="presentation" dir={dir} lang={locale} onClick={onClose}>
      <div
        className="nx-dashboard-breakdown"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-dashboard-breakdown-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-dashboard-breakdown__header">
          <div>
            <h2 id="nx-dashboard-breakdown-title" className="nx-dashboard-card__title">
              {data?.title_he ?? ''}
            </h2>
            <div className="nx-dashboard-card__hint">
              {data?.office_total.value_he}
              {data?.office_total.before_discount_he
                ? ` · ${data.office_total.before_discount_he}`
                : ''}
              {data?.office_total.discount_he ? ` · ${data.office_total.discount_he}` : ''}
            </div>
            {data?.office_total.completeness_he ? (
              <div className="nx-dashboard-card__note">{data.office_total.completeness_he}</div>
            ) : null}
            {data?.office_total.note_he ? (
              <div className="nx-dashboard-card__note">{data.office_total.note_he}</div>
            ) : null}
          </div>
          <button type="button" className="nx-dashboard-btn nx-dashboard-btn--purple" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="nx-dashboard-breakdown__toolbar">
          <input
            className="nx-dashboard-breakdown__search"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder={data?.search_placeholder_he ?? ''}
          />
          <div className="nx-dashboard-period">
            {(data?.filters ?? []).map((f) => (
              <button
                key={f.key}
                type="button"
                className={`nx-dashboard-period__chip nx-dashboard-chip--purple${filter === f.key ? ' is-selected' : ''}`}
                onClick={() => {
                  setPage(1);
                  setFilter(f.key);
                }}
              >
                {f.label_he}
              </button>
            ))}
          </div>
        </div>
        <div className="nx-dashboard-breakdown__body">
          {loading ? <div className="nx-dashboard-empty__subtitle">{t('common.loading')}</div> : null}
          {error ? <div className="nx-dashboard__status--error">{error}</div> : null}
          {!loading && data && data.rows.length === 0 ? (
            <div className="nx-dashboard-empty__subtitle">{data.empty_he}</div>
          ) : null}
          {!loading && data && data.rows.length > 0 ? (
            <div className="nx-dashboard-breakdown__table-wrap">
              <table className="nx-dashboard-breakdown__table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={SORT_BY_COLUMN[c.key] ? 'is-sortable' : undefined}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label_he}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <Fragment key={row.client_id}>
                      <tr>
                        {columns.map((c) => (
                          <td key={c.key}>
                            {cellFor(c.key, row, expanded, setExpanded, onOpenClient)}
                          </td>
                        ))}
                      </tr>
                      {expanded === row.client_id
                        ? row.lines.map((line, i) => (
                            <tr key={`${row.client_id}-${i}`} className="nx-dashboard-breakdown__sub">
                              <td colSpan={Math.max(1, columns.length - 1)}>{line.charging_type_he}</td>
                              <td>{line.monthly_before_vat_he}</td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        {pg ? (
          <div className="nx-dashboard-breakdown__footer">
            <span className="nx-dashboard-card__note">{data?.page_label_he}</span>
            <div className="nx-dashboard-actions">
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--purple"
                disabled={pg.page <= 1}
                onClick={() => setPage(pg.page - 1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--purple"
                disabled={pg.page >= pg.total_pages}
                onClick={() => setPage(pg.page + 1)}
              >
                ›
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
