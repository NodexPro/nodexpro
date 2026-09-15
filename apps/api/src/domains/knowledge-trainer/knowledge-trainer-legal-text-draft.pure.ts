import { catalogRankForLabel, isFineGrainedStructureKind } from './knowledge-trainer-review.pure.js';
import { parseStoredPageLayout } from './knowledge-trainer-layout.pure.js';
import type { SourceBBox, StructureKindCatalogItem } from './knowledge-trainer.types.js';

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

export type CapturedSourceBody = {
  text: string;
  boundary_status: Exclude<LegalTextDraftBoundaryStatus, 'owner_defined'>;
  page_start: number | null;
  page_end: number | null;
  item_start: number | null;
  item_end: number | null;
  line_start: number | null;
  line_end: number | null;
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

export function candidateStartCursor(candidate: DraftStructureCandidate): SourceCursor | null {
  if (candidate.source_page != null && candidate.source_page > 0 && candidate.source_item_start != null) {
    return { page: candidate.source_page, item: candidate.source_item_start, certain: true };
  }
  if (candidate.page_start != null && candidate.page_start > 0) {
    return { page: candidate.page_start, item: 0, certain: false };
  }
  return null;
}

export function nextExclusiveBoundaryCandidate(
  ordered: DraftStructureCandidate[],
  currentId: string,
): DraftStructureCandidate | null {
  const index = ordered.findIndex((row) => row.id === currentId);
  if (index < 0) return null;
  return ordered[index + 1] ?? null;
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
    if (page.status === 'needs_ocr' && !page.page_text && pageItems(page).length === 0) {
      ocrGap = true;
      continue;
    }
    const items = pageItems(page);
    if (items.length) {
      usedItems = true;
      const minI = pageNo === from.page ? from.item : Number.NEGATIVE_INFINITY;
      const maxI = until && pageNo === until.page ? until.item : Number.POSITIVE_INFINITY;
      const slice = items.filter((item) => item.i >= minI && item.i < maxI).map((item) => item.s.trim()).filter(Boolean);
      if (slice.length) parts.push(slice.join(' '));
      continue;
    }
    if (typeof page.page_text === 'string' && page.page_text.trim()) {
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

export function captureExclusiveSourceBody(
  current: DraftStructureCandidate,
  ordered: DraftStructureCandidate[],
  pages: DraftPageEvidence[],
): CapturedSourceBody {
  const start = candidateStartCursor(current);
  const next = nextExclusiveBoundaryCandidate(ordered, current.id);
  const until = next ? candidateStartCursor(next) : null;
  if (!start) {
    return {
      text: '',
      boundary_status: 'uncertain',
      page_start: current.page_start,
      page_end: current.page_end,
      item_start: null,
      item_end: null,
      line_start: current.source_line_index,
      line_end: null,
    };
  }
  const extracted = extractFromPages(pages, start, until);
  const certain =
    start.certain &&
    Boolean(until?.certain || (!next && extracted.usedItems)) &&
    extracted.usedItems &&
    !extracted.ocrGap;
  return {
    text: extracted.text,
    boundary_status: certain ? 'certain' : 'uncertain',
    page_start: start.page,
    page_end: until ? until.page : pages.reduce((max, page) => Math.max(max, page.page_no), start.page),
    item_start: start.item,
    item_end: until && until.page === start.page ? Math.max(until.item - 1, start.item) : until ? until.item : null,
    line_start: current.source_line_index,
    line_end: next?.source_line_index ?? null,
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
  return extractFromPages(pages, from, until).text;
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
