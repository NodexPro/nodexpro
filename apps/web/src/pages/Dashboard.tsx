import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n/I18nProvider';
import { apiJson } from '../api/client';
import { dashboardOverview } from '../api/endpoints';
import { DashboardFeeBreakdownModal } from '../components/dashboard/DashboardFeeBreakdownModal';
import '../styles/nx-dashboard.css';

type DashboardStatus = 'ready' | 'empty' | 'coming_soon' | 'unavailable';

type OfficeKpi = {
  key: string;
  title_he: string;
  value_he: string;
  secondary_he: string;
  href: string | null;
  action_key?: 'open_fee_breakdown' | 'navigate' | null;
  status: DashboardStatus;
  note_he: string | null;
};

type OfficeSection = {
  title_he: string;
  subtitle_he: string;
  period: {
    key: string;
    label_he: string;
    start_date: string;
    end_date: string;
    options: Array<{ key: string; label_he: string; selected: boolean }>;
  };
  kpis: {
    active_clients: OfficeKpi;
    expected_fees: OfficeKpi;
    office_debtors: OfficeKpi;
    new_clients: OfficeKpi;
    clients_left: OfficeKpi;
  };
  missing_fees: {
    title_he: string;
    status: DashboardStatus;
    count: number;
    count_label_he?: string;
    truncated?: boolean;
    truncated_he?: string | null;
    empty_he: string;
    view_all_label_he?: string;
    view_all_action?: 'open_fee_breakdown' | 'navigate' | null;
    view_all_filter?: 'fee_attention' | null;
    clients: Array<{ client_id: string; display_name: string; indicator_he: string; href: string }>;
  };
  attention: {
    title_he: string;
    items: Array<{
      key: string;
      title_he: string;
      count: number | null;
      href: string | null;
      status: DashboardStatus;
      unavailable_he: string | null;
    }>;
  };
  deadlines: {
    title_he: string;
    status: DashboardStatus;
    unavailable_he: string;
    rows: Array<{
      type_he: string;
      due_date_he: string;
      clients_count: number | null;
      href: string | null;
      severity_he: string | null;
    }>;
  };
  charts: {
    expected_fees_by_month: {
      title_he: string;
      status: DashboardStatus;
      historical_basis_he: string;
      currency: string;
      occupy_primary?: boolean;
      points: Array<{ month: string; label_he: string; value: number | null; established: boolean }>;
    };
    client_growth: {
      title_he: string;
      hint_he?: string;
      status: DashboardStatus;
      points: Array<{ month: string; label_he: string; value: number | null; established: boolean }>;
      departed_points?: Array<{ month: string; label_he: string; value: number | null; established: boolean }>;
    };
  };
  client_status: {
    title_he: string;
    segments: Array<{ key: string; label_he: string; count: number; color: string }>;
  };
  recent_activity: {
    title_he: string;
    status: DashboardStatus;
    unavailable_he: string;
  };
  quick_actions: {
    title_he: string;
    collected_cash_note_he?: string;
    actions: Array<{ key: string; label_he: string; href: string; enabled: boolean }>;
  };
};

type DashboardOverviewData = {
  summary: {
    monthly_revenue_status: DashboardStatus;
    monthly_revenue: { amount: number; currency: string } | null;
  };
  office?: OfficeSection;
};

