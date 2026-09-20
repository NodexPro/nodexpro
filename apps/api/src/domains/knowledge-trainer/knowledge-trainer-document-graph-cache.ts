const GRAPH_TTL_MS = 10 * 60 * 1000;

type CachedTrainerDocumentGraph = {
  expiresAt: number;
  pages: unknown[];
  candidates: Array<Record<string, unknown>>;
  mappedCandidates: Array<Record<string, unknown>>;
  reviewedCandidates: Array<Record<string, unknown>>;
  reviewSummary: unknown;
  reviewFilters: unknown;
  structureTree: unknown;
  structureRun: unknown;
  sourceNotes: unknown[];
  unresolvedAnchors: unknown[];
  sourceNoteSummary: unknown;
  originalFileAccess: unknown;
};

type CachedTrainerReviewTree = {
  expiresAt: number;
  review_tree: unknown[];
  search_index: unknown[];
};

type CachedTrainerDraftList = {
  expiresAt: number;
  rows: Array<Record<string, unknown>>;
  completenessRows: Array<{ branch_draft_id: string | null; confirmed_at: string | null }>;
};

const graphCache = new Map<string, CachedTrainerDocumentGraph>();
const reviewTreeCache = new Map<string, CachedTrainerReviewTree>();
const draftListCache = new Map<string, CachedTrainerDraftList>();

export function trainerDocumentGraphCacheKey(documentId: string, jobId: string, runId: string | null): string {
  return `${documentId}:${jobId}:${runId ?? ''}`;
}

export function trainerReviewTreeCacheKey(graphKey: string, draftStamp: string): string {
  return `${graphKey}::${draftStamp}`;
}

export function invalidateTrainerReviewTreeCache(documentId?: string): void {
  if (!documentId) {
    reviewTreeCache.clear();
    draftListCache.clear();
    return;
  }
  const prefix = `${documentId}:`;
  for (const key of [...reviewTreeCache.keys()]) {
    if (key.startsWith(prefix)) reviewTreeCache.delete(key);
  }
  draftListCache.delete(documentId);
}

export function invalidateTrainerDocumentGraphCache(documentId?: string): void {
  if (!documentId) {
    graphCache.clear();
    reviewTreeCache.clear();
    draftListCache.clear();
    return;
  }
  const prefix = `${documentId}:`;
  for (const key of [...graphCache.keys()]) {
    if (key.startsWith(prefix)) graphCache.delete(key);
  }
  invalidateTrainerReviewTreeCache(documentId);
}

export function readTrainerDocumentGraphCache(key: string): Omit<CachedTrainerDocumentGraph, 'expiresAt'> | null {
  const hit = graphCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    graphCache.delete(key);
    return null;
  }
  return {
    pages: hit.pages,
    candidates: hit.candidates,
    mappedCandidates: hit.mappedCandidates,
    reviewedCandidates: hit.reviewedCandidates,
    reviewSummary: hit.reviewSummary,
    reviewFilters: hit.reviewFilters,
    structureTree: hit.structureTree,
    structureRun: hit.structureRun,
    sourceNotes: hit.sourceNotes,
    unresolvedAnchors: hit.unresolvedAnchors,
    sourceNoteSummary: hit.sourceNoteSummary,
    originalFileAccess: hit.originalFileAccess,
  };
}

export function writeTrainerDocumentGraphCache(
  key: string,
  value: Omit<CachedTrainerDocumentGraph, 'expiresAt'>,
): void {
  graphCache.set(key, {
    expiresAt: Date.now() + GRAPH_TTL_MS,
    ...value,
  });
}

export function readTrainerReviewTreeCache(key: string): { review_tree: unknown[]; search_index: unknown[] } | null {
  const hit = reviewTreeCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    reviewTreeCache.delete(key);
    return null;
  }
  return { review_tree: hit.review_tree, search_index: hit.search_index };
}

export function writeTrainerReviewTreeCache(
  key: string,
  value: { review_tree: unknown[]; search_index: unknown[] },
): void {
  reviewTreeCache.set(key, {
    expiresAt: Date.now() + GRAPH_TTL_MS,
    review_tree: value.review_tree,
    search_index: value.search_index,
  });
}

export function readTrainerDraftListCache(documentId: string): Omit<CachedTrainerDraftList, 'expiresAt'> | null {
  const hit = draftListCache.get(documentId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    draftListCache.delete(documentId);
    return null;
  }
  return { rows: hit.rows, completenessRows: hit.completenessRows };
}

export function writeTrainerDraftListCache(
  documentId: string,
  value: Omit<CachedTrainerDraftList, 'expiresAt'>,
): void {
  draftListCache.set(documentId, {
    expiresAt: Date.now() + GRAPH_TTL_MS,
    rows: value.rows,
    completenessRows: value.completenessRows,
  });
}
