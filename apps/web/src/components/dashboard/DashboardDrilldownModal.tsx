import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiJson } from '../../api/client';
import { withAccountDeepOceanClass } from '../glass/account-deep-ocean';
import { useI18n } from '../../i18n/I18nProvider';

export type OfficeDashboardListAggregate = {
  title_he: string;
  total_he: string;
  search_placeholder_he: string;
  empty_he: string;
  page_label_he: string;
  open_label_he: string;
  columns: Array<{ key: string; label_he: string }>;
  rows: Array<{
    id: string;
    href: string | null;
    open_label_he: string;
    cells: Record<string, string>;
  }>;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    q: string;
    list_key: string;
  };
};

export function DashboardDrilldownModal(props: {
  open: boolean;
  url: string | null;
  locale: string;
  onClose: () => void;
  onOpenHref: (href: string) => void;
}) {
  const { open, url, locale, onClose, onOpenHref } = props;
  const { t } = useI18n();
  const dir = locale === 'he' || locale.startsWith('he-') ? 'rtl' : 'ltr';
  const [data, setData] = useState<OfficeDashboardListAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);

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
    if (!open) {
      setQ('');
      setQDebounced('');
      setPage(1);
      setData(null);
      return;
    }
    if (!url) return;
    const ac = new AbortController();
    setLoading(true);
    setError('');
    const next = new URL(url, window.location.origin);
    next.searchParams.set('page', String(page));
    next.searchParams.set('page_size', '25');
    next.searchParams.set('locale', locale);
    if (qDebounced.trim()) next.searchParams.set('q', qDebounced.trim());
    else next.searchParams.delete('q');
    apiJson<OfficeDashboardListAggregate>(`${next.pathname}${next.search}`, { signal: ac.signal })
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
  }, [open, url, locale, page, qDebounced, t]);

  if (!open) return null;
  const pg = data?.pagination;
  const columns = data?.columns ?? [];

  return createPortal(
    <div
      className={withAccountDeepOceanClass('nx-dashboard-breakdown-overlay')}
      role="presentation"
      dir={dir}
      lang={locale}
      onClick={onClose}
    >
      <div
        className="nx-dashboard-breakdown"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-dashboard-drilldown-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-dashboard-breakdown__header">
          <div>
            <h2 id="nx-dashboard-drilldown-title" className="nx-dashboard-card__title">
              {data?.title_he ?? ''}
            </h2>
            <div className="nx-dashboard-card__hint">{data?.total_he}</div>
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
            aria-label={data?.search_placeholder_he ?? ''}
          />
        </div>
        <div className="nx-dashboard-breakdown__body">
          {loading ? <div className="nx-dashboard-empty__subtitle">{t('common.loading')}</div> : null}
          {error ? <div className="nx-dashboard__status--error" role="alert">{error}</div> : null}
          {!loading && data && data.rows.length === 0 ? (
            <div className="nx-dashboard-empty__subtitle">{data.empty_he}</div>
          ) : null}
          {!loading && data && data.rows.length > 0 ? (
            <div className="nx-dashboard-breakdown__table-wrap">
              <table className="nx-dashboard-breakdown__table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key}>{c.label_he}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      {columns.map((c) => (
                        <td key={c.key}>{row.cells[c.key] ?? '—'}</td>
                      ))}
                      <td>
                        {row.href ? (
                          <button
                            type="button"
                            className="nx-dashboard-breakdown__link"
                            onClick={() => onOpenHref(row.href!)}
                          >
                            {row.open_label_he}
                          </button>
                        ) : null}
                      </td>
                    </tr>
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
