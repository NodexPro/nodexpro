/**
 * Visual harness: Office Dashboard V2 navy-glass markup.
 * Values here are layout-only and must not be treated as live office truth.
 */
import { createRoot } from 'react-dom/client';
import '../src/templates/template-1/tokens.css';
import '../src/styles/nx-client-operations-shell.css';
import '../src/styles/nx-dashboard.css';

function Card({ label, value, secondary }: { label: string; value: string; secondary: string }) {
  return (
    <div className="nx-dashboard-card nx-dashboard-card--kpi">
      <div className="nx-dashboard-card__label">{label}</div>
      <div className="nx-dashboard-card__value">{value}</div>
      <div className="nx-dashboard-card__secondary">{secondary}</div>
    </div>
  );
}

const dir = new URLSearchParams(window.location.search).get('dir') === 'ltr' ? 'ltr' : 'rtl';
const lang = dir === 'ltr' ? 'en' : 'he';

createRoot(document.getElementById('root')!).render(
  <div className="t1-appShell t1-appShell--client-operations" style={{ display: 'flex', minHeight: '100vh' }}>
    <aside className="t1-sidebar" style={{ width: 64, flex: '0 0 64px' }}>
      nav
    </aside>
    <div className="t1-shellColumn" style={{ flex: 1, minWidth: 0 }}>
      <main className="t1-pageMain t1-pageMain--dashboard">
        <div className="nx-dashboard" data-testid="nx-dashboard" dir={dir} lang={lang}>
          <div className="nx-dashboard__inner">
            <div className="nx-dashboard__header">
              <div>
                <h1 className="nx-dashboard__title">{dir === 'ltr' ? 'Office overview' : 'סקירת המשרד'}</h1>
                <div className="nx-dashboard__subtitle">{dir === 'ltr' ? 'A snapshot of the office' : 'תמונת מצב של המשרד'}</div>
              </div>
              <div className="nx-dashboard-period">
                <button type="button" className="nx-dashboard-period__chip is-selected">
                  {dir === 'ltr' ? 'Current month' : 'חודש נוכחי'}
                </button>
                <button type="button" className="nx-dashboard-period__chip">
                  {dir === 'ltr' ? 'Previous month' : 'חודש קודם'}
                </button>
                <button type="button" className="nx-dashboard-period__chip">
                  {dir === 'ltr' ? 'Current year' : 'שנה נוכחית'}
                </button>
              </div>
            </div>
            <div className="nx-dashboard__metrics">
              <Card
                label={dir === 'ltr' ? 'Active clients' : 'לקוחות פעילים'}
                value="—"
                secondary={dir === 'ltr' ? 'Active office status · not period-dependent' : 'סטטוס פעיל במשרד · לא תלוי בתקופה הנבחרת'}
              />
              <Card
                label={dir === 'ltr' ? 'Expected monthly office fees' : 'הכנסה חודשית צפויה משכ״ט'}
                value="—"
                secondary={dir === 'ltr' ? 'Current monthly expected fees before VAT · not cash collected' : 'צפי חודשי לפני מע״מ · לא כולל גבייה בפועל'}
              />
              <Card
                label={dir === 'ltr' ? 'Clients with office debt' : 'לקוחות עם חוב למשרד'}
                value="—"
                secondary={dir === 'ltr' ? 'Genuine office receivables are not yet available from Accounting Base' : 'חוב אמיתי למשרד עדיין לא זמין מ-Accounting Base'}
              />
              <Card
                label={dir === 'ltr' ? 'New clients' : 'לקוחות חדשים'}
                value="—"
                secondary={dir === 'ltr' ? 'Added in current month' : 'נוספו בחודש נוכחי'}
              />
            </div>
            <div className="nx-dashboard__row nx-dashboard__row--split">
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Clients without configured fees' : 'לקוחות ללא שכ״ט מוגדר'}</div>
                <div className="nx-dashboard-empty__subtitle">
                  {dir === 'ltr' ? 'This list comes from the office aggregate only.' : 'הרשימה מגיעה מאגרגט המשרד בלבד.'}
                </div>
              </div>
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Tasks needing attention' : 'משימות דורשות תשומת לב'}</div>
                <div className="nx-dashboard-attention">
                  <div className="nx-dashboard-attention__item">
                    <div className="nx-dashboard-card__label">{dir === 'ltr' ? 'Overdue tasks' : 'משימות באיחור'}</div>
                    <div className="nx-dashboard-attention__value">—</div>
                  </div>
                  <div className="nx-dashboard-attention__item">
                    <div className="nx-dashboard-card__label">{dir === 'ltr' ? 'Due today' : 'לביצוע היום'}</div>
                    <div className="nx-dashboard-attention__value">—</div>
                  </div>
                </div>
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
  const cards = Array.from(document.querySelectorAll('.nx-dashboard-card')) as HTMLElement[];
  const nested = document.querySelector('.nx-dashboard-attention__item') as HTMLElement | null;
  const chip = document.querySelector('.nx-dashboard-period__chip') as HTMLElement | null;
  const title = document.querySelector('.nx-dashboard__title') as HTMLElement | null;
  const header = document.querySelector('header');
  const pre = document.getElementById('nx-layout-dump');
  if (pre && dash) {
    pre.textContent = JSON.stringify({
      headerPresent: Boolean(header),
      titleFont: title ? getComputedStyle(title).fontFamily : '',
      dashFont: getComputedStyle(dash).fontFamily,
      dashBg: getComputedStyle(dash).backgroundColor,
      cardCount: cards.length,
      firstCardBg: cards[0] ? getComputedStyle(cards[0]).backgroundImage : '',
      firstCardBlur: cards[0] ? getComputedStyle(cards[0]).backdropFilter : '',
      nestedBg: nested ? getComputedStyle(nested).backgroundImage : '',
      chipBg: chip ? getComputedStyle(chip).backgroundImage : '',
      titleText: title?.textContent ?? '',
      direction: getComputedStyle(dash).direction,
      overflowX: dash.scrollWidth > dash.clientWidth,
    });
  }
});
