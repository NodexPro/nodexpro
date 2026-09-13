import {
  countNavigationGoTokens,
  isYearLikeIdentifier,
  parseNumericIdentifier,
  usableKindCatalog,
} from './knowledge-trainer.pure.js';
import type {
  KnowledgeTrainerCandidateDto,
  StructureKindCatalogItem,
  StructureReviewClass,
  StructureReviewFilterDto,
  StructureReviewSummaryDto,
  StructureReviewTreeNodeDto,
} from './knowledge-trainer.types.js';

export const STRUCTURE_REVIEW_CLASS_LABELS: Record<StructureReviewClass, string> = {
  high_confidence: 'High confidence',
  needs_owner_review: 'Needs owner review',
  rejected_technical: 'Rejected technical / non-structure',
};

const REVIEW_FILTER_LABELS: Record<StructureReviewFilterDto['key'], string> = {
  all: 'All',
  high_confidence: 'High confidence',
  needs_review: 'Needs review',
  ocr_affected: 'OCR affected',
  rejected: 'Rejected',
};

const GLOBAL_OCR_WARNING = 'ocr_pages_may_affect_hierarchy';
const SUSPICIOUS_SECTION_CEILING = 400;
const IMPLAUSIBLE_SEIF_SPAN = 15;

export type StructureReviewContext = {
  catalog: StructureKindCatalogItem[];
  ocr_pages: number[];
};

export function emptyStructureReviewSummary(): StructureReviewSummaryDto {
  return {
    all: 0,
    high_confidence: 0,
    needs_owner_review: 0,
    ocr_affected: 0,
    rejected_technical: 0,
    already_rejected: 0,
    already_accepted: 0,
    by_kind: {},
  };
}

export function candidateDisplayLabel(candidate: {
  kind_label: string | null;
  node_number: string | null;
  title: string | null;
}): string {
  return [candidate.kind_label, candidate.node_number, candidate.title].filter(Boolean).join(' ').trim();
}

export function catalogRankForLabel(label: string | null, catalog: StructureKindCatalogItem[]): number {
  const usable = usableKindCatalog(catalog);
  const kind = (label ?? '').trim();
  if (!kind) return usable.length;
  if (/תוספת/.test(kind)) return 0;
  const index = usable.findIndex((item) => item.label === kind);
  return index >= 0 ? index : usable.length;
}

export function isFineGrainedStructureKind(label: string | null): boolean {
  return /קטן|פסקה/.test(label ?? '');
}

export function pageRangeOverlapsOcr(
  pageStart: number | null,
  pageEnd: number | null,
  ocrPages: number[],
): boolean {
  if (pageStart == null || !ocrPages.length) return false;
  const from = Math.min(pageStart, pageEnd ?? pageStart);
  const to = Math.max(pageStart, pageEnd ?? pageStart);
  return ocrPages.some((page) => page >= from && page <= to);
}

