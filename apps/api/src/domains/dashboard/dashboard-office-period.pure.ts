/**
 * Office dashboard period windows.
 * Calendar semantics use Asia/Jerusalem (office TZ). Custom ranges are not
 * supported by the existing dashboard contract.
 */

import { officeCopy, type DashboardLocale } from './dashboard-office-copy.pure.js';

export const DASHBOARD_PERIOD_KEYS = ['current_month', 'previous_month', 'current_year'] as const;
export type DashboardPeriodKey = (typeof DASHBOARD_PERIOD_KEYS)[number];
export type { DashboardLocale };

export const DASHBOARD_OFFICE_TIME_ZONE = 'Asia/Jerusalem';

export type DashboardPeriodWindow = {
  key: DashboardPeriodKey;
  label_he: string;
  start_date: string;
  end_date: string;
  start_iso: string;
  end_exclusive_iso: string;
};

export function parseDashboardPeriodKey(raw: unknown): DashboardPeriodKey {
  const s = String(raw ?? '').trim();
  if ((DASHBOARD_PERIOD_KEYS as readonly string[]).includes(s)) return s as DashboardPeriodKey;
  return 'current_month';
}

function jerusalemYmd(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_OFFICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), day: get('day') };
}

function ymdToIsoDate(y: number, m: number, day: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function jerusalemMidnightUtcIso(y: number, m: number, day: number): string {
  const guess = Date.UTC(y, m - 1, day, 0, 0, 0);
  const probe = jerusalemYmd(new Date(guess));
  const deltaDays = Date.UTC(y, m - 1, day) - Date.UTC(probe.y, probe.m - 1, probe.day);
  return new Date(guess + deltaDays).toISOString();
}

export function resolveDashboardPeriodWindow(
  now: Date,
  key: DashboardPeriodKey,
  locale: DashboardLocale = 'en',
): DashboardPeriodWindow {
  const { y, m } = jerusalemYmd(now);
  if (key === 'previous_month') {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const start = ymdToIsoDate(py, pm, 1);
    const end = ymdToIsoDate(py, pm, lastDayOfMonth(py, pm));
    const ny = pm === 12 ? py + 1 : py;
    const nm = pm === 12 ? 1 : pm + 1;
    return {
      key,
      label_he: officeCopy(locale).period_previous_month,
      start_date: start,
      end_date: end,
      start_iso: jerusalemMidnightUtcIso(py, pm, 1),
      end_exclusive_iso: jerusalemMidnightUtcIso(ny, nm, 1),
    };
  }
  if (key === 'current_year') {
    return {
      key,
      label_he: officeCopy(locale).period_current_year,
      start_date: ymdToIsoDate(y, 1, 1),
      end_date: ymdToIsoDate(y, 12, 31),
      start_iso: jerusalemMidnightUtcIso(y, 1, 1),
      end_exclusive_iso: jerusalemMidnightUtcIso(y + 1, 1, 1),
    };
  }
  const start = ymdToIsoDate(y, m, 1);
  const end = ymdToIsoDate(y, m, lastDayOfMonth(y, m));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    key,
    label_he: officeCopy(locale).period_current_month,
    start_date: start,
    end_date: end,
    start_iso: jerusalemMidnightUtcIso(y, m, 1),
    end_exclusive_iso: jerusalemMidnightUtcIso(ny, nm, 1),
  };
}

export function dashboardPeriodOptions(
  selected: DashboardPeriodKey,
  locale: DashboardLocale = 'en',
): Array<{
  key: DashboardPeriodKey;
  label_he: string;
  selected: boolean;
}> {
  const copy = officeCopy(locale);
  return [
    { key: 'current_month', label_he: copy.period_current_month, selected: selected === 'current_month' },
    { key: 'previous_month', label_he: copy.period_previous_month, selected: selected === 'previous_month' },
    { key: 'current_year', label_he: copy.period_current_year, selected: selected === 'current_year' },
  ];
}

export function lastNJerusalemMonths(now: Date, n: number): Array<{ month_key: string; start_date: string; end_date: string }> {
  const { y, m } = jerusalemYmd(now);
  const out: Array<{ month_key: string; start_date: string; end_date: string }> = [];
  let cy = y;
  let cm = m;
  for (let i = 0; i < n; i += 1) {
    out.push({
      month_key: `${cy}-${String(cm).padStart(2, '0')}`,
      start_date: ymdToIsoDate(cy, cm, 1),
      end_date: ymdToIsoDate(cy, cm, lastDayOfMonth(cy, cm)),
    });
    if (cm === 1) {
      cm = 12;
      cy -= 1;
    } else {
      cm -= 1;
    }
  }
  return out.reverse();
}

export function jerusalemTodayDate(now: Date): string {
  const { y, m, day } = jerusalemYmd(now);
  return ymdToIsoDate(y, m, day);
}

export function jerusalemDayWindow(now: Date): { date: string; start_iso: string; end_exclusive_iso: string } {
  const { y, m, day } = jerusalemYmd(now);
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  return {
    date: ymdToIsoDate(y, m, day),
    start_iso: jerusalemMidnightUtcIso(y, m, day),
    end_exclusive_iso: jerusalemMidnightUtcIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

export function isoToJerusalemDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const s = String(iso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  const { y, m, day } = jerusalemYmd(d);
  return ymdToIsoDate(y, m, day);
}
