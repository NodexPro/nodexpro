/**
 * P0 — Chromium/PDF engine resolution + install contract (no live browser required).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pdfEngineCapabilityFromResolution,
  resolvePdfBrowserExecutable,
} from '../../src/domains/income/income-document-pdf-browser.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.renderer.ts'),
  'utf8',
);
const browserServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf-browser.service.ts'),
  'utf8',
);
const ensureScriptSource = readFileSync(
  join(dir, '../../scripts/ensure-puppeteer-chrome.mjs'),
  'utf8',
);
const indexSource = readFileSync(join(dir, '../../src/index.ts'), 'utf8');
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const pdfServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
  'utf8',
);
const issuedViewSource = readFileSync(
  join(dir, '../../src/domains/income/income-issued-document-view.service.ts'),
  'utf8',
);
const emailPureSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-delivery.pure.ts'),
  'utf8',
);

test('A: configured PUPPETEER_EXECUTABLE_PATH wins when path exists', () => {
  const resolved = resolvePdfBrowserExecutable({
    envPuppeteerExecutablePath: '/configured/chrome',
    envChromiumPath: '/other/chromium',
    puppeteerExecutablePath: '/puppeteer/cache/chrome',
    systemCandidates: ['/usr/bin/google-chrome'],
    pathExists: (p) => p === '/configured/chrome',
  });
  assert.equal(resolved.source, 'env_puppeteer_executable_path');
  assert.equal(resolved.path, '/configured/chrome');
  assert.equal(resolved.path_exists, true);
  assert.equal(pdfEngineCapabilityFromResolution(resolved), 'ok');
});

test('A2: CHROMIUM_PATH used when PUPPETEER_EXECUTABLE_PATH missing', () => {
  const resolved = resolvePdfBrowserExecutable({
    envPuppeteerExecutablePath: null,
    envChromiumPath: '/env/chromium',
    puppeteerExecutablePath: '/puppeteer/cache/chrome',
    systemCandidates: [],
    pathExists: (p) => p === '/env/chromium',
  });
  assert.equal(resolved.source, 'env_chromium_path');
  assert.equal(resolved.path, '/env/chromium');
  assert.equal(resolved.path_exists, true);
});

test('B: missing executable produces unavailable capability and clear engine error in renderer', () => {
  const resolved = resolvePdfBrowserExecutable({
    envPuppeteerExecutablePath: '/missing/chrome',
    envChromiumPath: null,
    puppeteerExecutablePath: null,
    systemCandidates: [],
    pathExists: () => false,
  });
  assert.equal(resolved.path_exists, false);
  assert.equal(pdfEngineCapabilityFromResolution(resolved), 'unavailable');
  assert.match(rendererSource, /Unified PDF render unavailable/);
  assert.match(rendererSource, /source=\$\{resolution\.source\}/);
});

test('C: Puppeteer launch receives executablePath when resolved', () => {
  assert.match(rendererSource, /puppeteer\.launch\(\{/);
  assert.match(rendererSource, /executablePath,/);
  assert.match(rendererSource, /renderWithPuppeteer\(fullHtml, executablePath\)/);
  assert.match(rendererSource, /resolvePdfBrowserForLaunch/);
});

test('D: Issue does not await synchronous PDF render', () => {
  assert.match(issueSource, /scheduleIncomeDocumentPdfRender/);
  assert.doesNotMatch(issueSource, /await\s+renderIncomeDocumentPdf\s*\(/);
  assert.doesNotMatch(issueSource, /await\s+renderIncomeDocumentPdfBufferFromHtml\s*\(/);
});

test('E: issued HTML viewer does not import Chromium/PDF renderer', () => {
  assert.doesNotMatch(issuedViewSource, /income-document-pdf\.renderer/);
  assert.doesNotMatch(issuedViewSource, /puppeteer/);
  assert.doesNotMatch(issuedViewSource, /CHROMIUM_PATH/);
});

test('F: Email stays PDF-gated on rendered status', () => {
  assert.match(emailPureSource, /assertIncomeDocumentReadyForEmailSend/);
  assert.match(emailPureSource, /pdf_render_status !== 'rendered'/);
  assert.match(emailPureSource, /Document PDF is not ready for email delivery/);
  assert.match(emailPureSource, /pdf_asset_id/);
});

test('G: retry / schedule can transition failed → pending → render path', () => {
  assert.match(pdfServiceSource, /pdf_render_status !== 'pending'/);
  assert.match(pdfServiceSource, /pdf_render_status: 'pending'/);
  assert.match(pdfServiceSource, /void renderIncomeDocumentPdf/);
  assert.match(pdfServiceSource, /pdf_render_status: 'rendered'/);
  assert.match(pdfServiceSource, /pdf_render_status: 'failed'/);
});

test('install script hard-fails when browser required', () => {
  assert.match(ensureScriptSource, /RENDER === 'true'/);
  assert.match(ensureScriptSource, /NODEXPRO_REQUIRE_PDF_BROWSER/);
  assert.match(ensureScriptSource, /process\.exit\(1\)/);
  assert.match(ensureScriptSource, /PUPPETEER_CACHE_DIR/);
  assert.match(ensureScriptSource, /\.cache.*puppeteer/);
});

test('startup / health observe pdf engine without launching Chrome on health', () => {
  assert.match(indexSource, /logPdfEngineStartupProbe/);
  assert.match(indexSource, /pdf_engine: pdfCapability\.pdf_engine/);
  assert.match(indexSource, /never launches Chrome/);
  assert.match(browserServiceSource, /pdf_engine_available/);
  assert.match(browserServiceSource, /browser_source/);
  assert.match(browserServiceSource, /browser_path_exists/);
  assert.doesNotMatch(browserServiceSource, /\.launch\(/);
});

test('puppeteer.executablePath preferred over system when env unset', () => {
  const resolved = resolvePdfBrowserExecutable({
    envPuppeteerExecutablePath: null,
    envChromiumPath: null,
    puppeteerExecutablePath: '/cache/chrome-for-testing',
    systemCandidates: ['/usr/bin/google-chrome'],
    pathExists: (p) => p === '/cache/chrome-for-testing',
  });
  assert.equal(resolved.source, 'puppeteer_executable_path');
  assert.equal(resolved.path, '/cache/chrome-for-testing');
});
