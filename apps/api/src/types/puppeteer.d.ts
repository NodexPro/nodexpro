declare module 'puppeteer' {
  export interface Page {
    setContent(html: string, options: { waitUntil: string }): Promise<void>;
    evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
    pdf(options: Record<string, unknown>): Promise<Uint8Array>;
  }

  export interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export function launch(options: Record<string, unknown>): Promise<Browser>;
}
