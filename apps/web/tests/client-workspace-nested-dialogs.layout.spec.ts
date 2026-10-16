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

type Box = { w: number; h: number; x: number; y: number; font?: string; backgroundImage?: string; overflowX?: string };

type DocsDump = {
  panel: Box | null;
  close: Box | null;
  workspace: (Box & { font?: string }) | null;
  folderNameFont: string;
  folderCountFont: string;
  folderDateFont: string;
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

function assertPhysicalTopRight(label: string, host: Box, close: Box) {
  const rightGap = host.x + host.w - (close.x + close.w);
  const topGap = close.y - host.y;
  assert.ok(rightGap >= -2 && rightGap <= 24, `${label} close right gap ${rightGap}`);
  assert.ok(topGap >= -2 && topGap <= 28, `${label} close top gap ${topGap}`);
}

test('Documents folder overlay matches Taxes glass and uses a top-right X', async (t) => {
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
    assertArial(`${label} folder date`, dump.folderDateFont);
    assert.equal(dump.footerClose, false, `${label} overlay still has footer סגירה`);
    assert.match(dump.addLabel, /מסמך/);
    assertPhysicalTopRight(`${label} documents overlay`, dump.panel!, dump.close!);
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
    assertPhysicalTopRight(`${label} fees editor`, ed.modal!, ed.close!);
    if (ed.tableWrap) {
      assert.ok(
        ed.tableWrap.overflowX === 'auto' || ed.tableWrap.scrollWidth <= ed.tableWrap.clientWidth + 2,
        `${label} fees table clipped without internal scroll (${ed.tableWrap.overflowX}, ${ed.tableWrap.scrollWidth}/${ed.tableWrap.clientWidth})`,
      );
    }
    assert.ok(ed.close!.y > ed.workspaceClose!.y - 80, `${label} nested X should not sit on the primary Close`);
  }
});
