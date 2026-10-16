/**
 * Real rendered Accounting / Client Details / Annual layout — not CSS-token presence.
 * Mounts ClientWorkspaceModal via the Vite harness and reads getBoundingClientRect.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VIEWPORTS = [
  { width: 1648, height: 928 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 700 },
] as const;

const HARNESS =
  process.env.LAYOUT_HARNESS_URL ??
  'http://localhost:3027/tests/client-workspace-accounting-tab-harness.html';

type Kid = { text: string; w: number; h: number };
type SplitRow = { w: number; display: string; cols: string; kids: Kid[] };
type Box = { w: number; h: number; x: number; y: number };
type NotesDump = {
  wrap: Box | null;
  table: Box | null;
  input: Box | null;
  overflowLeft: number;
  overflowRight: number;
  content: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
};
type GlassDump = {
  root: Box | null;
  content: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
  cardBg?: string;
  heroBg?: string;
};

type Dump = {
  accounting: {
    viewport: { w: number; h: number };
    content: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
    split: SplitRow[];
    emptyFleet: {
      w: number;
      h: number;
      x?: number;
      y?: number;
      text: string;
      wrap: string;
      wordBreak: string;
      whiteSpace: string;
    } | null;
    vehiclesCard: Box | { w: number; h: number } | null;
    grid?: (Box & { cols: string; areas: string; direction: string }) | null;
    cards?: Record<string, Box | null>;
  };
  details: {
    root: { w: number; h: number; backgroundImage: string; backgroundColor: string } | null;
  };
  annual: {
    root: { w: number; h: number; backgroundImage: string } | null;
    dashCardBg: string | null;
    notes?: NotesDump | null;
  };
  equity: {
    root: { w: number; h: number; backgroundImage: string } | null;
    notes?: NotesDump | null;
  };
  fees?: GlassDump;
  payroll?: GlassDump;
  history?: GlassDump;
};

function runChromeDump(url: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=28000',
        '--dump-dom',
        url,
      ],
      { windowsHide: true },
    );
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !out.includes('nx-layout-dump')) {
        reject(new Error(`chrome dump failed (${code}): ${err.slice(0, 500)}`));
        return;
      }
      resolve(out);
    });
  });
}

function parseDump(html: string): Dump {
  const m = html.match(/id="nx-layout-dump"[^>]*>([^<]*)/);
  assert.ok(m, 'expected #nx-layout-dump from the Accounting Settings harness');
  const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
  assert.ok(raw.length > 2, `expected populated layout dump, got ${raw.slice(0, 80)}`);
  return JSON.parse(raw);
}

function assertNotesInside(label: string, notes: NotesDump | null | undefined, tab: string) {
  assert.ok(notes, `${label} ${tab} expected הערת שורה dump`);
  assert.ok(notes.input, `${label} ${tab} expected note input`);
  assert.ok(notes.wrap, `${label} ${tab} expected documents table wrap`);
  assert.ok(notes.overflowLeft <= 2, `${label} ${tab} note overflows left by ${notes.overflowLeft}px`);
  assert.ok(notes.overflowRight <= 2, `${label} ${tab} note overflows right by ${notes.overflowRight}px`);
  assert.ok(notes.input!.w >= 72, `${label} ${tab} note input too narrow: ${notes.input!.w}px`);
  if (notes.content) {
    assert.ok(
      notes.content.scrollWidth <= notes.content.clientWidth + 2,
      `${label} ${tab} horizontal overflow ${notes.content.scrollWidth}>${notes.content.clientWidth}`,
    );
  }
}

function assertGlass(label: string, dump: GlassDump | undefined, bg: string | undefined, name: string) {
  assert.ok(dump, `${label} expected ${name} dump`);
  assert.ok(bg, `${label} ${name} glass background missing`);
  assert.match(bg!, /linear-gradient/i, `${label} ${name} is not glass`);
  assert.doesNotMatch(bg!, /#f9fafb|#ffffff/i, `${label} ${name} still uses the light shell`);
  if (dump.content) {
    assert.ok(
      dump.content.scrollWidth <= dump.content.clientWidth + 2,
      `${label} ${name} horizontal overflow ${dump.content.scrollWidth}>${dump.content.clientWidth}`,
    );
  }
}

test('Accounting split rows use readable value widths instead of collapsed subgrid tracks', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const html = await runChromeDump(HARNESS, vp.width, vp.height);
    const dump = parseDump(html);
    const label = `${vp.width}x${vp.height}`;
    assert.ok(dump.accounting.split.length > 0, `${label} expected split rows`);
    for (const row of dump.accounting.split) {
      assert.notEqual(row.display, 'subgrid', `${label} row must not be subgrid`);
      assert.doesNotMatch(row.cols, /subgrid/);
      const value = row.kids[1];
      assert.ok(value, `${label} split row needs a value cell`);
      assert.ok(
        value.w >= 120,
        `${label} icy value too narrow: ${value.w}px text="${value.text}" cols=${row.cols}`,
      );
      assert.ok(value.h < 70, `${label} value height ${value.h} looks vertically compressed`);
    }
    assert.ok(dump.accounting.content, `${label} content pane`);
    assert.ok(
      dump.accounting.content!.scrollWidth <= dump.accounting.content!.clientWidth + 2,
      `${label} horizontal overflow ${dump.accounting.content!.scrollWidth}>${dump.accounting.content!.clientWidth}`,
    );
  }
});

test('רכבים empty-state text is full-width and not a vertical character column', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const html = await runChromeDump(HARNESS, vp.width, vp.height);
    const dump = parseDump(html);
    const label = `${vp.width}x${vp.height}`;
    const empty = dump.accounting.emptyFleet;
    assert.ok(empty, `${label} expected רכבים empty-state`);
    assert.match(empty.text, /אין רכבים/);
    assert.ok(empty.w >= 240, `${label} empty-state width ${empty.w} still compressed`);
    assert.ok(empty.h <= 64, `${label} empty-state height ${empty.h} wraps vertically`);
    assert.notEqual(empty.wrap, 'anywhere');
    assert.notEqual(empty.wordBreak, 'break-all');
    if (dump.accounting.vehiclesCard) {
      assert.ok(
        empty.w >= dump.accounting.vehiclesCard.w * 0.55,
        `${label} empty-state ${empty.w} vs card ${dump.accounting.vehiclesCard.w}`,
      );
    }
    const cards = dump.accounting.cards;
    const grid = dump.accounting.grid;
    assert.ok(cards?.income && cards.expense_management && cards.expenses && cards.vehicles, `${label} expected all four cards`);
    assert.ok(grid, `${label} expected cards grid`);
    assert.ok(
      cards.income!.x > cards.expense_management!.x,
      `${label} הכנסות x=${cards.income!.x} should be right of הוצאות x=${cards.expense_management!.x}`,
    );
    assert.ok(
      Math.abs(cards.income!.x - cards.expenses!.x) <= 24,
      `${label} הוצאות קבועות x=${cards.expenses!.x} should sit under הכנסות x=${cards.income!.x}`,
    );
    assert.ok(
      cards.vehicles!.w >= grid!.w * 0.92,
      `${label} רכבים width ${cards.vehicles!.w} vs grid ${grid!.w}`,
    );
    assert.ok(
      cards.vehicles!.y >= cards.expenses!.y,
      `${label} רכבים y=${cards.vehicles!.y} should be below הוצאות קבועות y=${cards.expenses!.y}`,
    );
  }
});

test('Client Details, Annual Return and Capital Declaration share the Taxes glass background', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const annualDump = parseDump(await runChromeDump(`${HARNESS}?dump=annual`, vp.width, vp.height));
    const equityDump = parseDump(await runChromeDump(`${HARNESS}?dump=equity`, vp.width, vp.height));
    const feesDump = parseDump(await runChromeDump(`${HARNESS}?dump=fees`, vp.width, vp.height));
    const payrollDump = parseDump(await runChromeDump(`${HARNESS}?dump=payroll`, vp.width, vp.height));
    const historyDump = parseDump(await runChromeDump(`${HARNESS}?dump=history`, vp.width, vp.height));
    assert.ok(annualDump.details.root, `${label} Client Details panel`);
    assert.doesNotMatch(
      annualDump.details.root!.backgroundImage,
      /rgb\(\s*101,\s*154,\s*216\s*\)|#659ad8/i,
      `${label} Client Details still uses the bright blue panel`,
    );
    assert.match(annualDump.details.root!.backgroundImage, /linear-gradient/i);
    assert.ok(annualDump.annual.root, `${label} Annual root`);
    assert.doesNotMatch(annualDump.annual.root!.backgroundImage, /rgb\(\s*249,\s*250,\s*251\s*\)|#f9fafb/i);
    assert.ok(annualDump.annual.dashCardBg, `${label} Annual dash card`);
    assert.doesNotMatch(annualDump.annual.dashCardBg!, /rgb\(\s*255,\s*255,\s*255\s*\)/);
    assert.ok(equityDump.equity.root, `${label} Capital Declaration root`);
    assert.doesNotMatch(equityDump.equity.root!.backgroundImage, /rgb\(\s*249,\s*250,\s*251\s*\)|#f9fafb/i);
    assertNotesInside(label, annualDump.annual.notes, 'דוח שנתי');
    assertNotesInside(label, equityDump.equity.notes, 'הצהרת הון');
    assertGlass(label, feesDump.fees, feesDump.fees?.cardBg, 'שכ״ט');
    assertGlass(label, payrollDump.payroll, payrollDump.payroll?.cardBg, 'שכר');
    assertGlass(label, historyDump.history, historyDump.history?.heroBg, 'היסטוריה');
  }
});