function containerTitleLooksSuspicious(kindLabel: string | null, title: string | null): boolean {
  if (isFineGrainedStructureKind(kindLabel) || /סעיף/.test(kindLabel ?? '')) return false;
  if (!title || title.trim().length < 2) return true;
  const value = title.trim();
  if (/^\(|^,\s*|^\d{4}/.test(value)) return true;
  if (/לא יחולו|, והוראות/.test(value)) return true;
  if (value.length > 60 && /\d{4}/.test(value)) return true;
  return false;
}

function isRootCapableKind(label: string | null, catalog: StructureKindCatalogItem[]): boolean {
  return catalogRankForLabel(label, catalog) === 0;
}

export function attachStructureReviewModel(
  candidates: Array<Omit<
    KnowledgeTrainerCandidateDto,
    | 'review_class'
    | 'review_class_label'
    | 'ocr_affected'
    | 'review_warnings'
    | 'display_warnings'
    | 'parent_label'
    | 'hierarchy_path'
    | 'hierarchy_valid'
  >>,
  ctx: StructureReviewContext,
): {
  candidates: KnowledgeTrainerCandidateDto[];
  review_summary: StructureReviewSummaryDto;
  review_filters: StructureReviewFilterDto[];
  structure_tree: StructureReviewTreeNodeDto[];
} {
  const byId = new Map(candidates.map((row) => [row.id, row]));
  const classified = candidates.map((row) => classifyOne(row, byId, ctx));
  return {
    candidates: classified,
    review_summary: summarizeStructureReview(classified),
    review_filters: buildStructureReviewFilters(classified),
    structure_tree: buildStructureReviewTree(classified),
  };
}

function classifyOne(
  candidate: Omit<
    KnowledgeTrainerCandidateDto,
    | 'review_class'
    | 'review_class_label'
    | 'ocr_affected'
    | 'review_warnings'
    | 'display_warnings'
    | 'parent_label'
    | 'hierarchy_path'
    | 'hierarchy_valid'
  >,
  byId: Map<string, (typeof candidate)>,
  ctx: StructureReviewContext,
): KnowledgeTrainerCandidateDto {
  const parent = candidate.parent_candidate_id ? byId.get(candidate.parent_candidate_id) ?? null : null;
  const reviewWarnings: string[] = [];
  const ocrAffected = pageRangeOverlapsOcr(candidate.page_start, candidate.page_end, ctx.ocr_pages);
  if (ocrAffected) reviewWarnings.push('page_range_crosses_ocr');

  const goTokens = countNavigationGoTokens(`${candidate.excerpt ?? ''} ${candidate.title ?? ''}`);
  if (goTokens >= 1) reviewWarnings.push('navigation_or_toc_artifact');

  const yearLike = Boolean(candidate.node_number && isYearLikeIdentifier(candidate.node_number));
  if (yearLike && /סעיף/.test(candidate.kind_label ?? '')) {
    reviewWarnings.push('amendment_year_identifier');
  }

  const numericId = parseNumericIdentifier(candidate.node_number);
  if (numericId != null && numericId > SUSPICIOUS_SECTION_CEILING && /סעיף/.test(candidate.kind_label ?? '') && !isFineGrainedStructureKind(candidate.kind_label)) {
    reviewWarnings.push('suspicious_section_number');
  }

  if (containerTitleLooksSuspicious(candidate.kind_label, candidate.title)) {
    reviewWarnings.push('suspicious_container_title');
  }

  const span =
    candidate.page_start != null && candidate.page_end != null
      ? Math.abs(candidate.page_end - candidate.page_start)
      : 0;
  if (
    span > IMPLAUSIBLE_SEIF_SPAN &&
    /סעיף/.test(candidate.kind_label ?? '') &&
    !isFineGrainedStructureKind(candidate.kind_label)
  ) {
    reviewWarnings.push('page_range_implausible');
  }

  const usableCatalog = usableKindCatalog(ctx.catalog);
  const childRank = catalogRankForLabel(candidate.kind_label, ctx.catalog);
  const parentRank = parent ? catalogRankForLabel(parent.kind_label, ctx.catalog) : null;
  let hierarchyValid = true;
  if (!usableCatalog.length) {
    hierarchyValid = true;
  } else if (!parent) {
    hierarchyValid = isRootCapableKind(candidate.kind_label, ctx.catalog);
    if (!hierarchyValid && !candidate.validation_warnings.includes('unresolved_parent')) {
      reviewWarnings.push('unresolved_parent');
    }
  } else if (parentRank != null && parentRank >= childRank) {
    hierarchyValid = false;
    reviewWarnings.push('hierarchy_rank_mismatch');
  }

  if (isFineGrainedStructureKind(candidate.kind_label)) {
    reviewWarnings.push('subsection_or_paragraph_needs_owner_review');
  }

  const persisted = candidate.validation_warnings;
  const technical =
    goTokens >= 1 ||
    persisted.includes('toc_or_merged_heading') ||
    reviewWarnings.includes('amendment_year_identifier') ||
    reviewWarnings.includes('navigation_or_toc_artifact');

  const needsOwner =
    !technical &&
    (ocrAffected ||
      isFineGrainedStructureKind(candidate.kind_label) ||
      (candidate.confidence != null && candidate.confidence < 0.55) ||
      persisted.includes('sequence_anomaly') ||
      persisted.includes('duplicate_sibling_identifier') ||
      persisted.includes('duplicate_candidate') ||
      persisted.includes('unresolved_parent') ||
      persisted.includes('invalid_parent_candidate') ||
      persisted.includes('hierarchy_cycle') ||
      persisted.includes('possible_existing_canonical_node') ||
      reviewWarnings.includes('suspicious_section_number') ||
      reviewWarnings.includes('suspicious_container_title') ||
      reviewWarnings.includes('page_range_implausible') ||
      reviewWarnings.includes('hierarchy_rank_mismatch') ||
      !hierarchyValid);

  const reviewClass: StructureReviewClass = technical
    ? 'rejected_technical'
    : needsOwner
      ? 'needs_owner_review'
      : 'high_confidence';

  const displayWarnings = uniqueStrings([
    ...persisted.filter((warning) => warning !== GLOBAL_OCR_WARNING || ocrAffected),
    ...reviewWarnings,
  ]);

  return {
    ...candidate,
    review_class: reviewClass,
    review_class_label: STRUCTURE_REVIEW_CLASS_LABELS[reviewClass],
    ocr_affected: ocrAffected,
    review_warnings: uniqueStrings(reviewWarnings),
    display_warnings: displayWarnings,
    parent_label: parent ? candidateDisplayLabel(parent) : null,
    hierarchy_path: buildHierarchyPath(candidate, byId),
    hierarchy_valid: hierarchyValid,
  };
}

function buildHierarchyPath(
  candidate: { id: string; parent_candidate_id: string | null; kind_label: string | null; node_number: string | null; title: string | null },
  byId: Map<string, { id: string; parent_candidate_id: string | null; kind_label: string | null; node_number: string | null; title: string | null }>,
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: typeof candidate | null = candidate;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(candidateDisplayLabel(current));
    current = current.parent_candidate_id ? byId.get(current.parent_candidate_id) ?? null : null;
  }
  return parts.filter(Boolean).join(' › ');
}

