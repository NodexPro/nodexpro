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
import { isPdfBrowserResolutionUsable, } from './income-document-pdf-browser.pure.js';
import { resolvePdfBrowserForLaunch } from './income-document-pdf-browser.service.js';
async function renderWithPuppeteer(fullHtml, executablePath) {
    try {
        const puppeteer = await import('puppeteer');
        const browser = await puppeteer.launch({
            headless: true,
            executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--font-render-hinting=none',
            ],
        });
        try {
            const page = await browser.newPage();
            // Prefer local DOM ready; avoid waiting on external network (CDN fonts).
            await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
            await page.evaluate(async () => {
                try {
                    await Promise.race([
                        document.fonts.ready,
                        new Promise((resolve) => setTimeout(resolve, 2_000)),
                    ]);
                }
                catch {
                    /* fonts optional for PDF */
                }
            });
            // @page margin: 48px recreates viewer paper chrome. Puppeteer margins must stay 0.
            const pdfBytes = await page.pdf({
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                scale: 1,
                margin: { top: '0', right: '0', bottom: '0', left: '0' },
            });
            return Buffer.from(pdfBytes);
        }
        finally {
            await browser.close();
        }
    }
    catch (err) {
        const code = err?.code;
        const message = err instanceof Error ? err.message : String(err);
        if (code === 'ERR_MODULE_NOT_FOUND' || message.includes("Cannot find package 'puppeteer'")) {
            return null;
        }
        // Browser missing / launch failure on host → try Chromium CLI fallback.
        console.error('[income-pdf] puppeteer render failed; trying CLI fallback', {
            message,
            executablePath,
        });
        return null;
    }
}
async function renderWithChromiumCli(fullHtml, executablePath) {
    const id = randomUUID();
    const htmlPath = join(tmpdir(), `nodexpro-income-doc-${id}.html`);
    const pdfPath = join(tmpdir(), `nodexpro-income-doc-${id}.pdf`);
    await writeFile(htmlPath, fullHtml, 'utf8');
    const fileUrl = pathToFileURL(htmlPath).href;
    try {
        await new Promise((resolve, reject) => {
            const child = spawn(executablePath, [
                '--headless=new',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                `--print-to-pdf=${pdfPath}`,
                fileUrl,
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', (chunk) => {
                stderr += String(chunk);
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0)
                    resolve();
                else
                    reject(new Error(stderr.trim() || `Chromium PDF exit code ${code}`));
            });
        });
        return await readFile(pdfPath);
    }
    finally {
        await Promise.allSettled([unlink(htmlPath), unlink(pdfPath)]);
    }
}
function unavailablePdfEngineError(resolution) {
    return new Error(`Unified PDF render unavailable: install puppeteer (npm install) or set CHROMIUM_PATH to a headless Chromium/Chrome binary (source=${resolution.source}, path_exists=${resolution.path_exists})`);
}
export async function renderIncomeDocumentPdfBufferFromHtml(fullHtml) {
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
    if (puppeteerBuffer)
        return puppeteerBuffer;
    return renderWithChromiumCli(fullHtml, executablePath);
}
