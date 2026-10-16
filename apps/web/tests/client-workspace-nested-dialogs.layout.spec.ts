/**
 * Rendered nested dialogs — Documents folder overlay + Fees editor glass.
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

const DOCS_HARNESS =
  process.env.DOCS_HARNESS_URL ??
  'http://localhost:3027/tests/client-workspace-documents-tab-harness.html';
const FEES_HARNESS =
  process.env.LAYOUT_HARNESS_URL ??
  'http://localhost:3027/tests/client-workspace-accounting-tab-harness.html?dump=fees-editor';
const PROFILE_HARNESS =
  'http://localhost:3027/tests/client-workspace-accounting-tab-harness.html?dump=profile-editor';
const TAXES_HARNESS =
  'http://localhost:3027/tests/client-workspace-taxes-tab-harness.html?dump=vat-editor';
const EXPENSE_HARNESS =
  'http://localhost:3027/tests/client-workspace-accounting-tab-harness.html?dump=expense-editor';

type Box = { w: number; h: number; x: number; y: number; font?: string; backgroundImage?: string; overflowX?: string };

type DocsDump = {
  panel: Box | null;
  close: Box | null;
  workspace: (Box & { font?: string }) | null;
  folderNameFont: string;
  folderCountFont: string;
  folderDateVisible?: boolean;
  folderCardHasDate?: boolean;
  addLabel: string;
  footerClose: boolean;
};

type FeesDump = {
  feesEditor?: {
    modal: Box | null;
    close: Box | null;
    tableWrap: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
    footerBtns: string[];
    workspace: (Box & { font?: string }) | null;
    workspaceClose: Box | null;
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
        '--virtual-time-budget=40000',
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

function parseDump<T>(html: string, label: string): T {
  const m = html.match(/id="nx-layout-dump"[^>]*>([^<]*)/);
  assert.ok(m, `${label} expected #nx-layout-dump`);
  const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
  assert.ok(raw.length > 2, `${label} expected populated dump, got ${raw.slice(0, 80)}`);
  return JSON.parse(raw) as T;
}

function assertArial(label: string, font: string | undefined) {
  assert.match(String(font || ''), /arial/i, `${label} expected Arial, got ${font}`);
}

function assertPhysicalTopLeft(label: string, host: Box, close: Box) {
  const leftGap = close.x - host.x;
  const topGap = close.y - host.y;
  const rightGap = host.x + host.w - (close.x + close.w);
  assert.ok(leftGap >= -2 && leftGap <= 24, `${label} close left gap ${leftGap}`);
  assert.ok(topGap >= -2 && topGap <= 28, `${label} close top gap ${topGap}`);
  assert.ok(rightGap > 24, `${label} close is not on the physical right (right gap ${rightGap})`);
  assert.ok(close.x + close.w <= host.x + host.w + 2, `${label} X overflows host horizontally`);
  assert.ok(close.y + close.h <= host.y + host.h + 2, `${label} X overflows host vertically`);
}

test('Documents folder overlay matches Taxes glass and uses a top-left X', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }
  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const dump = parseDump<DocsDump>(await runChromeDump(DOCS_HARNESS, vp.width, vp.height), label);
    assert.ok(dump.panel, `${label} folder panel`);
    assert.ok(dump.close, `${label} folder close`);
    assert.ok(dump.workspace, `${label} workspace modal`);
    assert.match(dump.panel!.backgroundImage || '', /linear-gradient/i);
    assertArial(`${label} panel`, dump.panel!.font);
    assertArial(`${label} workspace`, dump.workspace!.font);
    assertArial(`${label} folder name`, dump.folderNameFont);
    assertArial(`${label} folder count`, dump.folderCountFont);
    assert.equal(dump.folderDateVisible, false, `${label} folder cards still show a date`);
    assert.equal(dump.folderCardHasDate, false, `${label} folder card text still contains a date`);
    assert.equal(dump.footerClose, false, `${label} overlay still has footer סגירה`);
    assert.match(dump.addLabel, /מסמך/);
    assertPhysicalTopLeft(`${label} documents overlay`, dump.panel!, dump.close!);
    assert.ok(dump.panel!.w <= dump.workspace!.w + 2, `${label} overlay wider than workspace`);
  }
});

test('Fees editor uses nested glass, Arial, X, and keeps שמירה', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }
  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const dump = parseDump<FeesDump>(await runChromeDump(FEES_HARNESS, vp.width, vp.height), label);
    const ed = dump.feesEditor;
    assert.ok(ed?.modal, `${label} fees editor`);
    assert.ok(ed.close, `${label} fees editor close`);
    assert.ok(ed.workspaceClose, `${label} primary workspace Close`);
    assert.match(ed.modal!.backgroundImage || '', /linear-gradient/i);
    assertArial(`${label} fees modal`, ed.modal!.font);
    assertArial(`${label} workspace`, ed.workspace?.font);
    assert.ok(ed.footerBtns.some((b) => b.includes('שמירה')), `${label} missing שמירה: ${ed.footerBtns.join(',')}`);
    assert.ok(!ed.footerBtns.includes('סגירה'), `${label} redundant סגירה still in footer: ${ed.footerBtns.join(',')}`);
    assertPhysicalTopLeft(`${label} fees editor`, ed.modal!, ed.close!);
    if (ed.tableWrap) {
      assert.ok(
        ed.tableWrap.overflowX === 'auto' || ed.tableWrap.scrollWidth <= ed.tableWrap.clientWidth + 2,
        `${label} fees table clipped without internal scroll (${ed.tableWrap.overflowX}, ${ed.tableWrap.scrollWidth}/${ed.tableWrap.clientWidth})`,
      );
    }
    assert.ok(ed.close!.y > ed.workspaceClose!.y - 80, `${label} nested X should not sit on the primary Close`);
  }
});

type ProfileDump = {
  profileEditor?: {
    hiddenOpenDate: boolean;
    hiddenCloseDate: boolean;
    hiddenPeakMonths: boolean;
    labels: string[];
    header: Box | null;
    close: Box | null;
    workspaceClose: Box | null;
    bodyScrollWidth: number;
    bodyClientWidth: number;
    modal: Box | null;
  };
};

test('Business Profile nested editor hides open/close/peak fields and uses a top-left X', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }
  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const dump = parseDump<ProfileDump>(await runChromeDump(PROFILE_HARNESS, vp.width, vp.height), label);
    const ed = dump.profileEditor;
    assert.ok(ed?.modal, `${label} profile editor`);
    assert.ok(ed.close, `${label} profile editor close`);
    assert.equal(ed.hiddenOpenDate, true, `${label} still shows פתיחת עסק`);
    assert.equal(ed.hiddenCloseDate, true, `${label} still shows סגירת עסק`);
    assert.equal(ed.hiddenPeakMonths, true, `${label} still shows חודשי עומס`);
    assert.ok((ed.header?.h ?? 0) >= 52 && (ed.header?.h ?? 0) <= 64, `${label} header height ${ed.header?.h}`);
    assertPhysicalTopLeft(`${label} profile editor`, ed.modal!, ed.close!);
    assert.ok(ed.bodyScrollWidth <= ed.bodyClientWidth + 8, `${label} profile editor horizontal overflow`);
  }
});

type TaxesEditorDump = {
  helperColor: string;
  labelColor: string;
  header: Box | null;
  close: Box | null;
  modal: Box | null;
  workspaceClose: Box | null;
};

test('Taxes nested editor helper text is pale blue and X sits top-left inside the header', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }
  const vp = VIEWPORTS[0];
  const dump = parseDump<TaxesEditorDump>(
    await runChromeDump(TAXES_HARNESS, vp.width, vp.height),
    `${vp.width}x${vp.height}`,
  );
  assert.ok(dump.modal, 'vat editor');
  assert.ok(dump.close, 'vat editor close');
  assertPhysicalTopLeft('vat editor', dump.modal!, dump.close!);
  const labelRgb = (dump.labelColor.match(/\d+/g) || []).map(Number);
  assert.ok(labelRgb[0] >= 180 && labelRgb[2] >= 180, `label not light: ${dump.labelColor}`);
  if (dump.helperColor) {
    const helperRgb = (dump.helperColor.match(/\d+/g) || []).map(Number);
    assert.ok(helperRgb[2] >= 180, `helper not pale blue: ${dump.helperColor}`);
  }
});

type ExpenseDump = {
  expenseEditor?: {
    title: string;
    colCount: number;
    labels: string[];
    footerBtns: string[];
    background: string;
    labelColor: string;
    inputColor: string;
    font: string;
    scrollWidth: number;
    clientWidth: number;
    header: Box | null;
    close: Box | null;
    workspaceClose: Box | null;
    modal: Box | null;
    whitePanel: boolean;
    labelRgb: number[];
    inputRgb: number[];
  };
};

test('Expense Management inner two-column editor is navy glass with a top-left X', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }
  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const dump = parseDump<ExpenseDump>(await runChromeDump(EXPENSE_HARNESS, vp.width, vp.height), label);
    const ed = dump.expenseEditor;
    assert.ok(ed?.modal, `${label} expense editor`);
    assert.ok(ed.close, `${label} expense editor close`);
    assert.match(ed.title, /ניהול הוצאות|הוצאות/);
    assert.equal(ed.colCount, 2, `${label} expected two columns`);
    assert.ok(ed.labels.includes('שם תוכנת הוצאות'), `${label} missing software name`);
    assert.ok(ed.labels.includes('הערות על ניהול הוצאות'), `${label} missing notes`);
    assert.equal(ed.whitePanel, false, `${label} white inner panel: ${ed.background}`);
    assert.match(ed.background, /linear-gradient/i);
    assert.match(String(ed.font), /arial/i);
    assert.ok((ed.labelRgb[0] ?? 0) >= 180 && (ed.labelRgb[2] ?? 0) >= 180, `${label} label not light: ${ed.labelColor}`);
    assert.ok((ed.inputRgb[0] ?? 99) < 80, `${label} input not dark: ${ed.inputColor}`);
    assert.ok(ed.footerBtns.some((b) => b.includes('שמירה')), `${label} missing שמירה`);
    assert.ok((ed.header?.h ?? 0) >= 52 && (ed.header?.h ?? 0) <= 64, `${label} header height ${ed.header?.h}`);
    assertPhysicalTopLeft(`${label} expense editor`, ed.modal!, ed.close!);
    assert.ok(ed.scrollWidth <= ed.clientWidth + 8, `${label} expense editor horizontal overflow`);
    if (ed.workspaceClose) {
      assert.ok(ed.close!.y > ed.workspaceClose.y - 80, `${label} nested X should not sit on the primary Close`);
    }
  }
});
