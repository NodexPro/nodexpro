/** Presentation helpers for the annual/capital filing date control. No statutory dates. */

export type FilingCalendarCell = {
  iso: string;
  day: number;
  inMonth: boolean;
};

export function filingDateLocale(lang: string): string {
  if (lang === 'he') return 'he-IL';
  if (lang === 'ru') return 'ru-RU';
  return 'en-GB';
}

export function parseIsoDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

export function formatFilingDateDisplay(iso: string | null | undefined, lang: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(filingDateLocale(lang), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

export function formatOperationalDateLabel(value: string | null | undefined, lang: string): string {
  if (!value || !value.trim()) return '—';
  const iso = value.trim().slice(0, 10);
  const formatted = formatFilingDateDisplay(iso, lang);
  return formatted || value;
}

export function formatCalendarMonthLabel(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(filingDateLocale(lang), {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function calendarWeekdayLabels(lang: string): string[] {
  const locale = filingDateLocale(lang);
  const sundayStart = lang === 'he';
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const weekday = sundayStart ? i : (i + 1) % 7;
    labels.push(formatter.format(new Date(Date.UTC(2026, 10, 1 + weekday))));
  }
  return labels;
}

export function buildFilingCalendarCells(year: number, month: number, lang: string): FilingCalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const sundayStart = lang === 'he';
  const leading = sundayStart ? firstWeekday : (firstWeekday + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - leading));
  const cells: FilingCalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    cells.push({
      iso: formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === month && date.getUTCFullYear() === year,
    });
  }
  return cells;
}

export function nextAnnualCapitalPendingKind(input: {
  filingKind: 'annual_report' | 'capital_declaration';
  hasForm1301: boolean;
}): 'form_1301' | 'additional' {
  if (input.filingKind === 'annual_report' && !input.hasForm1301) return 'form_1301';
  return 'additional';
}

export type FilingCalendarPlacement = { left: number; top: number; width: number };

export function placeFilingCalendar(input: {
  anchor: { left: number; right: number; top: number; bottom: number };
  viewportWidth: number;
  viewportHeight: number;
  dir: 'rtl' | 'ltr';
}): FilingCalendarPlacement {
  const width = Math.min(280, input.viewportWidth - 16);
  const height = 288;
  const left =
    input.dir === 'rtl'
      ? Math.min(input.anchor.right - width, input.viewportWidth - width - 8)
      : Math.max(8, input.anchor.left);
  const below = input.anchor.bottom + 6;
  const top =
    below + height > input.viewportHeight - 8 && input.anchor.top > height + 8
      ? input.anchor.top - height - 6
      : below;
  return { left: Math.max(8, left), top: Math.max(8, top), width };
}
