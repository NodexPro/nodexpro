import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { dashboardOverview } from '../api/endpoints';
import '../styles/nx-dashboard.css';

type DashboardOverviewData = {
  summary: {
    new_clients_this_month: number;
    new_clients_last_month: number;
    new_clients_vs_last_month_pct: number | null;
    new_clients_vs_last_month_abs: number;
    total_clients: number;
    total_clients_secondary_line: string | null;
    debtors_status: 'ready' | 'coming_soon' | 'unavailable';
    debtors_count: number | null;
    debtors_amount: { amount: number; currency: string } | null;
    monthly_revenue_status: 'ready' | 'coming_soon' | 'unavailable';
    monthly_revenue: { amount: number; currency: string } | null;
  };
  charts: {
    new_clients_by_month: Array<{ month: string; count: number }>; // YYYY-MM (UTC)
    filing_schedules: {
      monthly: number | null;
      every_2_months: number | null;
      mikdamot: number | null;
      status: 'ready' | 'coming_soon' | 'unavailable' | 'empty';
    };
  };
  operations: {
    clients_per_worker: Array<{ worker_name: string; clients_count: number }> | null;
    clients_per_worker_status: 'ready' | 'coming_soon' | 'unavailable' | 'empty';
    report_deadlines: {
      as_of_date: string | null;
      overdue_total: number | null;
      monthly_overdue: number | null;
      bimonthly_overdue: number | null;
      mikdamot_overdue: number | null;
      status: 'ready' | 'coming_soon' | 'unavailable' | 'empty';
    };
  };
  organization: {
    name: string;
    trial_status: string;
    trial_ends_at: string | null;
    active_plan: string;
  };
  quick_actions: {
    can_create_client: boolean;
    can_upload_document: boolean;
    can_invite_member: boolean;
  };
};

function formatCurrency(amount: unknown, currency: unknown): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  if (typeof currency !== 'string' || currency.trim() === '') return '—';
  try {
    if (currency === 'ILS') {
      const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount);
      return `₪${formatted}`;
    }
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return '—';
  }
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1, 0, 0, 0));
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d);
}

