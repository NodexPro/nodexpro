/**
 * Ensure Puppeteer's Chrome binary is present for PDF rendering.
 * Soft-fails so local/dev installs without network do not break npm install.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['puppeteer', 'browsers', 'install', 'chrome'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  console.warn(
    '[income-pdf] puppeteer chrome install skipped/failed — set CHROMIUM_PATH or PUPPETEER_EXECUTABLE_PATH for PDF binary generation',
  );
}
