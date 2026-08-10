/**
 * Runtime PDF browser resolution + capability probe (no launch on health).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSystemChromeCandidates, isPdfBrowserResolutionUsable, pdfEngineCapabilityFromResolution, resolvePdfBrowserExecutable, } from './income-document-pdf-browser.pure.js';
let cachedCapability = null;
/** Project-local cache so build and runtime share the same Chrome binary tree. */
export function resolveDefaultPuppeteerCacheDir(cwd = process.cwd()) {
    return join(cwd, '.cache', 'puppeteer');
}
export function ensureDefaultPuppeteerCacheDir() {
    const configured = process.env.PUPPETEER_CACHE_DIR?.trim();
    const cacheDir = configured || resolveDefaultPuppeteerCacheDir();
    if (!process.env.PUPPETEER_CACHE_DIR?.trim()) {
        process.env.PUPPETEER_CACHE_DIR = cacheDir;
    }
    try {
        mkdirSync(cacheDir, { recursive: true });
    }
    catch {
        /* best-effort; install script also creates */
    }
    return cacheDir;
}
async function readPuppeteerExecutablePath() {
    try {
        const mod = (await import('puppeteer'));
        const executablePathFn = mod.executablePath ?? mod.default?.executablePath;
        if (typeof executablePathFn !== 'function')
            return null;
        const path = executablePathFn();
        return typeof path === 'string' && path.trim() ? path : null;
    }
    catch {
        return null;
    }
}
export async function resolvePdfBrowserForLaunch() {
    ensureDefaultPuppeteerCacheDir();
    const puppeteerExecutablePath = await readPuppeteerExecutablePath();
    return resolvePdfBrowserExecutable({
        envPuppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        envChromiumPath: process.env.CHROMIUM_PATH,
        puppeteerExecutablePath,
        systemCandidates: defaultSystemChromeCandidates(process.platform),
        pathExists: existsSync,
    });
}
export function snapshotFromResolution(resolution) {
    const usable = isPdfBrowserResolutionUsable(resolution);
    return {
        pdf_engine: pdfEngineCapabilityFromResolution(resolution),
        browser_source: resolution.source,
        browser_path_exists: resolution.path_exists,
        browser_path: resolution.path,
        pdf_engine_available: usable,
    };
}
export async function refreshPdfEngineCapability() {
    const resolution = await resolvePdfBrowserForLaunch();
    cachedCapability = snapshotFromResolution(resolution);
    return cachedCapability;
}
export function hasCachedPdfEngineCapability() {
    return cachedCapability != null;
}
export function getCachedPdfEngineCapability() {
    return (cachedCapability ?? {
        pdf_engine: 'unavailable',
        browser_source: 'none',
        browser_path_exists: false,
        browser_path: null,
        pdf_engine_available: false,
    });
}
/** Startup / diagnostic log — does not launch Chrome. */
export async function logPdfEngineStartupProbe() {
    const snapshot = await refreshPdfEngineCapability();
    console.info('[income-pdf] pdf_engine capability', {
        pdf_engine_available: snapshot.pdf_engine_available,
        browser_source: snapshot.browser_source,
        browser_path_exists: snapshot.browser_path_exists,
        browser_path: snapshot.browser_path,
        puppeteer_cache_dir: process.env.PUPPETEER_CACHE_DIR ?? null,
    });
    return snapshot;
}
