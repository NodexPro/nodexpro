/**
 * INC-6 — Unified Income document PDF renderer (HTML → PDF).
 * Prefers Puppeteer when installed; falls back to headless Chromium/Edge CLI.
 */

import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isPdfBrowserResolutionUsable,
  type PdfBrowserResolution,
} from './income-document-pdf-browser.pure.js';
import { resolvePdfBrowserForLaunch } from './income-document-pdf-browser.service.js';
import { renderHtmlWithSharedPuppeteer } from './income-document-pdf-browser-pool.js';

async function renderWithPuppeteer(
  fullHtml: string,
  executablePath: string,
): Promise<Buffer | null> {
  return renderHtmlWithSharedPuppeteer(fullHtml, executablePath);
}

async function renderWithChromiumCli(fullHtml: string, executablePath: string): Promise<Buffer> {
  const id = randomUUID();
  const htmlPath = join(tmpdir(), `nodexpro-income-doc-${id}.html`);
  const pdfPath = join(tmpdir(), `nodexpro-income-doc-${id}.pdf`);
  await writeFile(htmlPath, fullHtml, 'utf8');
  const fileUrl = pathToFileURL(htmlPath).href;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        executablePath,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--print-to-pdf=${pdfPath}`,
          fileUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Chromium PDF exit code ${code}`));
      });
    });
    return await readFile(pdfPath);
  } finally {
    await Promise.allSettled([unlink(htmlPath), unlink(pdfPath)]);
  }
}

function unavailablePdfEngineError(resolution: PdfBrowserResolution): Error {
  return new Error(
    `Unified PDF render unavailable: install puppeteer (npm install) or set CHROMIUM_PATH to a headless Chromium/Chrome binary (source=${resolution.source}, path_exists=${resolution.path_exists})`,
  );
}

export async function renderIncomeDocumentPdfBufferFromHtml(fullHtml: string): Promise<Buffer> {
  const resolution = await resolvePdfBrowserForLaunch();
  console.info('[income-pdf] browser resolution', {
    browser_source: resolution.source,
    browser_path_exists: resolution.path_exists,
    browser_path: resolution.path,
  });

  if (!isPdfBrowserResolutionUsable(resolution) || !resolution.path) {
    throw unavailablePdfEngineError(resolution);
  }

  const executablePath = resolution.path;
  const puppeteerBuffer = await renderWithPuppeteer(fullHtml, executablePath);
  if (puppeteerBuffer) return puppeteerBuffer;

  return renderWithChromiumCli(fullHtml, executablePath);
}
