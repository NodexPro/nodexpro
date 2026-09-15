import { catalogRankForLabel, isFineGrainedStructureKind } from './knowledge-trainer-review.pure.js';
import {
  buildPageLayoutProfile,
  groupTextItemsIntoLines,
  parseStoredPageLayout,
  type LayoutLine,
  type StoredTextItem,
} from './knowledge-trainer-layout.pure.js';
import { extractNestedStructureMarker, isolatedItemIsStructuralMarker } from './knowledge-trainer-nested.pure.js';
import type { StructureKindCatalogItem } from './knowledge-trainer.types.js';

export const LEGAL_TEXT_DRAFT_REVIEW_STATUSES = ['draft', 'needs_review', 'ready'] as const;
export type LegalTextDraftReviewStatus = (typeof LEGAL_TEXT_DRAFT_REVIEW_STATUSES)[number];

export const LEGAL_TEXT_DRAFT_BOUNDARY_STATUSES = ['certain', 'uncertain', 'owner_defined'] as const;
export type LegalTextDraftBoundaryStatus = (typeof LEGAL_TEXT_DRAFT_BOUNDARY_STATUSES)[number];

export type DraftStructureCandidate = {
  id: string;
  sort_order: number;
  parent_candidate_id: string | null;
  source_page: number | null;
  source_item_start: number | null;
  source_item_end: number | null;
  source_line_index: number | null;
  page_start: number | null;
  page_end: number | null;
  kind_label?: string | null;
  source_display_identifier?: string | null;
  normalized_machine_identifier?: string | null;
  printed_marker?: string | null;
  title?: string | null;
  status?: string | null;
};

export type DraftPageEvidence = {
  page_no: number;
  status: string;
  page_text: string | null;
  page_text_items: unknown;
};

export type SourceCursor = {
  page: number;
  item: number;
  certain: boolean;
};

export type HeadingResolutionStatus = 'persisted' | 'recovered' | 'ambiguous' | 'missing' | 'ocr_gap';

export type HeadingResolution = {
  cursor: SourceCursor | null;
  status: HeadingResolutionStatus;
};

export type CapturedSourceBody = {
  text: string;
  boundary_status: Exclude<LegalTextDraftBoundaryStatus, 'owner_defined'>;
  page_start: number | null;
  page_end: number | null;
  item_start: number | null;
  item_end: number | null;
  line_start: number | null;
  line_end: number | null;
  heading_status: HeadingResolutionStatus;
  next_non_descendant_id: string | null;
  first_descendant_id: string | null;
  subtree_text: string;
  subtree_page_end: number | null;
  subtree_item_end: number | null;
  subtree_line_start: number | null;
  subtree_line_end: number | null;
};

export type DraftIdentityRow = {
  id: string;
  parent_draft_id: string | null;
  kind_label: string | null;
  normalized_machine_identifier: string | null;
};

export type DraftParentRow = {
  id: string;
  parent_draft_id: string | null;
  document_id: string;
  country_code: string;
  kind_label: string | null;
};

export type DraftNoteEvidence = {
  id: string;
  source_page: number;
  source_item_start: number | null;
  source_item_end: number | null;
  inline_link_status: string;
};

