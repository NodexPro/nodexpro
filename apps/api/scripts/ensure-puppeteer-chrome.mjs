/**
 * Ensure Puppeteer's Chrome binary is present for PDF rendering.
 *
 * Soft-fails for local/dev (network optional).
 * Hard-fails on Render / production (unless NODEXPRO_ALLOW_MISSING_PDF_BROWSER=1)
 * so a broken PDF engine cannot deploy silently.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, '..');
const cacheDir = process.env.PUPPETEER_CACHE_DIR?.trim() || join(apiRoot, '.cache', 'puppeteer');

mkdirSync(cacheDir, { recursive: true });
process.env.PUPPETEER_CACHE_DIR = cacheDir;

const requireBrowser =
  process.env.RENDER === 'true' ||
  process.env.NODEXPRO_REQUIRE_PDF_BROWSER === '1' ||
  (process.env.NODE_ENV === 'production' &&
    process.env.NODEXPRO_ALLOW_MISSING_PDF_BROWSER !== '1');

function failOrWarn(message, details = {}) {
  if (requireBrowser) {
    console.error(`[income-pdf] FATAL: ${message}`, details);
    process.exit(1);
  }
  console.warn(`[income-pdf] ${message}`, details);
  process.exit(0);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['puppeteer', 'browsers', 'install', 'chrome'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: cacheDir,
    },
    cwd: apiRoot,
  },
);

if (result.status !== 0) {
  failOrWarn(
    'puppeteer chrome install failed — set CHROMIUM_PATH or PUPPETEER_EXECUTABLE_PATH, or fix network/cache for browsers install',
    { cacheDir, status: result.status, requireBrowser },
  );
}

let executablePath = null;
try {
  const puppeteer = await import('puppeteer');
  executablePath =
    typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null;
} catch (err) {
  failOrWarn('unable to resolve puppeteer.executablePath() after chrome install', {
    cacheDir,
    message: err instanceof Error ? err.message : String(err),
    requireBrowser,
  });
}

if (!executablePath || !existsSync(executablePath)) {
  failOrWarn('chrome binary missing after puppeteer browsers install', {
    cacheDir,
    executablePath,
    path_exists: Boolean(executablePath && existsSync(executablePath)),
    requireBrowser,
  });
}

console.info('[income-pdf] chrome ready', {
  cacheDir,
  executablePath,
  requireBrowser,
});