function LineChart({
  points,
  secondary,
  compact,
}: {
  points: Array<{ xLabel: string; count: number }>;
  secondary?: Array<{ xLabel: string; count: number }>;
  compact?: boolean;
}) {
  const w = 600;
  const h = compact ? 168 : 220;
  const paddingLeft = 44;
  const paddingRight = 16;
  const paddingTop = 10;
  const paddingBottom = compact ? 32 : 40;
  const plotW = w - paddingLeft - paddingRight;
  const plotH = h - paddingTop - paddingBottom;

  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.count), ...(secondary ?? []).map((p) => p.count));
  const min = 0;
  const range = Math.max(1, max - min);

  const xAt = (i: number) => (n === 1 ? paddingLeft + plotW / 2 : paddingLeft + (i * plotW) / (n - 1));
  const yAt = (count: number) => paddingTop + ((max - count) / range) * plotH;

  const coords = points.map((p, i) => ({ ...p, x: xAt(i), y: yAt(p.count) }));

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const baselineY = paddingTop + plotH;

  const areaPath = coords.length
    ? `M ${coords[0].x} ${coords[0].y} ${coords
        .slice(1)
        .map((c) => `L ${c.x} ${c.y}`)
        .join(' ')} L ${coords[coords.length - 1].x} ${baselineY} L ${coords[0].x} ${baselineY} Z`
    : '';

  const gridLines = [0.25, 0.5, 0.75, 1].map((t) => ({
    y: paddingTop + plotH * t,
  }));

  const labelEvery = coords.length > 8 ? Math.ceil(coords.length / 6) : 1;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img">
      {gridLines.map((g, idx) => (
        <line key={idx} x1={paddingLeft} x2={w - paddingRight} y1={g.y} y2={g.y} stroke="rgba(210, 238, 255, 0.16)" strokeWidth={1} />
      ))}
      {coords.length > 1 && <path d={areaPath} fill="rgba(0, 207, 239, 0.16)" stroke="none" />}
      {coords.length > 0 && (
        <polyline points={polyline} fill="none" stroke="#39e6f4" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {secondary && secondary.length > 1 ? (
        <polyline
          points={secondary
            .map((p, i) => `${n === 1 ? paddingLeft + plotW / 2 : paddingLeft + (i * plotW) / Math.max(1, n - 1)},${yAt(p.count)}`)
            .join(' ')}
          fill="none"
          stroke="#268cff"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {coords.map((c, i) => (
        <circle key={`${c.xLabel}-${i}`} cx={c.x} cy={c.y} r={4} fill="#39e6f4" stroke="#04152f" strokeWidth={2} />
      ))}
      {coords.map((c, i) =>
        i % labelEvery === 0 || i === coords.length - 1 ? (
          <text key={c.xLabel + i} x={c.x} y={h - 16} textAnchor="middle" fontSize={compact ? 11 : 12} fill="rgba(238, 246, 255, 0.72)" fontFamily="Arial, sans-serif">
            {c.xLabel}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function DonutChart({
  total,
  segments,
}: {
  total: number;
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const size = 132;
  const cx = size / 2;
  const cy = size / 2;
  const r = 66;
  const strokeWidth = 14;
  const sum = segments.reduce((acc, s) => acc + s.value, 0);
  const safeTotal = sum > 0 ? sum : total;
  let accAngle = -90;

  const arcs = segments.map((s) => {
    const frac = safeTotal > 0 ? s.value / safeTotal : 0;
    const angle = frac * 360;
    const start = accAngle;
    const end = accAngle + angle;
    accAngle = end;
    const polar = (ang: number) => {
      const a = (ang * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const startPt = polar(start);
    const endPt = polar(end);
    const largeArcFlag = end - start > 180 ? 1 : 0;
    return {
      label: s.label,
      path: `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${endPt.x} ${endPt.y}`,
      color: s.color,
      value: s.value,
    };
  });

  return (
    <div className="nx-dashboard-donut">
      <div className="nx-dashboard-donut__total">{`${total}`}</div>
      <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(210, 238, 255, 0.18)" strokeWidth={strokeWidth} />
        {arcs
          .filter((a) => a.value > 0)
          .map((a) => (
            <path key={a.label} d={a.path} fill="none" stroke={a.color} strokeWidth={strokeWidth} strokeLinecap="round" />
          ))}
        <circle
          cx={cx}
          cy={cy}
          r={r - strokeWidth / 2 - 1}
          fill="rgba(248, 252, 255, 0.08)"
          stroke="rgba(70, 213, 255, 0.22)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div className="nx-dashboard-empty__title">{title}</div>
      <div className="nx-dashboard-empty__subtitle">{subtitle}</div>
    </div>
  );
}

function KpiCard({
  kpi,
  onOpen,
}: {
  kpi: OfficeKpi;
  onOpen: (kpi: OfficeKpi) => void;
}) {
  const clickable = kpi.action_key === 'open_fee_breakdown' || (Boolean(kpi.href) && kpi.status === 'ready');
  const inner = (
    <>
      <div className="nx-dashboard-card__label">{kpi.title_he}</div>
      <div className="nx-dashboard-card__value">{kpi.value_he}</div>
      <div className="nx-dashboard-card__secondary">{kpi.secondary_he}</div>
      {kpi.note_he && kpi.note_he !== kpi.secondary_he ? (
        <div className="nx-dashboard-card__note">{kpi.note_he}</div>
      ) : null}
    </>
  );
  if (clickable) {
    return (
      <button type="button" className="nx-dashboard-card nx-dashboard-card--kpi" onClick={() => onOpen(kpi)}>
        {inner}
      </button>
    );
  }
  return <div className="nx-dashboard-card nx-dashboard-card--kpi">{inner}</div>;
}

export function Dashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const [overview, setOverview] = useState<DashboardOverviewData | null>(null);
  const [period, setPeriod] = useState('current_month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownFilter, setBreakdownFilter] = useState('all');

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    apiJson<DashboardOverviewData>(
      `${dashboardOverview()}?period=${encodeURIComponent(period)}&locale=${encodeURIComponent(lang)}`,
      { signal: ac.signal },
    )
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((e) => {
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth.status, orgId, period, lang]);

  const office = overview?.office ?? null;

  const feePoints = useMemo(
    () =>
      (office?.charts.expected_fees_by_month.points ?? [])
        .filter((p) => p.established && p.value != null)
        .map((p) => ({ xLabel: p.label_he, count: p.value as number })),
    [office],
  );

  const growthPoints = useMemo(
    () =>
      (office?.charts.client_growth.points ?? [])
        .filter((p) => p.value != null)
        .map((p) => ({ xLabel: p.label_he, count: p.value as number })),
    [office],
  );

  const departedPoints = useMemo(
    () =>
      (office?.charts.client_growth.departed_points ?? [])
        .filter((p) => p.value != null)
        .map((p) => ({ xLabel: p.label_he, count: p.value as number })),
    [office],
  );

  if (auth.status !== 'authenticated') return null;
  if (loading) return <div className="nx-dashboard__status">{t('common.loading')}</div>;
  if (error) return <div className="nx-dashboard__status nx-dashboard__status--error">{error}</div>;
  if (!office) {
    return (
      <div className="nx-dashboard" data-testid="nx-dashboard" dir={dir} lang={lang}>
        <EmptyState title={t('dashboard.unavailableTitle')} subtitle={t('dashboard.unavailableSubtitle')} />
      </div>
    );
  }

  const kpis = [
    office.kpis.active_clients,
    office.kpis.expected_fees,
    office.kpis.office_debtors,
    office.kpis.new_clients,
    office.kpis.clients_left,
  ].filter(Boolean);
  const statusTotal = office.client_status.segments.reduce((acc, s) => acc + s.count, 0);
  const collectedReady = overview?.summary.monthly_revenue_status === 'ready';
  const occupyFeeChart = Boolean(office.charts.expected_fees_by_month.occupy_primary) && feePoints.length > 0;

  const openKpi = (kpi: OfficeKpi) => {
    if (kpi.action_key === 'open_fee_breakdown') {
      setBreakdownFilter('all');
      setBreakdownOpen(true);
      return;
    }
    if (kpi.href) navigate(kpi.href);
  };

  return (
    <div className="nx-dashboard" data-testid="nx-dashboard" dir={dir} lang={lang}>
      <div className="nx-dashboard__inner">
        <div className="nx-dashboard__header">
          <div>
            <h1 className="nx-dashboard__title">{office.title_he}</h1>
            <div className="nx-dashboard__subtitle">{office.subtitle_he}</div>
          </div>
          <div className="nx-dashboard-period" role="group" aria-label={office.period.label_he}>
            {office.period.options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`nx-dashboard-period__chip${opt.selected ? ' is-selected' : ''}`}
                onClick={() => setPeriod(opt.key)}
              >
                {opt.label_he}
              </button>
            ))}
          </div>
        </div>

        <div className="nx-dashboard__metrics">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} onOpen={openKpi} />
          ))}
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--triple" data-testid="nx-dashboard-row-attention">
          <div className="nx-dashboard-card">
            <div className="nx-dashboard-card__title">{office.missing_fees.title_he}</div>
            <div className="nx-dashboard-card__hint">
              {office.missing_fees.count_label_he ?? String(office.missing_fees.count)}
              {office.missing_fees.truncated_he ? ` · ${office.missing_fees.truncated_he}` : ''}
            </div>
            {office.missing_fees.status !== 'ready' ? (
              <EmptyState title={office.missing_fees.title_he} subtitle={office.missing_fees.empty_he} />
            ) : office.missing_fees.clients.length === 0 ? (
              <div className="nx-dashboard-empty__subtitle">{office.missing_fees.empty_he}</div>
            ) : (
              <div className="nx-dashboard-list nx-dashboard-list--compact">
                {office.missing_fees.clients.map((c) => (
                  <button
                    key={c.client_id}
                    type="button"
                    className="nx-dashboard-list__row"
                    onClick={() => navigate(c.href)}
                  >
                    <span>{c.display_name}</span>
                    <span className="nx-dashboard-list__tag">{c.indicator_he}</span>
                  </button>
                ))}
              </div>
            )}
            {office.missing_fees.view_all_action === 'open_fee_breakdown' ? (
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--secondary"
                onClick={() => {
                  setBreakdownFilter(office.missing_fees.view_all_filter ?? 'fee_attention');
                  setBreakdownOpen(true);
                }}
              >
                {office.missing_fees.view_all_label_he}
              </button>
            ) : null}
          </div>

          <div className="nx-dashboard-card">
            <div className="nx-dashboard-card__title">{office.attention.title_he}</div>
            <div className="nx-dashboard-attention">
              {office.attention.items.map((item) => {
                const ready = item.status === 'ready';
                const body = (
                  <>
                    <div className="nx-dashboard-card__label">{item.title_he}</div>
                    <div className="nx-dashboard-attention__value">{ready && item.count != null ? item.count : '—'}</div>
                    {!ready ? <div className="nx-dashboard-card__note">{item.unavailable_he}</div> : null}
                  </>
                );
                if (ready && item.href) {
                  return (
                    <button key={item.key} type="button" className="nx-dashboard-attention__item" onClick={() => navigate(item.href!)}>
                      {body}
                    </button>
                  );
                }
                return (
                  <div key={item.key} className="nx-dashboard-attention__item">
                    {body}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nx-dashboard-card nx-dashboard-card--compact">
            <div className="nx-dashboard-card__title">{office.deadlines.title_he}</div>
            {office.deadlines.status === 'ready' && office.deadlines.rows.length > 0 ? (
              <div className="nx-dashboard-list nx-dashboard-list--compact">
                {office.deadlines.rows.map((row, i) => (
                  <div key={`${row.type_he}-${i}`} className="nx-dashboard-list__row nx-dashboard-list__row--static">
                    <span>
                      {row.type_he}
                      {row.severity_he ? ` · ${row.severity_he}` : ''}
                    </span>
                    <span>
                      {row.due_date_he}
                      {row.clients_count != null ? ` · ${row.clients_count}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="nx-dashboard-empty__subtitle">{office.deadlines.unavailable_he}</div>
            )}
          </div>
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--triple" data-testid="nx-dashboard-row-charts">
          <div className="nx-dashboard-card">
            <div className="nx-dashboard-card__title">{office.charts.client_growth.title_he}</div>
            <div className="nx-dashboard-card__hint">{office.charts.client_growth.hint_he ?? ''}</div>
            {growthPoints.length === 0 ? (
              <EmptyState title={office.charts.client_growth.title_he} subtitle={t('dashboard.growthEmpty')} />
            ) : (
              <div className="nx-dashboard-chart">
                <LineChart points={growthPoints} secondary={departedPoints} compact />
              </div>
            )}
          </div>
          <div className="nx-dashboard-card nx-dashboard-card--compact">
            <div className="nx-dashboard-card__title">{office.client_status.title_he}</div>
            <DonutChart
              total={statusTotal}
              segments={office.client_status.segments.map((s) => ({ label: s.label_he, value: s.count, color: s.color }))}
            />
            <div className="nx-dashboard-legend">
              {office.client_status.segments.map((s) => (
                <div key={s.key} className="nx-dashboard-legend__item">
                  <span className="nx-dashboard-legend__swatch" style={{ background: s.color }} />
                  <span>{`${s.label_he} · ${s.count}`}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="nx-dashboard-card nx-dashboard-card--compact">
            <div className="nx-dashboard-card__title">{office.charts.expected_fees_by_month.title_he}</div>
            {occupyFeeChart ? (
              <div className="nx-dashboard-chart">
                <LineChart points={feePoints} compact />
              </div>
            ) : (
              <div className="nx-dashboard-empty__subtitle">{office.charts.expected_fees_by_month.historical_basis_he}</div>
            )}
          </div>
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--compact">
          <div className="nx-dashboard-card nx-dashboard-card--compact">
            <div className="nx-dashboard-card__title">{office.quick_actions.title_he}</div>
            <div className="nx-dashboard-actions">
              {office.quick_actions.actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={
                    action.key === 'new_client'
                      ? 'nx-dashboard-btn nx-dashboard-btn--primary'
                      : 'nx-dashboard-btn nx-dashboard-btn--secondary'
                  }
                  onClick={() => navigate(action.href)}
                  disabled={!action.enabled}
                >
                  {action.label_he}
                </button>
              ))}
            </div>
            {!collectedReady ? (
              <div className="nx-dashboard-card__note nx-dashboard-card__note--spaced">
                {office.quick_actions.collected_cash_note_he}
              </div>
            ) : null}
          </div>
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--compact">
          <div className="nx-dashboard-card nx-dashboard-card--compact nx-dashboard-card--muted">
            <div className="nx-dashboard-card__title">{office.recent_activity.title_he}</div>
            <div className="nx-dashboard-empty__subtitle">{office.recent_activity.unavailable_he}</div>
          </div>
        </div>
      </div>
      <DashboardFeeBreakdownModal
        open={breakdownOpen}
        period={period}
        locale={lang}
        initialFilter={breakdownFilter}
        onClose={() => setBreakdownOpen(false)}
        onOpenClient={(href) => {
          setBreakdownOpen(false);
          navigate(href);
        }}
      />
    </div>
  );
}
