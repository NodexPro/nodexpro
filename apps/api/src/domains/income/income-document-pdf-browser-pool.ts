/**
 * Shared Chromium for HTML→PDF. Launching a new browser per request is the 10–29s bottleneck.
 * Pages are created per render and closed; the browser process is reused until it disconnects.
 */

type PuppeteerPage = {
  setContent: (html: string, options: { waitUntil: 'domcontentloaded' }) => Promise<void>;
  evaluate: (pageFunction: () => Promise<unknown>) => Promise<unknown>;
  pdf: (options: {
    format: 'A4';
    printBackground: boolean;
    preferCSSPageSize: boolean;
    scale: number;
    margin: { top: string; right: string; bottom: string; left: string };
  }) => Promise<Uint8Array | Buffer>;
  close: () => Promise<void>;
};

type PuppeteerBrowser = {
  connected?: boolean;
  newPage: () => Promise<PuppeteerPage>;
  on: (event: 'disconnected', listener: () => void) => void;
  close: () => Promise<void>;
};

type PooledBrowser = {
  executablePath: string;
  browser: PuppeteerBrowser;
};

let pooled: PooledBrowser | null = null;
let launching: Promise<PuppeteerBrowser> | null = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--font-render-hinting=none',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
];

function isConnected(browser: PuppeteerBrowser | null | undefined): boolean {
  if (!browser) return false;
  return browser.connected !== false;
}

async function launchBrowser(executablePath: string): Promise<PuppeteerBrowser> {
  const puppeteer = await import('puppeteer');
  const browser = (await puppeteer.launch({
    headless: true,
    executablePath,
    args: LAUNCH_ARGS,
  })) as unknown as PuppeteerBrowser;
  browser.on('disconnected', () => {
    if (pooled?.browser === browser) pooled = null;
  });
  return browser;
}

export async function getSharedPdfBrowser(executablePath: string): Promise<PuppeteerBrowser> {
  if (pooled && pooled.executablePath === executablePath && isConnected(pooled.browser)) {
    return pooled.browser;
  }
  if (pooled) {
    const previous = pooled;
    pooled = null;
    await previous.browser.close().catch(() => undefined);
  }
  if (launching) return launching;
  launching = launchBrowser(executablePath);
  try {
    const browser = await launching;
    pooled = { executablePath, browser };
    return browser;
  } finally {
    launching = null;
  }
}

export async function renderHtmlWithSharedPuppeteer(
  fullHtml: string,
  executablePath: string,
): Promise<Buffer | null> {
  const started = Date.now();
  let page: PuppeteerPage | null = null;
  try {
    const browser = await getSharedPdfBrowser(executablePath);
    page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      } catch {
        /* fonts optional for PDF */
      }
    });
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      scale: 1,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    console.info('[income-pdf] shared puppeteer render', {
      ms: Date.now() - started,
      reused: pooled?.executablePath === executablePath,
    });
    return Buffer.from(pdfBytes);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ERR_MODULE_NOT_FOUND' || message.includes("Cannot find package 'puppeteer'")) {
      return null;
    }
    if (pooled && !isConnected(pooled.browser)) {
      pooled = null;
    }
    console.error('[income-pdf] shared puppeteer render failed; trying CLI fallback', {
      message,
      executablePath,
      ms: Date.now() - started,
    });
    return null;
  } finally {
    if (page) await page.close().catch(() => undefined);
  }
}

export async function resetSharedPdfBrowserForTests(): Promise<void> {
  const current = pooled;
  pooled = null;
  launching = null;
  if (current) await current.browser.close().catch(() => undefined);
}
