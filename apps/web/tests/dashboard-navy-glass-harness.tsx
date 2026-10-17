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
              <Card
                label={dir === 'ltr' ? 'Clients who left' : 'לקוחות שעזבו'}
                value="—"
                secondary={dir === 'ltr' ? 'Service ended in current month' : 'סיום טיפול בחודש נוכחי'}
              />
            </div>
            <div className="nx-dashboard__row nx-dashboard__row--triple" data-testid="nx-dashboard-row-attention">
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Clients without configured fees' : 'לקוחות ללא שכ״ט מוגדר'}</div>
                <div className="nx-dashboard-list nx-dashboard-list--compact">
                  <button type="button" className="nx-dashboard-list__row">
                    <span>Client A</span>
                    <span className="nx-dashboard-list__tag">{dir === 'ltr' ? 'No fee agreement' : 'לא הוגדר הסכם שכ״ט'}</span>
                  </button>
                  <button type="button" className="nx-dashboard-list__row">
                    <span>Client B</span>
                    <span className="nx-dashboard-list__tag">{dir === 'ltr' ? '₪0 fee' : 'שכ״ט 0 ₪'}</span>
                  </button>
                </div>
                <button type="button" className="nx-dashboard-btn nx-dashboard-btn--secondary">
                  {dir === 'ltr' ? 'View all' : 'הצג הכל'}
                </button>
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
              <div className="nx-dashboard-card nx-dashboard-card--compact">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Upcoming reports' : 'הדיווחים הקרובים'}</div>
                <div className="nx-dashboard-empty__subtitle">
                  {dir === 'ltr'
                    ? 'Statutory reporting deadlines are not yet available through an authorized aggregate. No dates were hardcoded.'
                    : 'מועדי דיווח סטטוטוריים עדיין לא זמינים דרך aggregate מורשה. לא נקבעו מועדים בצד הלקוח.'}
                </div>
              </div>
            </div>
            <div className="nx-dashboard__row nx-dashboard__row--triple" data-testid="nx-dashboard-row-charts">
              <div className="nx-dashboard-card">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Client growth' : 'צמיחת לקוחות'}</div>
                <div className="nx-dashboard-empty__subtitle">
                  {dir === 'ltr' ? 'Active at month end from open/end dates.' : 'פעילים בסוף החודש לפי תאריך פתיחה וסיום טיפול'}
                </div>
              </div>
              <div className="nx-dashboard-card nx-dashboard-card--compact">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Client status' : 'סטטוס לקוחות'}</div>
                <div className="nx-dashboard-empty__subtitle">{dir === 'ltr' ? 'Backend-owned status counts.' : 'סטטוסים מהאגרגט בלבד.'}</div>
              </div>
              <div className="nx-dashboard-card nx-dashboard-card--compact">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Expected fees by month' : 'הכנסה צפויה משכ״ט לפי חודשים'}</div>
                <div className="nx-dashboard-empty__subtitle">
                  {dir === 'ltr'
                    ? 'Historical months are not shown: fee history does not include frequency, VAT, discount, or monthly equivalent.'
                    : 'חודשים היסטוריים אינם מוצגים: היסטוריית השכ״ט אינה כוללת תדירות, מע״מ, הנחה או שווי חודשי.'}
                </div>
              </div>
            </div>
            <div className="nx-dashboard__row nx-dashboard__row--compact">
              <div className="nx-dashboard-card nx-dashboard-card--compact">
                <div className="nx-dashboard-card__title">{dir === 'ltr' ? 'Quick actions' : 'פעולות מהירות'}</div>
                <div className="nx-dashboard-actions">
                  <button type="button" className="nx-dashboard-btn nx-dashboard-btn--primary">
                    {dir === 'ltr' ? 'New client' : 'לקוח חדש'}
                  </button>
                  <button type="button" className="nx-dashboard-btn nx-dashboard-btn--secondary">
                    {dir === 'ltr' ? 'Upload document' : 'העלאת מסמך'}
                  </button>
                  <button type="button" className="nx-dashboard-btn nx-dashboard-btn--secondary">
                    {dir === 'ltr' ? 'Tasks' : 'משימות'}
                  </button>
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
  const metrics = document.querySelector('.nx-dashboard__metrics') as HTMLElement | null;
  const attentionRow = document.querySelector('[data-testid="nx-dashboard-row-attention"]') as HTMLElement | null;
  const chartRow = document.querySelector('[data-testid="nx-dashboard-row-charts"]') as HTMLElement | null;
  const header = document.querySelector('header');
  const pre = document.getElementById('nx-layout-dump');
  if (pre && dash) {
    pre.textContent = JSON.stringify({
      headerPresent: Boolean(header),
      titleFont: title ? getComputedStyle(title).fontFamily : '',
      dashFont: getComputedStyle(dash).fontFamily,
      dashBg: getComputedStyle(dash).backgroundColor,
      cardCount: cards.length,
      kpiCount: metrics?.children.length ?? 0,
      metricsCols: metrics ? getComputedStyle(metrics).gridTemplateColumns.split(' ').length : 0,
      attentionCols: attentionRow ? getComputedStyle(attentionRow).gridTemplateColumns.split(' ').length : 0,
      chartCols: chartRow ? getComputedStyle(chartRow).gridTemplateColumns.split(' ').length : 0,
      firstCardBg: cards[0] ? getComputedStyle(cards[0]).backgroundImage : '',
      firstCardBlur: cards[0] ? getComputedStyle(cards[0]).backdropFilter : '',
      nestedBg: nested ? getComputedStyle(nested).backgroundImage : '',
      chipBg: chip ? getComputedStyle(chip).backgroundImage : '',
      titleText: title?.textContent ?? '',
      direction: getComputedStyle(dash).direction,
      overflowX: dash.scrollWidth > dash.clientWidth,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });
  }
});
