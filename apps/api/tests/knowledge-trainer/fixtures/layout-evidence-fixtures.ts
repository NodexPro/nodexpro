/** Synthetic layout fixtures only. Do not commit Marina's real ordinance PDF. */

export type FixtureItem = {
  i: number;
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fn: string;
  fs: number;
  eol: boolean;
  d: string;
};

function item(
  partial: { s: string; x?: number; y?: number; fs?: number; i?: number; eol?: boolean; w?: number },
): FixtureItem {
  return {
    i: partial.i ?? 0,
    s: partial.s,
    x: partial.x ?? 40,
    y: partial.y ?? 700,
    w: partial.w ?? 80,
    h: 12,
    fn: 'Times',
    fs: partial.fs ?? 12,
    eol: partial.eol === true,
    d: 'rtl',
  };
}

export const PAGE_HEIGHT = 841.89;

export const realHeadingItems: FixtureItem[] = [
  item({ s: 'חלק', y: 720, fs: 14, i: 0 }),
  item({ s: "א'", y: 720, fs: 14, i: 1 }),
  item({ s: 'פרשנות', y: 720, fs: 14, i: 2, eol: true }),
  item({ s: '39.', y: 640, fs: 13, i: 3 }),
  item({ s: 'הגדרות', y: 640, fs: 13, i: 4, eol: true }),
];

export const runningCitationItems: FixtureItem[] = [
  item({ s: 'הכנסה חייבת תחושב', y: 520, fs: 11, i: 0 }),
  item({ s: 'לפי סעיף 39', y: 500, fs: 11, i: 1 }),
  item({ s: 'לא יחולו הוראות אלה על הכנסה', y: 500, fs: 11, i: 2 }),
  item({ s: 'בהתאם לסעיף 105י במקרים אלה', y: 470, fs: 11, i: 3 }),
  item({ s: 'סעיפים 38 ו-39 אינם חלים כאן', y: 440, fs: 11, i: 4 }),
];

export const bottomPageFootnoteItems: FixtureItem[] = [
  item({ s: 'הערת שוליים לפי סעיף 105י', y: 40, fs: 8, i: 0 }),
];

export const amendmentHistoryItems: FixtureItem[] = [
  item({ s: "תיקון מס' 256", y: 300, fs: 10, i: 0 }),
  item({ s: "עמ' 514", y: 280, fs: 10, i: 1 }),
];

export const pageHeaderFooterItems: FixtureItem[] = [
  item({ s: 'פקודת מס הכנסה', y: 820, fs: 9, i: 0 }),
  item({ s: 'נוסח חדש', y: 30, fs: 8, i: 1 }),
];
