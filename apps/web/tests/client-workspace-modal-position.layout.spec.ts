/**
 * Real ClientWorkspaceModal coordinates — not CSS-token presence.
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
  'http://localhost:3027/tests/client-workspace-modal-position-harness.html';

function runChromeDump(url: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=8000',
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

function parseDump(html: string): {
  innerWidth: number;
  innerHeight: number;
  selectorMatches: boolean;
  portaledToBody: boolean;
  overlayParentClass: string;
  overlay: {
    top: number;
    left: number;
    width: number;
    height: number;
    overflow: string;
    overflowY: string;
    overflowYScroll: boolean;
    zIndex: string;
    position: string;
  };
  modal: { top: number; bottom: number; height: number; transform: string };
  header: { top: number; height: number } | null;
  content: { overflowYScroll: boolean; scrollHeight: number; clientHeight: number } | null;
  stacking: {
    overlayCoversViewport: boolean;
    headerCenter: { inOverlay: boolean; inHeader: boolean } | null;
    sidebarMid: { inOverlay: boolean; inSidebar: boolean } | null;
  };
  math: {
    viewportTopToModalTop: number;
    modalBottomToViewportBottom: number;
    geometricCenterTop: number;
    raiseVsGeometricCenter: number;
  };
} {
  const m = html.match(/id="nx-layout-dump"[^>]*>([^<]*)/);
  assert.ok(m, 'expected #nx-layout-dump from the real ClientWorkspaceModal harness');
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

test('Client Details modal sits ~60px above center with 16px clearance at listed viewports', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const html = await runChromeDump(HARNESS, vp.width, vp.height);
    const dump = parseDump(html);
    assert.equal(dump.selectorMatches, true);
    assert.ok(dump.modal.height > 400, `modal height ${dump.modal.height}`);
    assert.ok(dump.math.viewportTopToModalTop >= 16 - 1, `top clearance ${dump.math.viewportTopToModalTop}`);
    assert.ok(
      dump.math.modalBottomToViewportBottom >= 16 - 1,
      `bottom clearance ${dump.math.modalBottomToViewportBottom}`,
    );
    const roomForFullRaise = dump.math.geometricCenterTop >= 16 + 60;
    if (roomForFullRaise) {
      assert.ok(
        Math.abs(dump.math.raiseVsGeometricCenter - 60) < 2,
        `${vp.width}x${vp.height} raise=${dump.math.raiseVsGeometricCenter}`,
      );
    } else {
      assert.ok(
        dump.math.raiseVsGeometricCenter >= -1,
        `${vp.width}x${vp.height} should not sit below center`,
      );
    }
  }
});

test('Client Details overlay portals above header/sidebar without clipping or a spare scrollbar', async (t) => {
  if (!existsSync(CHROME)) {
    t.skip('Google Chrome is required for coordinate measurements');
    return;
  }

  for (const vp of VIEWPORTS) {
    const html = await runChromeDump(HARNESS, vp.width, vp.height);
    const dump = parseDump(html);
    const label = `${vp.width}x${vp.height}`;
    assert.equal(dump.portaledToBody, true, `${label} overlay parent is document.body`);
    assert.notEqual(dump.overlayParentClass, 'nx-co-sheet', `${label} must not stay inside the sheet`);
    assert.equal(dump.overlay.position, 'fixed');
    assert.equal(dump.stacking.overlayCoversViewport, true, `${label} overlay covers the viewport`);
    assert.ok(dump.header, `${label} header present`);
    assert.ok(
      dump.header!.top >= dump.overlay.top - 1 && dump.header!.top + dump.header!.height <= dump.overlay.top + dump.overlay.height + 1,
      `${label} overlay covers the header band`,
    );
    assert.equal(dump.stacking.headerCenter?.inHeader, false, `${label} header must not paint over the overlay`);
    assert.equal(dump.stacking.headerCenter?.inOverlay, true, `${label} header hit-test is the overlay`);
    assert.equal(dump.stacking.sidebarMid?.inSidebar, false, `${label} sidebar must not paint over the overlay`);
    assert.equal(dump.stacking.sidebarMid?.inOverlay, true, `${label} sidebar hit-test is the overlay`);
    assert.equal(dump.overlay.overflowYScroll, false, `${label} overlay must not scroll`);
    assert.ok(dump.content, `${label} content pane`);
    assert.equal(
      dump.content!.overflowYScroll,
      false,
      `${label} client-details fields must not need an internal scrollbar (scroll=${dump.content!.scrollHeight} client=${dump.content!.clientHeight})`,
    );
    assert.ok(dump.modal.top >= 16 - 1, `${label} modal top not clipped`);
    assert.ok(dump.modal.bottom <= dump.innerHeight - 16 + 1, `${label} modal bottom not clipped`);
  }
});