export function isLegalTextDraftReviewStatus(value: unknown): value is LegalTextDraftReviewStatus {
  return typeof value === 'string' && (LEGAL_TEXT_DRAFT_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function draftIdentityKey(row: {
  parent_draft_id: string | null;
  kind_label: string | null;
  normalized_machine_identifier: string | null;
}): string | null {
  const machine = row.normalized_machine_identifier?.trim() || '';
  if (!machine) return null;
  const parent = row.parent_draft_id ?? 'root';
  const kind = (row.kind_label ?? '').trim() || 'unknown';
  return `${parent}|${kind}|${machine}`;
}

export function findDraftIdentityConflict(
  candidate: DraftIdentityRow,
  existing: DraftIdentityRow[],
): DraftIdentityRow | null {
  const key = draftIdentityKey(candidate);
  if (!key) return null;
  return (
    existing.find((row) => {
      if (row.id === candidate.id) return false;
      return draftIdentityKey(row) === key;
    }) ?? null
  );
}

export function persistedStartCursor(candidate: DraftStructureCandidate): SourceCursor | null {
  if (candidate.source_page != null && candidate.source_page > 0 && candidate.source_item_start != null) {
    return { page: candidate.source_page, item: candidate.source_item_start, certain: true };
  }
  return null;
}

/** Persisted TAX-629 span only. Never invents page_start + item 0. */
export function candidateStartCursor(candidate: DraftStructureCandidate): SourceCursor | null {
  return persistedStartCursor(candidate);
}

export function descendantCandidateIds(rootId: string, rows: DraftStructureCandidate[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_candidate_id) continue;
    const list = children.get(row.parent_candidate_id) ?? [];
    list.push(row.id);
    children.set(row.parent_candidate_id, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop();
    if (!id || out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export function nextNonDescendantBoundaryCandidate(
  ordered: DraftStructureCandidate[],
  currentId: string,
): DraftStructureCandidate | null {
  const descendants = descendantCandidateIds(currentId, ordered);
  const index = ordered.findIndex((row) => row.id === currentId);
  if (index < 0) return null;
  for (let i = index + 1; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (!descendants.has(row.id)) return row;
  }
  return null;
}

export function firstDescendantBoundaryCandidate(
  ordered: DraftStructureCandidate[],
  currentId: string,
): DraftStructureCandidate | null {
  const descendants = descendantCandidateIds(currentId, ordered);
  const index = ordered.findIndex((row) => row.id === currentId);
  if (index < 0) return null;
  for (let i = index + 1; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (descendants.has(row.id)) return row;
  }
  return null;
}

export function compareLayoutCursors(a: SourceCursor, b: SourceCursor): number {
  if (a.page !== b.page) return a.page - b.page;
  return a.item - b.item;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printedMarkerComponent(marker: string): string | null {
  const trimmed = marker.trim();
  if (!trimmed) return null;
  const paren = trimmed.match(/^\(\s*([^()]+)\s*\)$/u);
  if (paren) return paren[1].replace(/\s+/g, '');
  return trimmed.replace(/\s+/g, '');
}

function nestedPrintedMarker(candidate: DraftStructureCandidate): string | null {
  const marker = candidate.printed_marker?.trim() || '';
  if (marker.startsWith('(') && marker.endsWith(')')) return marker;
  return null;
}

function lineHasTitleTokens(text: string, title: string | null | undefined): boolean {
  const tokens = (title ?? '')
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[.:;־–—-]+$/g, ''))
    .filter((token) => token.length > 1);
  if (!tokens.length) return false;
  return tokens.every((token) => text.includes(token));
}

function lineStartsWithPrintedMarker(lineText: string, marker: string): boolean {
  const trimmed = lineText.trim();
  const expected = marker.trim();
  if (!expected) return false;
  if (trimmed === expected) return true;
  if (trimmed.startsWith(expected)) {
    const next = trimmed[expected.length];
    if (!next || /[\s:.\-–—]/.test(next)) return true;
  }
  const extracted = extractNestedStructureMarker(trimmed);
  const want = printedMarkerComponent(expected);
  return Boolean(extracted && want && extracted.component === want);
}

function lineMatchesKindIdentifier(lineText: string, kind: string, ident: string): boolean {
  const trimmed = lineText.trim();
  const kindLabel = kind.trim();
  const identifier = ident.trim();
  if (!kindLabel || !identifier) return false;
  const headingRe = new RegExp(
    `^(?:ה)?${escapeRegExp(kindLabel)}\\s+${escapeRegExp(identifier)}(?:\\b|[.\\s:־–—-]|$)`,
    'u',
  );
  if (headingRe.test(trimmed)) return true;
  const ltr = trimmed.match(/^([0-9]{1,3}[א-ת]?)\.(?:\s+|$)/u);
  return Boolean(ltr && ltr[1] === identifier && /^סעיף/.test(kindLabel));
}

function pageIsOcrGap(page: DraftPageEvidence, items: StoredTextItem[]): boolean {
  if (page.status !== 'needs_ocr' && page.status !== 'skipped_needs_ocr') return false;
  return items.length === 0;
}

type IndexedDraftPage = {
  page_no: number;
  status: string;
  ocrGap: boolean;
  items: StoredTextItem[];
  lines: LayoutLine[];
  profile: ReturnType<typeof buildPageLayoutProfile>;
};

function indexDraftPages(pages: DraftPageEvidence[]): Map<number, IndexedDraftPage> {
  const out = new Map<number, IndexedDraftPage>();
  for (const page of pages) {
    const layout = parseStoredPageLayout(page.page_text_items);
    const items = (layout?.items ?? []).slice().sort((a, b) => a.i - b.i);
    const lines = groupTextItemsIntoLines(items);
    const profile = buildPageLayoutProfile(lines, layout?.h ?? 0);
    out.set(page.page_no, {
      page_no: page.page_no,
      status: page.status,
      ocrGap: pageIsOcrGap(page, items),
      items,
      lines,
      profile,
    });
  }
  return out;
}

type HeadingHit = {
  page: number;
  item: number;
  text: string;
  hasTitle: boolean;
};

function cursorInWindow(hit: HeadingHit, after: SourceCursor | null, until: SourceCursor | null): boolean {
  if (after && compareLayoutCursors({ page: hit.page, item: hit.item, certain: true }, after) <= 0) return false;
  if (until && compareLayoutCursors({ page: hit.page, item: hit.item, certain: true }, until) >= 0) return false;
  return true;
}

function nonEmptyLineItems(lineItems: StoredTextItem[]): StoredTextItem[] {
  return lineItems.filter((item) => item.s.trim()).sort((a, b) => a.i - b.i);
}

function reconstructedMarkerStarts(lineItems: StoredTextItem[], component: string): number[] {
  const tokens = nonEmptyLineItems(lineItems);
  const starts: number[] = [];
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].s.trim() === '(' && tokens[i + 1].s.trim() === component && tokens[i + 2].s.trim() === ')') {
      starts.push(tokens[i].i);
    }
  }
  return starts;
}

function collectHeadingHitsOnPage(
  candidate: DraftStructureCandidate,
  indexed: IndexedDraftPage,
): HeadingHit[] {
  const hits: HeadingHit[] = [];
  const seen = new Set<string>();
  const pushHit = (page: number, item: number, text: string) => {
    const key = `${page}:${item}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      page,
      item,
      text,
      hasTitle: lineHasTitleTokens(text, candidate.title),
    });
  };

  const kind = candidate.kind_label?.trim() || '';
  const ident = candidate.source_display_identifier?.trim() || '';
  const nestedMarker = nestedPrintedMarker(candidate);
  const wantComponent = nestedMarker ? printedMarkerComponent(nestedMarker) : null;
  const title = candidate.title?.trim() || '';

  for (let lineIndex = 0; lineIndex < indexed.lines.length; lineIndex += 1) {
    const line = indexed.lines[lineIndex];
    const lineItems = indexed.items.filter((item) => line.itemIndexes.includes(item.i));
    const context = [line.text, indexed.lines[lineIndex + 1]?.text].filter(Boolean).join(' ');
    if (nestedMarker && wantComponent) {
      const markerStarts = reconstructedMarkerStarts(lineItems, wantComponent);
      const exact = lineItems.find((item) => item.s.trim() === nestedMarker);
      if (exact) markerStarts.push(exact.i);
      if (lineStartsWithPrintedMarker(line.text, nestedMarker) && !markerStarts.length) {
        const markerItem = lineItems.find((item) => item.s.trim() === nestedMarker) ?? lineItems[0];
        if (markerItem) markerStarts.push(markerItem.i);
      }
      for (const item of lineItems) {
        const neighbors = lineItems.filter((other) => other.i !== item.i);
        const isolated = isolatedItemIsStructuralMarker(item, neighbors, indexed.profile);
        if (isolated === wantComponent && item.s.trim() === nestedMarker) {
          markerStarts.push(item.i);
        }
      }
      const lineStart = Math.min(...line.itemIndexes);
      const includeTitle = Boolean(title) && lineHasTitleTokens(line.text, title);
      for (const start of markerStarts) {
        pushHit(indexed.page_no, includeTitle ? Math.min(lineStart, start) : start, context);
      }
      continue;
    }
    if (kind && ident && !ident.includes('(') && lineMatchesKindIdentifier(line.text, kind, ident)) {
      pushHit(indexed.page_no, Math.min(...line.itemIndexes), context);
    }
    if (kind && ident && !ident.includes('(') && title && lineHasTitleTokens(line.text, title) && line.text.length <= 180) {
      const titleItem = lineItems.find((item) => item.s.includes(title) || lineHasTitleTokens(item.s, title));
      pushHit(indexed.page_no, titleItem?.i ?? Math.min(...line.itemIndexes), context);
    }
  }

  if (kind && ident && !ident.includes('(')) {
    for (let i = 0; i < indexed.items.length - 1; i += 1) {
      const first = indexed.items[i];
      const second = indexed.items[i + 1];
      if (first.s.trim() === kind && second.s.trim() === ident) {
        const context = indexed.items
          .slice(i, i + 8)
          .map((item) => item.s)
          .join(' ');
        pushHit(indexed.page_no, first.i, context);
      }
    }
  }

  return hits;
}

function headingSearchPages(candidate: DraftStructureCandidate): number[] {
  const start = candidate.page_start;
  if (start == null || start <= 0) return [];
  const end = candidate.page_end != null && candidate.page_end >= start ? candidate.page_end : start;
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
  return pages;
}

function chooseUniqueHit(hits: HeadingHit[], title: string | null | undefined): HeadingHit[] {
  if (hits.length <= 1) return hits;
  if (!title?.trim()) return hits;
  const withTitle = hits.filter((hit) => hit.hasTitle);
  return withTitle.length ? withTitle : hits;
}

function tryRecoverHeading(
  candidate: DraftStructureCandidate,
  ordered: DraftStructureCandidate[],
  indexedPages: Map<number, IndexedDraftPage>,
  resolved: Map<string, HeadingResolution>,
): HeadingResolution {
  const searchPages = headingSearchPages(candidate);
  if (!searchPages.length) return { cursor: null, status: 'missing' };
  for (const pageNo of searchPages) {
    const page = indexedPages.get(pageNo);
    if (page?.ocrGap) return { cursor: null, status: 'ocr_gap' };
  }

  const parent = candidate.parent_candidate_id
    ? ordered.find((row) => row.id === candidate.parent_candidate_id) ?? null
    : null;
  if (parent && !resolved.has(parent.id)) {
    return { cursor: null, status: 'missing' };
  }
  const after = parent ? resolved.get(parent.id)?.cursor ?? null : null;
  const parentUntil = parent ? nextNonDescendantBoundaryCandidate(ordered, parent.id) : null;
  const parentUntilCursor = parentUntil ? resolved.get(parentUntil.id)?.cursor ?? null : null;
  const ownUntil = nextNonDescendantBoundaryCandidate(ordered, candidate.id);
  const ownUntilCursor = ownUntil ? resolved.get(ownUntil.id)?.cursor ?? null : null;
  const until = parentUntilCursor ?? ownUntilCursor;

  const hits: HeadingHit[] = [];
  for (const pageNo of searchPages) {
    const page = indexedPages.get(pageNo);
    if (!page || page.ocrGap) continue;
    if (!page.items.length) continue;
    for (const hit of collectHeadingHitsOnPage(candidate, page)) {
      if (cursorInWindow(hit, after, until)) hits.push(hit);
    }
  }

  const unique = chooseUniqueHit(hits, candidate.title);
  if (unique.length === 1) {
    const hit = unique[0];
    return { cursor: { page: hit.page, item: hit.item, certain: true }, status: 'recovered' };
  }
  if (unique.length > 1) return { cursor: null, status: 'ambiguous' };
  return { cursor: null, status: 'missing' };
}

export function headingIdsRequiredForCapture(
  current: DraftStructureCandidate,
  ordered: DraftStructureCandidate[],
): Set<string> {
  const byId = new Map(ordered.map((row) => [row.id, row]));
  const ids = new Set<string>();
  const addAncestorChain = (startId: string | null | undefined) => {
    let walk = startId ?? null;
    while (walk) {
      if (ids.has(walk)) break;
      ids.add(walk);
      walk = byId.get(walk)?.parent_candidate_id ?? null;
    }
  };
  addAncestorChain(current.id);
  const firstDescendant = firstDescendantBoundaryCandidate(ordered, current.id);
  if (firstDescendant) addAncestorChain(firstDescendant.id);
  const addNextNonDescendant = (id: string) => {
    const next = nextNonDescendantBoundaryCandidate(ordered, id);
    if (next) addAncestorChain(next.id);
  };
  addNextNonDescendant(current.id);
  let ancestor = current.parent_candidate_id;
  while (ancestor) {
    addNextNonDescendant(ancestor);
    ancestor = byId.get(ancestor)?.parent_candidate_id ?? null;
  }
  return ids;
}

export function resolveAllHeadingCursors(
  ordered: DraftStructureCandidate[],
  pages: DraftPageEvidence[],
  limitToIds?: ReadonlySet<string>,
): Map<string, HeadingResolution> {
  const indexedPages = indexDraftPages(pages);
  const out = new Map<string, HeadingResolution>();
  const recover = limitToIds
    ? ordered.filter((row) => limitToIds.has(row.id))
    : ordered;
  for (const row of ordered) {
    const persisted = persistedStartCursor(row);
    if (persisted) out.set(row.id, { cursor: persisted, status: 'persisted' });
  }
  let changed = true;
  let guard = 0;
  while (changed && guard < recover.length + 2) {
    changed = false;
    guard += 1;
    for (const row of recover) {
      if (out.has(row.id)) continue;
      const resolution = tryRecoverHeading(row, ordered, indexedPages, out);
      if (resolution.status === 'recovered' || resolution.status === 'ocr_gap') {
        out.set(row.id, resolution);
        changed = true;
      }
    }
  }
  for (const row of recover) {
    if (out.has(row.id)) continue;
    out.set(row.id, tryRecoverHeading(row, ordered, indexedPages, out));
  }
  return out;
}

function pageItems(page: DraftPageEvidence): Array<{ i: number; s: string }> {
  const layout = parseStoredPageLayout(page.page_text_items);
  if (!layout?.items.length) return [];
  return layout.items
    .map((item) => ({ i: item.i, s: item.s }))
    .sort((a, b) => a.i - b.i);
}

function extractFromPages(
  pages: DraftPageEvidence[],
  from: SourceCursor,
  until: SourceCursor | null,
  options: { allowPageTextFallback?: boolean } = {},
): { text: string; usedItems: boolean; ocrGap: boolean } {
  const byPage = new Map(pages.map((page) => [page.page_no, page]));
  const lastPage = pages.reduce((max, page) => Math.max(max, page.page_no), from.page);
  const endPage = until ? until.page : lastPage;
  const parts: string[] = [];
  let usedItems = false;
  let ocrGap = false;
  for (let pageNo = from.page; pageNo <= endPage; pageNo += 1) {
    const page = byPage.get(pageNo);
    if (!page) continue;
    const items = pageItems(page);
    if (page.status === 'needs_ocr' || page.status === 'skipped_needs_ocr') {
      ocrGap = true;
      if (!items.length) continue;
    }
    if (items.length) {
      usedItems = true;
      const minI = pageNo === from.page ? from.item : Number.NEGATIVE_INFINITY;
      const maxI = until && pageNo === until.page ? until.item : Number.POSITIVE_INFINITY;
      const slice = items.filter((item) => item.i >= minI && item.i < maxI).map((item) => item.s.trim()).filter(Boolean);
      if (slice.length) parts.push(slice.join(' '));
      continue;
    }
    if (options.allowPageTextFallback && typeof page.page_text === 'string' && page.page_text.trim()) {
      const wholePage = from.item === 0 && (!until || until.page !== pageNo || until.item === 0);
      if (wholePage || pageNo !== from.page) parts.push(page.page_text.trim());
    }
  }
  return {
    text: parts.join('\n').replace(/[ \t]{2,}/g, ' ').trim(),
    usedItems,
    ocrGap,
  };
}

function emptyCapture(
  current: DraftStructureCandidate,
  headingStatus: HeadingResolutionStatus,
  nextNonDescendantId: string | null,
  firstDescendantId: string | null,
): CapturedSourceBody {
  return {
    text: '',
    boundary_status: 'uncertain',
    page_start: current.page_start,
    page_end: current.page_end,
    item_start: null,
    item_end: null,
    line_start: current.source_line_index,
    line_end: null,
    heading_status: headingStatus,
    next_non_descendant_id: nextNonDescendantId,
    first_descendant_id: firstDescendantId,
    subtree_text: '',
    subtree_page_end: current.page_end,
    subtree_item_end: null,
    subtree_line_start: current.source_line_index,
    subtree_line_end: null,
  };
}

export function persistableMonotonicIndex(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return end;
  return end >= start ? end : null;
}

function spanEnd(
  start: SourceCursor,
  until: SourceCursor | null,
  pages: DraftPageEvidence[],
): { page_end: number; item_end: number | null } {
  if (!until) {
    return {
      page_end: pages.reduce((max, page) => Math.max(max, page.page_no), start.page),
      item_end: null,
    };
  }
  if (until.page === start.page) {
    return {
      page_end: until.page,
      item_end: Math.max(until.item - 1, start.item),
    };
  }
  if (until.item <= 0) {
    return {
      page_end: Math.max(until.page - 1, start.page),
      item_end: null,
    };
  }
  return {
    page_end: until.page,
    item_end: persistableMonotonicIndex(start.item, until.item - 1),
  };
}

export function captureExclusiveSourceBody(
  current: DraftStructureCandidate,
  ordered: DraftStructureCandidate[],
  pages: DraftPageEvidence[],
  resolutions?: Map<string, HeadingResolution>,
): CapturedSourceBody {
  const resolved =
    resolutions ??
    resolveAllHeadingCursors(ordered, pages, headingIdsRequiredForCapture(current, ordered));
  const heading = resolved.get(current.id) ?? tryRecoverHeading(
    current,
    ordered,
    indexDraftPages(pages),
    resolved,
  );
  const firstDescendant = firstDescendantBoundaryCandidate(ordered, current.id);
  const nextNonDescendant = nextNonDescendantBoundaryCandidate(ordered, current.id);
  const firstDescendantId = firstDescendant?.id ?? null;
  const nextNonDescendantId = nextNonDescendant?.id ?? null;
  if (!heading.cursor) {
    return emptyCapture(current, heading.status, nextNonDescendantId, firstDescendantId);
  }

  const ownUntilCandidate = firstDescendant ?? nextNonDescendant;
  const ownUntil = ownUntilCandidate ? resolved.get(ownUntilCandidate.id)?.cursor ?? null : null;
  const subtreeUntil = nextNonDescendant ? resolved.get(nextNonDescendant.id)?.cursor ?? null : null;
  const missingOwnEnd = Boolean(ownUntilCandidate) && !ownUntil;
  const missingSubtreeEnd = Boolean(nextNonDescendant) && !subtreeUntil;

  const ownExtract = missingOwnEnd
    ? { text: '', usedItems: false, ocrGap: heading.status === 'ocr_gap' }
    : extractFromPages(pages, heading.cursor, ownUntil);
  const subtreeExtract = missingSubtreeEnd
    ? { text: '', usedItems: false, ocrGap: heading.status === 'ocr_gap' }
    : extractFromPages(pages, heading.cursor, subtreeUntil);

  const certain =
    heading.cursor.certain &&
    heading.status !== 'ocr_gap' &&
    heading.status !== 'ambiguous' &&
    heading.status !== 'missing' &&
    !missingOwnEnd &&
    ownExtract.usedItems &&
    !ownExtract.ocrGap &&
    Boolean(ownUntil?.certain || !ownUntilCandidate);

  const ownSpan = spanEnd(heading.cursor, ownUntil, pages);
  const subtreeSpan = spanEnd(heading.cursor, subtreeUntil, pages);
  return {
    text: ownExtract.text,
    boundary_status: certain ? 'certain' : 'uncertain',
    page_start: heading.cursor.page,
    page_end: ownSpan.page_end,
    item_start: heading.cursor.item,
    item_end: ownSpan.item_end,
    line_start: current.source_line_index,
    line_end: ownUntilCandidate?.source_line_index ?? null,
    heading_status: heading.status,
    next_non_descendant_id: nextNonDescendantId,
    first_descendant_id: firstDescendantId,
    subtree_text: subtreeExtract.text,
    subtree_page_end: subtreeSpan.page_end,
    subtree_item_end: subtreeSpan.item_end,
    subtree_line_start: current.source_line_index,
    subtree_line_end: nextNonDescendant?.source_line_index ?? null,
  };
}

export function captureOwnerDefinedSourceBody(
  range: {
    page_start: number;
    page_end: number;
    item_start: number | null;
    item_end: number | null;
  },
  pages: DraftPageEvidence[],
): string {
  const from: SourceCursor = {
    page: range.page_start,
    item: range.item_start ?? 0,
    certain: range.item_start != null,
  };
  const until: SourceCursor | null =
    range.item_end == null
      ? range.page_end === range.page_start
        ? null
        : { page: range.page_end + 1, item: 0, certain: false }
      : { page: range.page_end, item: range.item_end + 1, certain: true };
  return extractFromPages(pages, from, until, { allowPageTextFallback: true }).text;
}

export function draftWouldCycle(draftId: string, newParentId: string | null, rows: DraftParentRow[]): boolean {
  if (!newParentId) return false;
  if (newParentId === draftId) return true;
  const byId = new Map(rows.map((row) => [row.id, row]));
  let walk: string | null = newParentId;
  const seen = new Set<string>();
  while (walk) {
    if (walk === draftId) return true;
    if (seen.has(walk)) return true;
    seen.add(walk);
    walk = byId.get(walk)?.parent_draft_id ?? null;
  }
  return false;
}

export function reparentScopeError(
  draft: { id: string; document_id: string; country_code: string },
  parent: DraftParentRow | null,
): string | null {
  if (!parent) return null;
  if (parent.country_code !== draft.country_code) return 'Parent draft must belong to the same country';
  if (parent.document_id !== draft.document_id) return 'Parent draft must belong to the same document';
  return null;
}

export function hierarchyRankCompatible(
  childKind: string | null,
  parentKind: string | null,
  catalog: StructureKindCatalogItem[],
): boolean {
  if (!parentKind) return !isFineGrainedStructureKind(childKind);
  if (!catalog.length) return true;
  const childRank = catalogRankForLabel(childKind, catalog);
  const parentRank = catalogRankForLabel(parentKind, catalog);
  return parentRank < childRank;
}

export function validateDraftReady(input: {
  source_display_identifier: string | null;
  kind_label: string | null;
  parent_draft_id: string | null;
  draft_legal_text: string;
  original_source_text: string;
  text_boundary_status: string;
  identityConflict: boolean;
  hierarchyCompatible: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (!input.kind_label?.trim()) return { ok: false, message: 'Structure type is required before ready' };
  if (!input.source_display_identifier?.trim()) {
    return { ok: false, message: 'Legal identifier is required before ready' };
  }
  if (input.identityConflict) {
    return { ok: false, message: 'Exact legal identifier already exists under this parent' };
  }
  if (!input.hierarchyCompatible) {
    return { ok: false, message: 'Parent hierarchy is not valid for this structure type' };
  }
  if (input.text_boundary_status === 'uncertain') {
    return { ok: false, message: 'Uncertain source boundary cannot become ready' };
  }
  const draftText = input.draft_legal_text.trim();
  if (!draftText) {
    if (input.original_source_text.trim()) {
      return { ok: false, message: 'Draft legal text is empty' };
    }
    if (input.text_boundary_status !== 'owner_defined') {
      return { ok: false, message: 'Empty source text cannot become ready until Owner confirms the boundary' };
    }
  }
  return { ok: true };
}

export function notesOverlappingDraftSpan(
  notes: DraftNoteEvidence[],
  span: { page_start: number | null; page_end: number | null; item_start: number | null; item_end: number | null },
): DraftNoteEvidence[] {
  const fromPage = span.page_start;
  const toPage = span.page_end ?? span.page_start;
  if (fromPage == null || toPage == null) return [];
  return notes.filter((note) => {
    if (note.source_page < fromPage || note.source_page > toPage) return false;
    if (span.item_start == null || span.item_end == null || note.source_item_start == null) return true;
    if (note.source_page === fromPage && note.source_item_start < span.item_start) return false;
    if (note.source_page === toPage && note.source_item_start > span.item_end) return false;
    return true;
  });
}

export function displayDraftLabel(row: {
  kind_label: string | null;
  source_display_identifier: string | null;
  title: string | null;
}): string {
  return [row.kind_label, row.source_display_identifier, row.title].filter((part) => part && String(part).trim()).join(' ').trim();
}

export function createDraftRequiresParentFirst(
  parentCandidateId: string | null,
  parentDraftId: string | null,
): boolean {
  return Boolean(parentCandidateId) && !parentDraftId;
}
