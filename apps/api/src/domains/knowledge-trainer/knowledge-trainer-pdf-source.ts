/**
 * Worker/job-scoped PDF source cache.
 *
 * Durable truth remains storage_bucket + storage_key on the document.
 * The local copy is execution infrastructure only: never persist these bytes
 * to Postgres, aggregates, frontend, or a new Storage object.
 *
 * Remote Storage may be contacted at most once per source identity per
 * worker execution. Page processors must consume this handle; they must
 * never call Storage themselves, including as a cache-failure fallback.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WORKER_PDF_SOURCE_MAX_ENTRIES = 2;

export const CACHED_SOURCE_PDF_UNREADABLE =
  'Failed to read cached Knowledge Trainer source PDF';

export type WorkerPdfSourceIdentity = {
  documentId: string;
  bucket: string;
  key: string;
  contentSha256?: string | null;
};

export type WorkerPdfDownloader = (bucket: string, key: string) => Promise<Buffer>;

export type WorkerPdfSourceCache = {
  getBytes(identity: WorkerPdfSourceIdentity): Promise<Buffer>;
  release(identity: WorkerPdfSourceIdentity): void;
  dispose(): void;
  downloadCount(): number;
  hasLocalCopy(identity: WorkerPdfSourceIdentity): boolean;
  cacheDir(): string;
};

function assertIdentity(identity: WorkerPdfSourceIdentity): void {
  if (!identity.documentId.trim()) throw new Error('document id is required');
  if (!identity.bucket.trim()) throw new Error('storage bucket is required');
  if (!identity.key.trim()) throw new Error('storage key is required');
}

export function workerPdfSourceCacheKey(identity: WorkerPdfSourceIdentity): string {
  assertIdentity(identity);
  const material = [
    identity.documentId.trim(),
    identity.bucket.trim(),
    identity.key.trim(),
    String(identity.contentSha256 ?? '').trim(),
  ].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 40);
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort. A later dispose/rm of the cache dir still cleans up.
  }
}

export function createWorkerPdfSourceCache(opts: {
  download: WorkerPdfDownloader;
  maxEntries?: number;
  rootDir?: string;
}): WorkerPdfSourceCache {
  const maxEntries = Math.max(1, opts.maxEntries ?? WORKER_PDF_SOURCE_MAX_ENTRIES);
  const rootDir = opts.rootDir ?? join(tmpdir(), 'nodexpro-kt-pdf-source', String(process.pid));
  mkdirSync(rootDir, { recursive: true });

  const files = new Map<string, string>();
  const inflight = new Map<string, Promise<Buffer>>();
  const acquired = new Set<string>();
  let downloads = 0;

  function filePath(cacheKey: string): string {
    return join(rootDir, `${cacheKey}.pdf`);
  }

  function forget(cacheKey: string): void {
    const path = files.get(cacheKey);
    files.delete(cacheKey);
    inflight.delete(cacheKey);
    acquired.delete(cacheKey);
    if (path) safeUnlink(path);
  }

  function evictIfNeeded(keepKey: string): void {
    while (files.size >= maxEntries) {
      const oldest = [...files.keys()].find((key) => key !== keepKey);
      if (!oldest) break;
      forget(oldest);
    }
  }

  function touch(cacheKey: string, path: string): void {
    files.delete(cacheKey);
    files.set(cacheKey, path);
  }

  function readLocal(dest: string, cacheKey: string): Buffer | null {
    try {
      if (!existsSync(dest)) return null;
      const bytes = readFileSync(dest);
      if (!bytes.length) return null;
      if (!files.has(cacheKey)) evictIfNeeded(cacheKey);
      touch(cacheKey, dest);
      acquired.add(cacheKey);
      return bytes;
    } catch {
      files.delete(cacheKey);
      return null;
    }
  }

  async function materialize(identity: WorkerPdfSourceIdentity): Promise<Buffer> {
    const cacheKey = workerPdfSourceCacheKey(identity);
    const dest = filePath(cacheKey);
    const cached = readLocal(dest, cacheKey);
    if (cached) return cached;

    if (acquired.has(cacheKey)) {
      throw new Error(CACHED_SOURCE_PDF_UNREADABLE);
    }

    downloads += 1;
    let bytes: Buffer;
    try {
      bytes = await opts.download(identity.bucket, identity.key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Storage download failed';
      throw new Error(`Failed to acquire Knowledge Trainer source PDF: ${message}`);
    }
    if (!bytes.length) {
      throw new Error('Failed to acquire Knowledge Trainer source PDF: empty object');
    }

    const part = join(rootDir, `${cacheKey}.${randomUUID()}.part`);
    try {
      mkdirSync(rootDir, { recursive: true });
      writeFileSync(part, bytes);
      if (existsSync(dest)) safeUnlink(dest);
      renameSync(part, dest);
    } catch (error) {
      safeUnlink(part);
      throw error;
    }
    evictIfNeeded(cacheKey);
    touch(cacheKey, dest);
    acquired.add(cacheKey);
    return bytes;
  }

  return {
    async getBytes(identity) {
      const cacheKey = workerPdfSourceCacheKey(identity);
      const pending = inflight.get(cacheKey);
      if (pending) return pending;
      const work = materialize(identity).finally(() => {
        inflight.delete(cacheKey);
      });
      inflight.set(cacheKey, work);
      return work;
    },
    release(identity) {
      forget(workerPdfSourceCacheKey(identity));
    },
    dispose() {
      inflight.clear();
      files.clear();
      acquired.clear();
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        for (const name of existsSync(rootDir) ? readdirSync(rootDir) : []) {
          safeUnlink(join(rootDir, name));
        }
      }
    },
    downloadCount() {
      return downloads;
    },
    hasLocalCopy(identity) {
      const cacheKey = workerPdfSourceCacheKey(identity);
      const path = files.get(cacheKey) ?? filePath(cacheKey);
      return existsSync(path);
    },
    cacheDir() {
      return rootDir;
    },
  };
}
