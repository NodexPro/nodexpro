import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHED_SOURCE_PDF_UNREADABLE,
  createWorkerPdfSourceCache,
  workerPdfSourceCacheKey,
  type WorkerPdfSourceIdentity,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-pdf-source.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const ktDir = join(repoRoot, 'apps/api/src/domains/knowledge-trainer');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const ordinanceIdentity: WorkerPdfSourceIdentity = {
  documentId: 'd4139c37-f9d6-48f6-a650-dfaeb2fc51ad',
  bucket: 'owner-legal-materials',
  key: 'IL/fixture/ordinance.pdf',
  contentSha256: 'abc123',
};

const otherIdentity: WorkerPdfSourceIdentity = {
  documentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  bucket: 'owner-legal-materials',
  key: 'IL/fixture/other.pdf',
  contentSha256: 'def456',
};

function fakePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4 fixture ${label}`, 'utf8');
}

function makeCache(download: (bucket: string, key: string) => Promise<Buffer>, maxEntries = 2) {
  const rootDir = mkdtempSync(join(tmpdir(), 'kt-pdf-source-test-'));
  const cache = createWorkerPdfSourceCache({ download, rootDir, maxEntries });
  return { cache, rootDir };
}

async function runPass(cache: ReturnType<typeof createWorkerPdfSourceCache>, identity: WorkerPdfSourceIdentity, pages: number) {
  for (let page = 1; page <= pages; page += 1) {
    const bytes = await cache.getBytes(identity);
    assert.ok(bytes.length > 0);
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('312 text + 304 layout + retry share one Storage download in one worker execution', async () => {
  let downloads = 0;
  const pdf = fakePdf('ordinance');
  const { cache, rootDir } = makeCache(async (bucket, key) => {
    downloads += 1;
    assert.equal(bucket, ordinanceIdentity.bucket);
    assert.equal(key, ordinanceIdentity.key);
    return pdf;
  });
  try {
    const forCountPdfPages = await cache.getBytes(ordinanceIdentity);
    assert.equal(forCountPdfPages.equals(pdf), true);
    await runPass(cache, ordinanceIdentity, 312);
    const retriedPage = await cache.getBytes(ordinanceIdentity);
    assert.equal(retriedPage.equals(pdf), true);
    await runPass(cache, ordinanceIdentity, 304);
    assert.equal(downloads, 1);
    assert.equal(cache.downloadCount(), 1);
    assert.equal(cache.hasLocalCopy(ordinanceIdentity), true);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('text pass of 312 pages downloads the original PDF at most once', async () => {
  let downloads = 0;
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    return fakePdf('text');
  });
  try {
    await cache.getBytes(ordinanceIdentity);
    await runPass(cache, ordinanceIdentity, 312);
    assert.equal(downloads, 1);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('layout pass of 304 pages downloads the original PDF at most once', async () => {
  let downloads = 0;
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    return fakePdf('layout');
  });
  try {
    await runPass(cache, ordinanceIdentity, 304);
    assert.equal(downloads, 1);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('page retry in the same execution does not download again', async () => {
  let downloads = 0;
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    return fakePdf('retry');
  });
  try {
    await cache.getBytes(ordinanceIdentity);
    await cache.getBytes(ordinanceIdentity);
    await cache.getBytes(ordinanceIdentity);
    assert.equal(downloads, 1);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('a second document gets its own PDF and never shares the first bytes', async () => {
  const first = fakePdf('first');
  const second = fakePdf('second');
  const { cache, rootDir } = makeCache(async (_bucket, key) => {
    if (key === ordinanceIdentity.key) return first;
    if (key === otherIdentity.key) return second;
    throw new Error(`unexpected key ${key}`);
  });
  try {
    const a = await cache.getBytes(ordinanceIdentity);
    const b = await cache.getBytes(otherIdentity);
    const aAgain = await cache.getBytes(ordinanceIdentity);
    assert.equal(a.equals(first), true);
    assert.equal(b.equals(second), true);
    assert.equal(aAgain.equals(first), true);
    assert.equal(a.equals(b), false);
    assert.equal(cache.downloadCount(), 2);
    assert.notEqual(workerPdfSourceCacheKey(ordinanceIdentity), workerPdfSourceCacheKey(otherIdentity));
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('a new cache instance after restart may download once again', async () => {
  let downloads = 0;
  const downloader = async () => {
    downloads += 1;
    return fakePdf('restart');
  };
  const first = makeCache(downloader);
  try {
    await first.cache.getBytes(ordinanceIdentity);
    assert.equal(downloads, 1);
  } finally {
    first.cache.dispose();
  }
  const second = makeCache(downloader);
  try {
    await second.cache.getBytes(ordinanceIdentity);
    assert.equal(downloads, 2);
  } finally {
    second.cache.dispose();
    assert.equal(existsSync(second.rootDir), false);
  }
});

test('failed download does not leave temp files and later retry can download once', async () => {
  let downloads = 0;
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    if (downloads === 1) throw new Error('storage unavailable');
    return fakePdf('recovered');
  });
  try {
    await assert.rejects(() => cache.getBytes(ordinanceIdentity), /Failed to acquire Knowledge Trainer source PDF: storage unavailable/);
    assert.equal(readdirSync(rootDir).filter((name) => name.endsWith('.part')).length, 0);
    const recovered = await cache.getBytes(ordinanceIdentity);
    assert.equal(recovered.equals(fakePdf('recovered')), true);
    assert.equal(downloads, 2);
    assert.equal(cache.downloadCount(), 2);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('unreadable local cache fails closed and does not re-download the source', async () => {
  let downloads = 0;
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    return fakePdf('once');
  });
  try {
    await cache.getBytes(ordinanceIdentity);
    assert.equal(downloads, 1);
    const leftover = readdirSync(rootDir).find((name) => name.endsWith('.pdf'));
    assert.ok(leftover);
    unlinkSync(join(rootDir, leftover));
    await assert.rejects(() => cache.getBytes(ordinanceIdentity), new RegExp(CACHED_SOURCE_PDF_UNREADABLE));
    assert.equal(downloads, 1);
    assert.equal(cache.downloadCount(), 1);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('20 simultaneous requests for the same source download once', async () => {
  let downloads = 0;
  let started = 0;
  let releaseDownload: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  const { cache, rootDir } = makeCache(async () => {
    downloads += 1;
    started += 1;
    await gate;
    return fakePdf('same-20');
  });
  try {
    const pending = Array.from({ length: 20 }, () => cache.getBytes(ordinanceIdentity));
    await waitUntil(() => started === 1);
    assert.equal(started, 1);
    releaseDownload?.();
    const results = await Promise.all(pending);
    assert.equal(downloads, 1);
    assert.equal(results.every((bytes) => bytes.equals(fakePdf('same-20'))), true);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('20 simultaneous requests across two sources download twice', async () => {
  let downloads = 0;
  const startedKeys = new Set<string>();
  let releaseDownload: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  const { cache, rootDir } = makeCache(async (_bucket, key) => {
    downloads += 1;
    startedKeys.add(key);
    await gate;
    return fakePdf(key);
  });
  try {
    const pending = [
      ...Array.from({ length: 10 }, () => cache.getBytes(ordinanceIdentity)),
      ...Array.from({ length: 10 }, () => cache.getBytes(otherIdentity)),
    ];
    await waitUntil(() => startedKeys.size === 2);
    assert.equal(startedKeys.size, 2);
    assert.equal(downloads, 2);
    releaseDownload?.();
    const results = await Promise.all(pending);
    assert.equal(downloads, 2);
    assert.equal(results.filter((bytes) => bytes.equals(fakePdf(ordinanceIdentity.key))).length, 10);
    assert.equal(results.filter((bytes) => bytes.equals(fakePdf(otherIdentity.key))).length, 10);
  } finally {
    cache.dispose();
    assert.equal(existsSync(rootDir), false);
  }
});

test('page-processing modules cannot download the remote source PDF directly', () => {
  assert.equal(existsSync(join(repoRoot, '.cursor/rules/knowledge-trainer-pdf-source.mdc')), true);
  const storage = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-storage.service.ts');
  const source = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-pdf-source.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const pdf = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-pdf.service.ts');
  const index = readRepo('apps/knowledge-trainer-worker/src/index.ts');

  assert.match(storage, /storage\.from\(bucket\)\.download\(key\)/);
  assert.match(source, /createWorkerPdfSourceCache/);
  assert.match(source, /CACHED_SOURCE_PDF_UNREADABLE/);
  assert.doesNotMatch(source, /supabaseAdmin|storage\.download|downloadOwnerLegalMaterial/);

  assert.match(worker, /createWorkerPdfSourceCache/);
  assert.match(worker, /download: downloadOwnerLegalMaterial/);
  assert.match(worker, /await getWorkerPdfBytes\(/);
  assert.equal([...worker.matchAll(/await getWorkerPdfBytes\(/g)].length, 3);
  assert.doesNotMatch(worker, /downloadOwnerLegalMaterial\(/);
  assert.doesNotMatch(worker, /storage\.download/);
  assert.doesNotMatch(worker, /createSignedUrl/);
  assert.doesNotMatch(worker, /catch[\s\S]{0,800}downloadOwnerLegalMaterial/);
  assert.doesNotMatch(worker, /catch[\s\S]{0,800}storage\.download/);
  assert.doesNotMatch(worker, /page_pdf|pdf_bytes|file_base64|bytea/);

  assert.match(pdf, /extractEmbeddedPdfPageText\(bytes: Buffer, pageNo: number\)/);
  assert.match(pdf, /extractEmbeddedPdfPageLayout\(bytes: Buffer, pageNo: number\)/);
  assert.match(pdf, /countPdfPages\(bytes: Buffer\)/);
  assert.match(index, /disposeKnowledgeTrainerWorkerPdfSource/);

  const remoteOwners = new Set(['knowledge-trainer-storage.service.ts', 'knowledge-trainer-pdf-source.ts']);
  for (const name of readdirSync(ktDir).filter((file) => file.endsWith('.ts'))) {
    const src = readFileSync(join(ktDir, name), 'utf8');
    if (name === 'knowledge-trainer-worker.runtime.ts') {
      assert.doesNotMatch(src, /downloadOwnerLegalMaterial\(/);
      assert.doesNotMatch(src, /storage\.download|\.download\(/);
      continue;
    }
    if (remoteOwners.has(name)) continue;
    assert.doesNotMatch(src, /downloadOwnerLegalMaterial/, `${name} must not own remote PDF download`);
    assert.doesNotMatch(src, /storage\.download/, `${name} must not call storage.download`);
    assert.doesNotMatch(src, /\.from\([^)]*\)\.download\(/, `${name} must not download storage objects`);
  }
});
