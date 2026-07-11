/**
 * INC-6 — Unified Income document PDF renderer (HTML → PDF).
 * Prefers Puppeteer when installed; falls back to headless Chromium/Edge CLI.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
async function renderWithPuppeteer(fullHtml) {
    try {
        const puppeteer = await import('puppeteer');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
        });
        try {
            const page = await browser.newPage();
            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
            await page.evaluate(async () => {
                await document.fonts.ready;
            });
            const pdfBytes = await page.pdf({
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
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
        throw err;
    }
}
function candidateChromiumExecutables() {
    const fromEnv = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROMIUM_PATH].filter((v) => Boolean(v?.trim()));
    const win = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    const linux = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
    return [...fromEnv, ...(process.platform === 'win32' ? win : linux)];
}
function resolveChromiumExecutable() {
    for (const candidate of candidateChromiumExecutables()) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
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
export async function renderIncomeDocumentPdfBufferFromHtml(fullHtml) {
    const puppeteerBuffer = await renderWithPuppeteer(fullHtml);
    if (puppeteerBuffer)
        return puppeteerBuffer;
    const chromium = resolveChromiumExecutable();
    if (chromium)
        return renderWithChromiumCli(fullHtml, chromium);
    throw new Error('Unified PDF render unavailable: install puppeteer (npm install) or set CHROMIUM_PATH to a headless Chromium/Chrome binary');
}