function DonutChart({
  total,
  segments,
  colors,
}: {
  total: number;
  segments: Array<{ label: string; value: number }>;
  colors: Record<string, string>;
}) {
  const size = 180;
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
    const path = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${endPt.x} ${endPt.y}`;

    return {
      label: s.label,
      path,
      color: colors[s.label] ?? '#7decf7',
      value: s.value,
    };
  });

  return (
    <div className="nx-dashboard-donut">
      <div className="nx-dashboard-donut__total">{`${total} clients`}</div>
      <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(210, 238, 255, 0.18)" strokeWidth={strokeWidth} />
        {arcs
          .filter((a) => a.value > 0)
          .map((a) => (
            <path key={a.label} d={a.path} fill="none" stroke={a.color} strokeWidth={strokeWidth} strokeLinecap="round" />
          ))}
        <circle cx={cx} cy={cy} r={r - strokeWidth / 2 - 1} fill="rgba(8, 38, 82, 0.55)" stroke="rgba(70, 213, 255, 0.22)" strokeWidth={1} />
      </svg>
    </div>
  );
}

function LineChart({ points }: { points: Array<{ xLabel: string; count: number }> }) {
  const w = 600;
  const h = 220;
  const paddingLeft = 44;
  const paddingRight = 16;
  const paddingTop = 10;
  const paddingBottom = 40;
  const plotW = w - paddingLeft - paddingRight;
  const plotH = h - paddingTop - paddingBottom;

  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.count));
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
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      {gridLines.map((g, idx) => (
        <line key={idx} x1={paddingLeft} x2={w - paddingRight} y1={g.y} y2={g.y} stroke="rgba(210, 238, 255, 0.16)" strokeWidth={1} />
      ))}
      {coords.length > 1 && (
        <path d={areaPath} fill="rgba(0, 207, 239, 0.16)" stroke="none" />
      )}
      {coords.length > 0 && (
        <polyline points={polyline} fill="none" stroke="#39e6f4" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {coords.map((c, i) => (
        <g key={`${c.xLabel}-${i}`}>
          <circle cx={c.x} cy={c.y} r={4} fill="#39e6f4" stroke="#04152f" strokeWidth={2} />
        </g>
      ))}
      {coords.map((c, i) =>
        i % labelEvery === 0 || i === coords.length - 1 ? (
          <text key={c.xLabel + i} x={c.x} y={h - 18} textAnchor="middle" fontSize={12} fill="rgba(238, 246, 255, 0.72)" fontFamily="Arial, sans-serif">
            {c.xLabel}
          </text>
        ) : null
      )}
    </svg>
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

function SectionTitle({ title }: { title: string }) {
  return <div className="nx-dashboard-card__title">{title}</div>;
}

function SummaryCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: ReactNode;
  secondary: ReactNode;
}) {
  return (
    <div className="nx-dashboard-card">
      <div className="nx-dashboard-card__label">{label}</div>
      <div className="nx-dashboard-card__value">{value}</div>
      <div className="nx-dashboard-card__secondary">{secondary}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="nx-dashboard-field">
      <div className="nx-dashboard-field__label">{label}</div>
      <div className="nx-dashboard-field__value">{value}</div>
    </div>
  );
}

export function Dashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DashboardOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    apiJson<DashboardOverviewData>(dashboardOverview(), { signal: ac.signal })
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
  }, [auth.status, orgId]);

  const trendPoints = useMemo(() => {
    const arr = overview?.charts.new_clients_by_month ?? [];
    return arr.map((p) => ({
      xLabel: formatMonthLabel(p.month),
      count: p.count,
    }));
  }, [overview?.charts.new_clients_by_month]);

  if (auth.status !== 'authenticated') return null;
  if (loading) return <div className="nx-dashboard__status">Loading…</div>;
  if (error) return <div className="nx-dashboard__status nx-dashboard__status--error">{error}</div>;
  if (!overview) return null;

  const { summary, charts, operations, organization, quick_actions } = overview;

  const newClientsThisMonth = summary.new_clients_this_month;
  const showPct = summary.new_clients_vs_last_month_pct != null;
  const deltaSecondary = showPct ? `${summary.new_clients_vs_last_month_pct! >= 0 ? '+' : ''}${summary.new_clients_vs_last_month_pct!.toFixed(0)}%` : `${summary.new_clients_vs_last_month_abs}`;

  const debtorsReady = summary.debtors_status === 'ready';
  const revenueReady = summary.monthly_revenue_status === 'ready';

  const filingReady = charts.filing_schedules.status === 'ready';
  const filingSegmentsReady =
    filingReady && charts.filing_schedules.monthly != null && charts.filing_schedules.every_2_months != null && charts.filing_schedules.mikdamot != null;
  const assignmentsReady = operations.clients_per_worker_status === 'ready' && (operations.clients_per_worker ?? []).length > 0;
  const deadlinesReady = operations.report_deadlines.status === 'ready';

  const trialEndsLabel = organization.trial_ends_at ? new Date(organization.trial_ends_at).toLocaleDateString() : '—';
  const trialStatusLabel =
    organization.trial_status === 'trialing'
      ? 'active'
      : organization.trial_status === 'trial_expired'
        ? 'expired'
        : organization.trial_status === 'converted'
          ? 'converted'
          : organization.trial_status === 'not_started'
            ? 'not started'
            : organization.trial_status;

  const filingColors = {
    Monthly: '#268cff',
    'Every 2 months': '#39e6f4',
    Mikdamot: '#7decf7',
  };

  return (
    <div className="nx-dashboard" data-testid="nx-dashboard">
      <div className="nx-dashboard__inner">
        <h1 className="nx-dashboard__title">Dashboard</h1>
        <div className="nx-dashboard__subtitle">Overview of your organization.</div>

        <div className="nx-dashboard__metrics">
          <SummaryCard label="New clients" value={newClientsThisMonth} secondary={`vs last month: ${deltaSecondary}`} />
          <SummaryCard
            label="Active Total clients"
            value={summary.total_clients}
            secondary={summary.total_clients_secondary_line ?? '—'}
          />
          <SummaryCard
            label="Debtors"
            value={debtorsReady && summary.debtors_count != null ? summary.debtors_count : '—'}
            secondary={
              debtorsReady
                ? `unpaid total: ${summary.debtors_amount ? formatCurrency(summary.debtors_amount.amount, summary.debtors_amount.currency) : '—'}`
                : 'Available after Debt module'
            }
          />
          <SummaryCard
            label="Total revenue"
            value={revenueReady && summary.monthly_revenue != null ? formatCurrency(summary.monthly_revenue.amount, summary.monthly_revenue.currency) : '—'}
            secondary={
              revenueReady
                ? 'current month · office-earned revenue'
                : 'Office-earned revenue is not available yet. Accounting Base does not expose this metric.'
            }
          />
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--chart">
          <div className="nx-dashboard-card">
            <SectionTitle title="New clients" />
            <div className="nx-dashboard-card__hint">Created clients by month</div>
            <LineChart points={trendPoints} />
            <div className="nx-dashboard-chart-meta">
              <div className="nx-dashboard-field__value">This month: {newClientsThisMonth}</div>
              <div className="nx-dashboard-card__hint" style={{ marginBottom: 0 }}>
                {showPct ? `vs last month: ${summary.new_clients_vs_last_month_pct! >= 0 ? '+' : ''}${summary.new_clients_vs_last_month_pct!.toFixed(0)}%` : `vs last month: ${summary.new_clients_vs_last_month_abs}`}
              </div>
            </div>
          </div>

          <div className="nx-dashboard-card">
            {!filingSegmentsReady ? (
              <EmptyState title="Filing schedules" subtitle="Will be available after Client Operations module is connected" />
            ) : (
              <>
                <SectionTitle title="Filing schedules" />
                <DonutChart
                  total={summary.total_clients}
                  segments={[
                    { label: 'Monthly', value: charts.filing_schedules.monthly ?? 0 },
                    { label: 'Every 2 months', value: charts.filing_schedules.every_2_months ?? 0 },
                    { label: 'Mikdamot', value: charts.filing_schedules.mikdamot ?? 0 },
                  ]}
                  colors={filingColors}
                />
                <div className="nx-dashboard-legend">
                  {[
                    { label: 'Monthly', color: filingColors.Monthly },
                    { label: 'Every 2 months', color: filingColors['Every 2 months'] },
                    { label: 'Mikdamot', color: filingColors.Mikdamot },
                  ].map((l) => (
                    <div key={l.label} className="nx-dashboard-legend__item">
                      <span className="nx-dashboard-legend__swatch" style={{ background: l.color }} />
                      <span>{l.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--split">
          <div className="nx-dashboard-card">
            <SectionTitle title="Client assignments" />
            {!assignmentsReady ? (
              <EmptyState
                title="No client assignment data yet"
                subtitle="Assignment metrics will appear after Client Operations module is connected"
              />
            ) : (
              <div>
                {(operations.clients_per_worker ?? []).map((r) => (
                  <div key={r.worker_name} className="nx-dashboard-assign-row">
                    <div>{r.worker_name}</div>
                    <div>{r.clients_count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="nx-dashboard-card">
            <SectionTitle title="Report deadlines" />
            {!deadlinesReady ? (
              <EmptyState title="No reporting deadline data yet" subtitle="Deadline monitoring will appear after Client Operations module is connected" />
            ) : (
              <div>
                <div className="nx-dashboard-deadlines__lead">
                  {operations.report_deadlines.as_of_date
                    ? `As of ${new Date(operations.report_deadlines.as_of_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${
                        operations.report_deadlines.overdue_total != null ? operations.report_deadlines.overdue_total : '—'
                      } clients have overdue reports`
                    : `As of —, ${operations.report_deadlines.overdue_total != null ? operations.report_deadlines.overdue_total : '—'} clients have overdue reports`}
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="nx-dashboard-deadlines__row">
                    <span>Monthly filings overdue</span>
                    <span>{operations.report_deadlines.monthly_overdue ?? '—'}</span>
                  </div>
                  <div className="nx-dashboard-deadlines__row">
                    <span>Bi-monthly filings overdue</span>
                    <span>{operations.report_deadlines.bimonthly_overdue ?? '—'}</span>
                  </div>
                  <div className="nx-dashboard-deadlines__row">
                    <span>Mikdamot overdue</span>
                    <span>{operations.report_deadlines.mikdamot_overdue ?? '—'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="nx-dashboard__row nx-dashboard__row--split">
          <div className="nx-dashboard-card">
            <SectionTitle title="Organization" />
            <div style={{ display: 'grid', gap: 16 }}>
              <FieldRow label="Organization name" value={organization.name ?? '—'} />
              <FieldRow label="Trial status" value={trialStatusLabel ?? '—'} />
              <FieldRow label="Trial ends" value={trialEndsLabel ?? '—'} />
              <FieldRow label="Active plan" value={organization.active_plan ?? '—'} />
            </div>
          </div>

          <div className="nx-dashboard-card">
            <SectionTitle title="Quick actions" />
            <div className="nx-dashboard-actions">
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--primary"
                onClick={() => navigate('/clients')}
                disabled={!quick_actions.can_create_client}
              >
                New client
              </button>
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--secondary"
                onClick={() => navigate('/documents')}
                disabled={!quick_actions.can_upload_document}
              >
                Upload document
              </button>
              <button
                type="button"
                className="nx-dashboard-btn nx-dashboard-btn--secondary"
                onClick={() => navigate('/users-roles')}
                disabled={!quick_actions.can_invite_member}
              >
                Invite member
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
