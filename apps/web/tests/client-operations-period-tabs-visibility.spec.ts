/**
 * Layout regression: the month strip must stay inside the viewport.
 * Source presence is not enough — this paints the real stylesheets and reads geometry.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const styles = join(dir, '../src/styles');
const tokens = join(dir, '../src/templates/template-1');

const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [1200, 640],
  [1280, 600],
] as const;

function chromePath(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((value): value is string => Boolean(value));
  return candidates.find((path) => existsSync(path)) ?? null;
}

function href(path: string): string {
  return pathToFileURL(path).href;
}

function fixtureHtml(): string {
  const months = Array.from({ length: 18 }, (_, index) => {
    const month = String((index % 12) + 1).padStart(2, '0');
    return `<button class="nx-co-sheet__period-tab" type="button">${month}.26</button>`;
  }).join('');
  const head = Array.from({ length: 12 }, (_, index) => `<th style="min-width:180px">c${index}</th>`).join('');
  const cell = Array.from({ length: 12 }, () => '<td>x</td>').join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="${href(join(tokens, 'tokens.css'))}" />
  <link rel="stylesheet" href="${href(join(tokens, 't1-sidebar-account.css'))}" />
  <link rel="stylesheet" href="${href(join(styles, 'nx-client-operations-shell.css'))}" />
  <link rel="stylesheet" href="${href(join(styles, 'nx-client-operations-spreadsheet.css'))}" />
</head>
<body>
  <div class="t1-appShell t1-appShell--client-operations" style="display:flex">
    <aside class="t1-sidebar" style="width:72px"><nav class="t1-sidebar__nav"></nav></aside>
    <div class="t1-shellColumn" style="flex:1; display:flex; flex-direction:column; min-width:0">
      <header class="nx-co-app-header">
        <div class="nx-co-app-header__title-wrap"><h1 class="nx-co-app-header__title">פעולות לקוח</h1></div>
        <div class="nx-co-app-header__search-slot">
          <div class="nx-co-registry__kpis">
            <div class="nx-co-sheet__reporting-kpis">
              ${Array.from({ length: 7 }, (_, i) => `<div class="nx-co-sheet__reporting-kpi"><span class="nx-co-sheet__reporting-kpi-label">kpi</span><span class="nx-co-sheet__reporting-kpi-frac">${i}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </header>
      <main class="t1-pageMain">
          <div style="max-width:100%; margin:0 auto; width:100%; min-width:0; box-sizing:border-box">
          <div class="nx-co-route">
          <div class="nx-co-registry">
            <div class="nx-co-sheet">
              <div class="nx-co-sheet__toolbar"><span>toolbar</span></div>
              <div class="nx-co-sheet__filter-bar"><div class="nx-co-sheet__filter-bar-scroll"><span>filters</span></div></div>
              <div class="nx-co-sheet__workspace">
                <div class="nx-co-sheet__canvas" data-testid="client-operations-grid-surface">
                  <table class="nx-co-sheet__table is-frozen">
                    <thead><tr><th data-col="folder">folder</th><th data-col="client_name">client</th>${head}</tr></thead>
                    <tbody>${Array.from({ length: 80 }, (_, i) => `<tr><td>f</td><td>client ${i}</td>${cell}</tr>`).join('')}</tbody>
                  </table>
                </div>
              </div>
              <div class="nx-co-sheet__period-tabs" data-testid="client-operations-period-tabs">
                <div class="nx-co-sheet__period-tabs-scroll" role="tablist">${months}</div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</body>
</html>`;
}

const MEASURE = `(() => {
  const tabs = document.querySelector('[data-testid="client-operations-period-tabs"]');
  const canvas = document.querySelector('.nx-co-sheet__canvas');
  const scroll = document.querySelector('.nx-co-sheet__period-tabs-scroll');
  const buttons = [...document.querySelectorAll('.nx-co-sheet__period-tab')];
  const tr = tabs.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  let clipped = false;
  for (let node = tabs.parentElement; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'hidden' || oy === 'auto' || oy === 'scroll' || oy === 'clip') {
      const pr = node.getBoundingClientRect();
      if (tr.top < pr.top - 1 || tr.bottom > pr.bottom + 1) clipped = true;
    }
  }
  return {
    w: innerWidth,
    h: innerHeight,
    docH: document.documentElement.scrollHeight,
    docW: document.documentElement.scrollWidth,
    margin: getComputedStyle(document.body).marginTop,
    tabsTop: tr.top,
    tabsBottom: tr.bottom,
    tabsH: tr.height,
    canvasBottom: cr.bottom,
    canvasClientH: canvas.clientHeight,
    canvasScrollH: canvas.scrollHeight,
    canvasClientW: canvas.clientWidth,
    canvasScrollW: canvas.scrollWidth,
    tabsInsideCanvas: canvas.contains(tabs),
    clipped,
    tabWidths: buttons.map((button) => button.getBoundingClientRect().width),
    tabScrollW: scroll.scrollWidth,
    tabClientW: scroll.clientWidth,
  };
})()`;

test('month strip stays visible while the grid scrolls', { timeout: 60_000 }, async () => {
  const browser = chromePath();
  assert.ok(browser, 'Chrome or Edge is required to measure month-tab visibility');
  const root = mkdtempSync(join(tmpdir(), 'nx-co-tabs-'));
  const htmlPath = join(root, 'fixture.html');
  writeFileSync(htmlPath, fixtureHtml());
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const chosen = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(chosen));
    });
  });
  const proc = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(root, 'profile')}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  let nextId = 1;
  try {
    let version: { webSocketDebuggerUrl: string } | null = null;
    for (let attempt = 0; attempt < 40 && !version; attempt += 1) {
      try {
        version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      } catch {
        await delay(150);
      }
    }
    assert.ok(version, 'browser debug port did not open');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('browser socket failed')));
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      const id = nextId;
      nextId += 1;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 15_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    };
    const created = await send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true }) as { sessionId: string };
    const sessionId = attached.sessionId;
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
    await delay(500);
    for (const [width, height] of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      await delay(120);
      const evaluated = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, sessionId) as {
        result: { value: {
          h: number;
          docH: number;
          margin: string;
          tabsTop: number;
          tabsBottom: number;
          tabsH: number;
          canvasBottom: number;
          canvasClientH: number;
          canvasScrollH: number;
          canvasClientW: number;
          canvasScrollW: number;
          tabsInsideCanvas: boolean;
          clipped: boolean;
          tabWidths: number[];
        } };
      };
      const box = evaluated.result.value;
      assert.equal(box.margin, '0px', `${width}x${height} document margin`);
      assert.ok(box.docH <= box.h + 1, `${width}x${height} document scrolls (${box.docH} > ${box.h})`);
      assert.ok(box.tabsH >= 32, `${width}x${height} month strip collapsed to ${box.tabsH}`);
      assert.ok(box.tabsTop >= -1, `${width}x${height} month strip above the viewport`);
      assert.ok(box.tabsBottom <= box.h + 1, `${width}x${height} month strip below the viewport (${box.tabsBottom} > ${box.h})`);
      assert.equal(box.clipped, false, `${width}x${height} an overflow ancestor clips the month strip`);
      assert.equal(box.tabsInsideCanvas, false, `${width}x${height} month strip is inside the scrolling grid`);
      assert.ok(box.canvasBottom <= box.tabsTop + 1, `${width}x${height} grid extends over the month strip`);
      assert.ok(box.canvasScrollH > box.canvasClientH + 1, `${width}x${height} grid does not scroll vertically`);
      assert.ok(box.canvasScrollW > box.canvasClientW + 1, `${width}x${height} grid does not scroll horizontally`);
      assert.ok(box.tabWidths.every((item) => item >= 56), `${width}x${height} a month tab was squeezed`);
    }
    ws.close();
  } finally {
    proc.kill();
  }
});
