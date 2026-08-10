/**
 * Canonical Chromium/Chrome executable resolution for Income PDF (no browser launch).
 */
export function defaultSystemChromeCandidates(platform) {
    if (platform === 'win32') {
        return [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ];
    }
    return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
}
/**
 * Prefer explicit env → Puppeteer cache path → known system binaries.
 * First existing path wins; if none exist, return the first preferred candidate for diagnostics.
 */
export function resolvePdfBrowserExecutable(params) {
    const candidates = [];
    const envPuppeteer = params.envPuppeteerExecutablePath?.trim();
    if (envPuppeteer) {
        candidates.push({ path: envPuppeteer, source: 'env_puppeteer_executable_path' });
    }
    const envChromium = params.envChromiumPath?.trim();
    if (envChromium) {
        candidates.push({ path: envChromium, source: 'env_chromium_path' });
    }
    const puppeteerPath = params.puppeteerExecutablePath?.trim();
    if (puppeteerPath) {
        candidates.push({ path: puppeteerPath, source: 'puppeteer_executable_path' });
    }
    for (const candidate of params.systemCandidates ?? []) {
        const trimmed = candidate?.trim();
        if (trimmed) {
            candidates.push({ path: trimmed, source: 'system_chrome' });
        }
    }
    for (const candidate of candidates) {
        if (params.pathExists(candidate.path)) {
            return {
                path: candidate.path,
                source: candidate.source,
                path_exists: true,
            };
        }
    }
    if (candidates[0]) {
        return {
            path: candidates[0].path,
            source: candidates[0].source,
            path_exists: false,
        };
    }
    return { path: null, source: 'none', path_exists: false };
}
export function isPdfBrowserResolutionUsable(resolution) {
    return Boolean(resolution.path && resolution.path_exists);
}
export function pdfEngineCapabilityFromResolution(resolution) {
    return isPdfBrowserResolutionUsable(resolution) ? 'ok' : 'unavailable';
}
