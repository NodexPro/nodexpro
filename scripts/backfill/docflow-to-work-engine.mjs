#!/usr/bin/env node
/**
 * Launcher for Stage 6 backfill (DocFlow threads → Work Engine intake).
 * Run from repo root: node scripts/backfill/docflow-to-work-engine.mjs
 *
 * Loads apps/api deps; cwd is set to apps/api so dotenv and tsconfig paths resolve.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const apiRoot = join(repoRoot, 'apps', 'api');
const tsxCli = join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const script = join(apiRoot, 'src', 'scripts', 'backfill-docflow-work-engine.ts');

if (!existsSync(tsxCli)) {
  console.error('Missing tsx. Run: npm install (in apps/api)');
  process.exit(2);
}

const extraArgs = process.argv.slice(2);
const r = spawnSync(process.execPath, [tsxCli, script, ...extraArgs], {
  cwd: apiRoot,
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: true,
});

process.exit(r.status === null ? 1 : r.status);
