/**
 * Visual harness: Dashboard navy-glass markup with representative aggregate values.
 * TOTAL REVENUE stays unavailable — no invented office-earned number.
 */
import { createRoot } from 'react-dom/client';
import '../src/templates/template-1/tokens.css';
import '../src/styles/nx-client-operations-shell.css';
import '../src/styles/nx-dashboard.css';

function Card({ label, value, secondary }: { label: string; value: string; secondary: string }) {
  return (
    <div className="nx-dashboard-card">
      <div className="nx-dashboard-card__label">{label}</div>
      <div className="nx-dashboard-card__value">{value}</div>
      <div className="nx-dashboard-card__secondary">{secondary}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <div className="t1-appShell t1-appShell--client-operations" style={{ display: 'flex', minHeight: '100vh' }}>
    <aside className="t1-sidebar" style={{ width: 64, flex: '0 0 64px' }}>
      nav
    </aside>
    <div className="t1-shellColumn" style={{ flex: 1, minWidth: 0 }}>
      <main className="t1-pageMain t1-pageMain--dashboard">
        <div className="nx-dashboard" data-testid="nx-dashboard">
          <div className="nx-dashboard__inner">
            <h1 className="nx-dashboard__title">Dashboard</h1>
            <div className="nx-dashboard__subtitle">Overview of your organization.</div>
            <div className="nx-dashboard__metrics">
              <Card label="New clients" value="4" secondary="vs last month: +2" />
              <Card label="Active Total clients" value="128" secondary="active office clients" />
              <Card label="Debtors" value="—" secondary="Available after Debt module" />
              <Card
                label="Total revenue"
                value="—"
                secondary="Office-earned revenue is not available yet. Accounting Base does not expose this metric."
              />
            </div>
            <div className="nx-dashboard__row nx-dashboard__row--chart">
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-card__title">New clients</div>
                <div className="nx-dashboard-card__hint">Created clients by month</div>
              </div>
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-empty__title">Filing schedules</div>
                <div className="nx-dashboard-empty__subtitle">Will be available after Client Operations module is connected</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>,
);

requestAnimationFrame(() => {
  const dash = document.querySelector('.nx-dashboard') as HTMLElement | null;
  const cards = Array.from(document.querySelectorAll('.nx-dashboard-card'));
  const title = document.querySelector('.nx-dashboard__title') as HTMLElement | null;
  const header = document.querySelector('header');
  const revenue = Array.from(document.querySelectorAll('.nx-dashboard-card')).find((el) =>
    (el.textContent || '').includes('Total revenue'),
  );
  const pre = document.getElementById('nx-layout-dump');
  if (pre && dash) {
    pre.textContent = JSON.stringify({
      headerPresent: Boolean(header),
      titleFont: title ? getComputedStyle(title).fontFamily : '',
      dashFont: getComputedStyle(dash).fontFamily,
      dashBg: getComputedStyle(dash).backgroundColor,
      cardCount: cards.length,
      firstCardBg: cards[0] ? getComputedStyle(cards[0]).backgroundImage : '',
      revenueValue: revenue?.querySelector('.nx-dashboard-card__value')?.textContent ?? '',
      revenueSecondary: revenue?.querySelector('.nx-dashboard-card__secondary')?.textContent ?? '',
    });
  }
});