export function buildStructureReviewTree(
  candidates: Array<{ id: string; parent_candidate_id: string | null }>,
): StructureReviewTreeNodeDto[] {
  const ids = new Set(candidates.map((row) => row.id));
  const children = new Map<string | null, string[]>();
  for (const row of candidates) {
    const parentId = row.parent_candidate_id && ids.has(row.parent_candidate_id) ? row.parent_candidate_id : null;
    const list = children.get(parentId) ?? [];
    list.push(row.id);
    children.set(parentId, list);
  }
  const toNode = (id: string): StructureReviewTreeNodeDto => ({
    candidate_id: id,
    children: (children.get(id) ?? []).map(toNode),
  });
  return (children.get(null) ?? []).map(toNode);
}

export function summarizeStructureReview(
  candidates: Array<Pick<KnowledgeTrainerCandidateDto, 'review_class' | 'ocr_affected' | 'candidate_status' | 'kind_label'>>,
): StructureReviewSummaryDto {
  const byKind: Record<string, number> = {};
  for (const row of candidates) {
    const kind = row.kind_label || 'unknown';
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return {
    all: candidates.length,
    high_confidence: candidates.filter((row) => row.review_class === 'high_confidence').length,
    needs_owner_review: candidates.filter((row) => row.review_class === 'needs_owner_review').length,
    ocr_affected: candidates.filter((row) => row.ocr_affected).length,
    rejected_technical: candidates.filter((row) => row.review_class === 'rejected_technical').length,
    already_rejected: candidates.filter((row) => row.candidate_status === 'rejected').length,
    already_accepted: candidates.filter((row) => row.candidate_status === 'accepted').length,
    by_kind: byKind,
  };
}

export function buildStructureReviewFilters(
  candidates: Array<Pick<KnowledgeTrainerCandidateDto, 'review_class' | 'ocr_affected' | 'candidate_status'>>,
): StructureReviewFilterDto[] {
  const summary = summarizeStructureReview(
    candidates.map((row) => ({ ...row, kind_label: null })),
  );
  return [
    { key: 'all', label: REVIEW_FILTER_LABELS.all, count: summary.all },
    { key: 'high_confidence', label: REVIEW_FILTER_LABELS.high_confidence, count: summary.high_confidence },
    {
      key: 'needs_review',
      label: REVIEW_FILTER_LABELS.needs_review,
      count: summary.needs_owner_review,
    },
    { key: 'ocr_affected', label: REVIEW_FILTER_LABELS.ocr_affected, count: summary.ocr_affected },
    {
      key: 'rejected',
      label: REVIEW_FILTER_LABELS.rejected,
      count: candidates.filter(
        (row) => row.review_class === 'rejected_technical' || row.candidate_status === 'rejected',
      ).length,
    },
  ];
}

export function candidateMatchesReviewFilter(
  candidate: Pick<KnowledgeTrainerCandidateDto, 'review_class' | 'ocr_affected' | 'candidate_status'>,
  filter: StructureReviewFilterDto['key'],
): boolean {
  if (filter === 'all') return true;
  if (filter === 'high_confidence') {
    return candidate.review_class === 'high_confidence' && candidate.candidate_status !== 'rejected';
  }
  if (filter === 'needs_review') return candidate.review_class === 'needs_owner_review';
  if (filter === 'ocr_affected') return candidate.ocr_affected;
  return candidate.review_class === 'rejected_technical' || candidate.candidate_status === 'rejected';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
