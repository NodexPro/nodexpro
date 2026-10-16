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

type Dump = {
  accounting: {
    viewport: { w: number; h: number };
    content: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
    split: SplitRow[];
    emptyFleet: {
      w: number;
      h: number;
      text: string;
      wrap: string;
      wordBreak: string;
      whiteSpace: string;
    } | null;
    vehiclesCard: { w: number; h: number } | null;
  };
  details: {
    root: { w: number; h: number; backgroundImage: string; backgroundColor: string } | null;
  };
  annual: {
    root: { w: number; h: number; backgroundImage: string } | null;
    dashCardBg: string | null;
  };
  equity: {
    root: { w: number; h: number; backgroundImage: string } | null;
  };
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
        '--virtual-time-budget=20000',
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
  }
});

test('Client Details, Annual Return and Capital Declaration share the Taxes glass background', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const html = await runChromeDump(HARNESS, vp.width, vp.height);
    const dump = parseDump(html);
    const label = `${vp.width}x${vp.height}`;
    assert.ok(dump.details.root, `${label} Client Details panel`);
    assert.doesNotMatch(
      dump.details.root!.backgroundImage,
      /rgb\(\s*101,\s*154,\s*216\s*\)|#659ad8/i,
      `${label} Client Details still uses the bright blue panel`,
    );
    assert.match(dump.details.root!.backgroundImage, /linear-gradient/i);
    assert.ok(dump.annual.root, `${label} Annual root`);
    assert.doesNotMatch(dump.annual.root!.backgroundImage, /rgb\(\s*249,\s*250,\s*251\s*\)|#f9fafb/i);
    assert.ok(dump.annual.dashCardBg, `${label} Annual dash card`);
    assert.doesNotMatch(dump.annual.dashCardBg!, /rgb\(\s*255,\s*255,\s*255\s*\)/);
    assert.ok(dump.equity.root, `${label} Capital Declaration root`);
    assert.doesNotMatch(dump.equity.root!.backgroundImage, /rgb\(\s*249,\s*250,\s*251\s*\)|#f9fafb/i);
  }
});
