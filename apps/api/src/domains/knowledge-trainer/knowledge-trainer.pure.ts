import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_TRAINER_PROVENANCE_TYPES,
  LEGAL_INGESTION_CANDIDATE_KINDS,
  LEGAL_INGESTION_INPUT_TYPES,
  OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  OWNER_LEGAL_MATERIAL_SIGNED_URL_REFRESH_SKEW_SEC,
  OWNER_LEGAL_MATERIALS_MAX_BYTES,
  V1_ENABLED_INPUT_TYPE,
  V1_PDF_MIME,
  type ExtractedPageText,
  type KnowledgeTrainerInputOptionDto,
  type OriginalFileAccessDto,
  type LegalIngestionInputType,
  type StructureCandidateDraft,
  type StructureDetectionAnalysis,
  type StructureKindCatalogItem,
} from './knowledge-trainer.types.js';

const PDF_MAGIC = Buffer.from('%PDF');

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sanitizeOriginalFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : '';
  const base = raw.replace(/[/\\]/g, '').replace(/\0/g, '').slice(0, 240);
  return base || 'legal-material.pdf';
}

export function buildRandomizedStorageKey(countryCode: string, taxSourceId: string, documentId: string): string {
  return `${countryCode.toUpperCase()}/${taxSourceId}/${documentId}`;
}

export function trainerInputOptions(v1Enabled: boolean): KnowledgeTrainerInputOptionDto[] {
  return [
    {
      input_type: 'pdf',
      available: v1Enabled,
      label: 'PDF',
      status_label: v1Enabled ? 'Available' : 'Coming next',
    },
    {
      input_type: 'image',
      available: false,
      label: 'Photos',
      status_label: 'Coming next',
    },
    {
      input_type: 'text',
      available: false,
      label: 'Text',
      status_label: 'Coming next',
    },
  ];
}

export function assertV1PdfUpload(input: {
  input_type: unknown;
  mime_type: unknown;
  bytes: Buffer;
}): { input_type: 'pdf'; mime_type: typeof V1_PDF_MIME } {
  const inputType = typeof input.input_type === 'string' ? input.input_type.trim() : V1_ENABLED_INPUT_TYPE;
  if (inputType !== 'pdf') {
    throw Object.assign(new Error('V1 accepts selectable-text PDF only'), { code: 'UNSUPPORTED_INPUT_TYPE' });
  }
  const mime = typeof input.mime_type === 'string' ? input.mime_type.trim().toLowerCase() : '';
  if (mime !== V1_PDF_MIME) {
    throw Object.assign(new Error('Unsupported MIME type'), { code: 'UNSUPPORTED_MIME' });
  }
  if (input.bytes.length > OWNER_LEGAL_MATERIALS_MAX_BYTES) {
    throw Object.assign(new Error('File too large'), { code: 'FILE_TOO_LARGE' });
  }
  if (input.bytes.length < 5 || !input.bytes.subarray(0, 4).equals(PDF_MAGIC)) {
    throw Object.assign(new Error('File is not a PDF'), { code: 'INVALID_PDF_MAGIC' });
  }
  return { input_type: 'pdf', mime_type: V1_PDF_MIME };
}

export function isKnownInputType(value: unknown): value is LegalIngestionInputType {
  return typeof value === 'string' && (LEGAL_INGESTION_INPUT_TYPES as readonly string[]).includes(value);
}

export function isKnownCandidateKind(value: unknown): boolean {
  return typeof value === 'string' && (LEGAL_INGESTION_CANDIDATE_KINDS as readonly string[]).includes(value);
}

export function isKnownProvenanceType(value: unknown): boolean {
  return typeof value === 'string' && (KNOWLEDGE_TRAINER_PROVENANCE_TYPES as readonly string[]).includes(value);
}

export function pageHasUsableEmbeddedText(text: string | null | undefined): boolean {
  return Boolean(text && text.replace(/\s+/g, '').length > 0);
}

export function jobStatusLabel(status: string): string {
  switch (status) {
    case 'uploaded':
      return 'Uploaded';
    case 'queued':
      return 'Queued';
    case 'extracting':
      return 'Processing';
    case 'partially_extracted':
      return 'Partially extracted';
    case 'ready_for_review':
      return 'Ready for review';
    case 'needs_review':
      return 'Needs review';
    case 'extraction_failed':
      return 'Extraction failed';
    case 'reviewed':
      return 'Reviewed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kindPattern(labels: string[]): string {
  return labels
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((label) => escapeRegExp(label))
    .join('|');
}

/** Linguistic ordinal forms for identifiers — not statute content. */
const ORDINAL_ID = 'ראשון|שנייה|שני|שלישי|רביעי|חמישי|שישי|ששי|שביעי|שמיני|תשיעי|עשירי';
const LETTER_ID = "[א-ת](?:['׳\"]?)";
const NUMERIC_ID = '\\d+[א-ת]?';
const STRUCTURE_ID = `(?:${ORDINAL_ID}|${LETTER_ID}|${NUMERIC_ID})`;

const GO_TOKEN_RE = /\bGo\s+\d+\b/gi;
const TOC_LABEL_RE = /תוכן\s*ענינים|תוכן\s*העניינים|מפתח\s*עניינים/i;

export function parseNumericIdentifier(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

export function countNavigationGoTokens(text: string): number {
  return text.match(GO_TOKEN_RE)?.length ?? 0;
}

export function isTocOrIndexPage(text: string, catalogLabels: string[]): boolean {
  const goCount = countNavigationGoTokens(text);
  if (TOC_LABEL_RE.test(text)) return true;
  if (goCount >= 8) return true;
  if (goCount >= 2) {
    const kindHits = catalogLabels.reduce((sum, label) => {
      const re = new RegExp(escapeRegExp(label), 'g');
      return sum + (text.match(re)?.length ?? 0);
    }, 0);
    if (kindHits >= 8) return true;
  }
  return false;
}

function countKindMentions(text: string, labels: string[]): number {
  return labels.reduce((sum, label) => {
    const re = new RegExp(escapeRegExp(label), 'g');
    return sum + (text.match(re)?.length ?? 0);
  }, 0);
}

/** Drop catalog rows that are already a kind + identifier (e.g. "חלק א"), not a kind. */
export function usableKindCatalog(catalog: StructureKindCatalogItem[]): StructureKindCatalogItem[] {
  const labels = catalog.map((item) => item.label.trim()).filter(Boolean);
  return catalog.filter((item) => {
    const label = item.label.trim();
    if (!label) return false;
    return !labels.some(
      (other) =>
        other !== label &&
        other.length < label.length &&
        new RegExp(`^${escapeRegExp(other)}\\s+${STRUCTURE_ID}$`).test(label),
    );
  });
}

function isPlausibleIdentifier(value: string): boolean {
  const token = value.trim();
  if (!token || token.length > 12) return false;
  return new RegExp(`^(?:${STRUCTURE_ID})$`).test(token);
}

export function isYearLikeIdentifier(value: string): boolean {
  return /^(?:19|20)\d{2}$/.test(value.trim());
}

function looksLikeCrossReferenceAfter(after: string): boolean {
  const window = after.slice(0, 48);
  return /(?:^|\s)(?:לחוק|לפקודה|לפי|או\s+פרק|לפרק|לסימן|לסעיף)/.test(window);
}

function looksLikeCrossReferenceBefore(before: string): boolean {
  const tail = before.slice(-48);
  return /(?:^|[\s,;])(?:לפי|מכוח|כאמור|על\s+פי|כהגדרת\S*|כמשמעות\S*|לענין|בהתאם|בסעיפים|לסעיפים|סעיפים|הוראות)\s*$/.test(
    tail,
  );
}

function looksLikeAmendmentAfter(after: string): boolean {
  return /^\s*\d{0,4}\s*תש/.test(after) || /^\s*\(\s*\d+\s*תיקון/.test(after);
}

function looksLikeTrailingCrossRef(after: string): boolean {
  return /(?:לפי|כאמור|על\s+פי|בהתאם|מכוח)\s+(?:ב)?סעי/.test(after.slice(0, 24));
}

function titleLooksMerged(title: string, labels: string[]): boolean {
  if (countNavigationGoTokens(title) >= 2) return true;
  if ((title.match(/\bGo\s+\d+/gi) || []).length >= 1 && countKindMentions(title, labels) >= 2) return true;
  return countKindMentions(title, labels) >= 2;
}

function cleanOfficialTitle(title: string): string {
  let value = normalizeHeadingText(title);
  value = value.replace(/^\d{4}\s+תש[\u0590-\u05FF"׳'\-–]*.*$/u, '');
  value = value.replace(/\s+\d{4}\s+תש[\u0590-\u05FF"׳'\-–]*.*$/u, '');
  value = value.replace(/\s+\(\s*\d+\s*תיקון.*$/u, '');
  value = value.replace(/(?:\s+ל){2,}$/g, '');
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function containerTitleIsPlausible(kindLabel: string, title: string): boolean {
  if (/סעיף/.test(kindLabel)) return true;
  if (!title || title.length < 2) return false;
  if (/^\(|^,\s*|^\d{4}/.test(title)) return false;
  if (/לא יחולו|, והוראות/.test(title)) return false;
  return /[א-ת]{2,}/.test(title);
}

function cutTitle(raw: string, labels: string[]): string {
  let title = normalizeHeadingText(raw);
  const nextKind = title.search(new RegExp(`(?:^|\\s)(?:${kindPattern(labels)})\\s+${STRUCTURE_ID}`));
  if (nextKind > 0) title = title.slice(0, nextKind);
  const bracket = title.search(/\s\[/);
  if (bracket > 0) title = title.slice(0, bracket);
  const goAt = title.search(/\bGo\s+\d+/i);
  if (goAt >= 0) title = title.slice(0, goAt);
  title = title.replace(/[:'—\-–]+$/g, '').trim();
  return cleanOfficialTitle(title);
}

function titleFromLookback(before: string): string | null {
  const bracket = before.match(/\[\s*\d+\s*\]\s+([א-ת]{2,24})(?=\s|$)/);
  if (bracket?.[1]) return cleanOfficialTitle(bracket[1]);
  return null;
}

type RawHeading = {
  kind_label: string;
  node_number: string | null;
  title: string | null;
  excerpt: string;
  page_no: number;
  offset: number;
  confidence: number;
  warnings: string[];
  rank: number;
};

function rankForKind(label: string, catalog: StructureKindCatalogItem[]): number {
  const index = catalog.findIndex((item) => item.label === label);
  if (/תוספת/.test(label)) return 0;
  return index >= 0 ? index : catalog.length;
}

function alreadyHasHeading(headings: RawHeading[], kindLabel: string, nodeNumber: string, pageNo: number): boolean {
  return headings.some(
    (row) => row.kind_label === kindLabel && row.node_number === nodeNumber && row.page_no === pageNo,
  );
}

function pushHeading(headings: RawHeading[], heading: RawHeading): void {
  if (!heading.node_number || alreadyHasHeading(headings, heading.kind_label, heading.node_number, heading.page_no)) {
    return;
  }
  headings.push(heading);
}

function scanHeadingsOnPage(
  page: ExtractedPageText,
  catalog: StructureKindCatalogItem[],
  labels: string[],
): { headings: RawHeading[]; tocRejected: number } {
  const text = page.text ?? '';
  if (!text.trim()) return { headings: [], tocRejected: 0 };
  if (isTocOrIndexPage(text, labels)) {
    const rejected = Math.max(countKindMentions(text, labels), countNavigationGoTokens(text));
    return { headings: [], tocRejected: rejected };
  }

  const headings: RawHeading[] = [];
  let tocRejected = 0;
  const kindRe = new RegExp(`(?<![א-תA-Za-z0-9])(${kindPattern(labels)})\\s+(${STRUCTURE_ID})(?=\\s|[:'—\\-–]|$)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = kindRe.exec(text))) {
    const kindLabel = match[1];
    const nodeNumber = match[2].replace(/[.:]$/, '');
    if (!isPlausibleIdentifier(nodeNumber)) continue;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (looksLikeCrossReferenceAfter(after) || looksLikeCrossReferenceBefore(before)) continue;
    if (isYearLikeIdentifier(nodeNumber) && looksLikeAmendmentAfter(after)) continue;
    if (/\bGo\s+\d+/i.test(after.slice(0, 80))) {
      tocRejected += 1;
      continue;
    }
    const title = cutTitle(after.replace(/^\s*[:'—\-–]\s*/, ' '), labels);
    if (titleLooksMerged(title, labels) || countNavigationGoTokens(`${kindLabel} ${nodeNumber} ${title}`) >= 1) {
      continue;
    }
    if (title.length > 70) continue;
    if (!containerTitleIsPlausible(kindLabel, title)) continue;
    const excerpt = normalizeHeadingText(`${kindLabel} ${nodeNumber}${title ? ` ${title}` : ''}`).slice(0, 200);
    const strong = /[:'—]/.test(match[0] + after.slice(0, 3)) && title.length > 0 && title.length <= 40;
    pushHeading(headings, {
      kind_label: kindLabel,
      node_number: nodeNumber,
      title: title || null,
      excerpt,
      page_no: page.page_no,
      offset: match.index,
      confidence: strong ? 0.9 : title ? 0.68 : 0.5,
      warnings: [],
      rank: rankForKind(kindLabel, catalog),
    });
  }

  const seifLabel = labels.find((label) => label === 'סעיף') ?? labels.find((label) => /סעיף/.test(label) && !/קטן/.test(label));
  if (seifLabel) {
    const seifRe = new RegExp(`(?<![א-תA-Za-z0-9])${escapeRegExp(seifLabel)}\\s+(${NUMERIC_ID})(?=\\s|[:'—\\-–]|$)`, 'g');
    let seifMatch: RegExpExecArray | null;
    while ((seifMatch = seifRe.exec(text))) {
      const nodeNumber = seifMatch[1];
      const before = text.slice(0, seifMatch.index);
      const after = text.slice(seifMatch.index + seifMatch[0].length);
      if (looksLikeCrossReferenceAfter(after) || looksLikeCrossReferenceBefore(before)) continue;
      if (isYearLikeIdentifier(nodeNumber) && looksLikeAmendmentAfter(after)) continue;
      if (/\bGo\s+\d+/i.test(after.slice(0, 80))) continue;
      const title = cutTitle(after.replace(/^\s*[:'—\-–]\s*/, ' '), labels);
      if (titleLooksMerged(title, labels) || title.length > 70) continue;
      pushHeading(headings, {
        kind_label: seifLabel,
        node_number: nodeNumber,
        title: title || null,
        excerpt: normalizeHeadingText(`${seifLabel} ${nodeNumber}${title ? ` ${title}` : ''}`).slice(0, 200),
        page_no: page.page_no,
        offset: seifMatch.index,
        confidence: title ? 0.68 : 0.5,
        warnings: [],
        rank: rankForKind(seifLabel, catalog),
      });
    }

    const letterDotRe = /(?<![א-תA-Za-z0-9])([א-ת])\.\s+(\d{1,3})(?=\s|$)/g;
    let letterDot: RegExpExecArray | null;
    while ((letterDot = letterDotRe.exec(text))) {
      const before = text.slice(0, letterDot.index);
      const after = text.slice(letterDot.index + letterDot[0].length);
      if (/סעיף\s*קטן|בסעיף|לפי\s+סעיף|מכוח\s+סעיף/.test(before.slice(-24))) continue;
      if (looksLikeCrossReferenceBefore(before) || looksLikeTrailingCrossRef(after)) continue;
      const nodeNumber = `${letterDot[2]}${letterDot[1]}`;
      if (!isPlausibleIdentifier(nodeNumber) || isYearLikeIdentifier(letterDot[2])) continue;
      const title = titleFromLookback(before);
      pushHeading(headings, {
        kind_label: seifLabel,
        node_number: nodeNumber,
        title,
        excerpt: normalizeHeadingText(`${seifLabel} ${nodeNumber}${title ? ` ${title}` : ''}`).slice(0, 200),
        page_no: page.page_no,
        offset: letterDot.index,
        confidence: title ? 0.68 : 0.55,
        warnings: title ? [] : ['bare_numbered_heading'],
        rank: rankForKind(seifLabel, catalog),
      });
    }

    const rtlDotRe = /(?<![א-תA-Za-z0-9])\.\s+(\d{1,3})(?=\s|$)/g;
    let rtlDot: RegExpExecArray | null;
    while ((rtlDot = rtlDotRe.exec(text))) {
      const before = text.slice(0, rtlDot.index);
      const after = text.slice(rtlDot.index + rtlDot[0].length);
      if (looksLikeCrossReferenceBefore(before) || looksLikeCrossReferenceAfter(after) || looksLikeTrailingCrossRef(after)) continue;
      if (/בסעיף|לפי\s+סעיף|מכוח\s+סעיף/.test(before.slice(-24))) continue;
      const nodeNumber = rtlDot[1];
      if (!isPlausibleIdentifier(nodeNumber) || isYearLikeIdentifier(nodeNumber)) continue;
      const title = titleFromLookback(before);
      pushHeading(headings, {
        kind_label: seifLabel,
        node_number: nodeNumber,
        title,
        excerpt: normalizeHeadingText(`${seifLabel} ${nodeNumber}${title ? ` ${title}` : ''}`).slice(0, 200),
        page_no: page.page_no,
        offset: rtlDot.index,
        confidence: title ? 0.72 : 0.55,
        warnings: title ? [] : ['bare_numbered_heading'],
        rank: rankForKind(seifLabel, catalog),
      });
    }

    const ltrDotRe = /(?<![א-תA-Za-z0-9.])(\d{1,3}[א-ת]?)\.(?=\s|$)/g;
    let ltrDot: RegExpExecArray | null;
    while ((ltrDot = ltrDotRe.exec(text))) {
      const before = text.slice(0, ltrDot.index);
      const after = text.slice(ltrDot.index + ltrDot[0].length);
      if (looksLikeCrossReferenceBefore(before) || looksLikeTrailingCrossRef(after)) continue;
      const nodeNumber = ltrDot[1];
      if (!isPlausibleIdentifier(nodeNumber) || isYearLikeIdentifier(nodeNumber)) continue;
      const title = titleFromLookback(before) ?? cutTitle(text.slice(ltrDot.index + ltrDot[0].length).replace(/^\s*[:'—\-–]\s*/, ' '), labels);
      const official = title && title.length <= 40 && !titleLooksMerged(title, labels) ? title : titleFromLookback(before);
      pushHeading(headings, {
        kind_label: seifLabel,
        node_number: nodeNumber,
        title: official || null,
        excerpt: normalizeHeadingText(`${seifLabel} ${nodeNumber}${official ? ` ${official}` : ''}`).slice(0, 200),
        page_no: page.page_no,
        offset: ltrDot.index,
        confidence: official ? 0.72 : 0.55,
        warnings: official ? [] : ['bare_numbered_heading'],
        rank: rankForKind(seifLabel, catalog),
      });
    }
  }

  const katanLabel = labels.find((label) => /קטן/.test(label));
  if (katanLabel && seifLabel) {
    const seifs = headings.filter((row) => row.kind_label === seifLabel).sort((a, b) => a.offset - b.offset);
    for (const seif of seifs) {
      const next = headings.find((row) => row.offset > seif.offset && row.kind_label !== katanLabel);
      const regionEnd = Math.min(seif.offset + 220, next ? next.offset : text.length);
      const region = text.slice(seif.offset, regionEnd);
      const parenRe = /[\(（]\s*([א-ת]|\d+)\s*[\)）]/g;
      let paren: RegExpExecArray | null;
      let taken = 0;
      while ((paren = parenRe.exec(region)) && taken < 6) {
        const around = region.slice(Math.max(0, paren.index - 16), paren.index + 24);
        if (/תיקון|פסקה/.test(around)) continue;
        pushHeading(headings, {
          kind_label: katanLabel,
          node_number: paren[1],
          title: null,
          excerpt: normalizeHeadingText(`(${paren[1]})`).slice(0, 80),
          page_no: page.page_no,
          offset: seif.offset + paren.index,
          confidence: 0.4,
          warnings: ['subsection_needs_context'],
          rank: rankForKind(katanLabel, catalog),
        });
        taken += 1;
      }
    }
  }

  headings.sort((a, b) => a.offset - b.offset);
  return { headings, tocRejected };
}

function attachParents(raw: RawHeading[]): StructureCandidateDraft[] {
  const stack: Array<{ index: number; rank: number; kind_label: string }> = [];
  const drafts: StructureCandidateDraft[] = [];
  for (const heading of raw) {
    while (stack.length && stack[stack.length - 1].rank >= heading.rank) {
      stack.pop();
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    const warnings = [...heading.warnings];
    let parentIndex: number | null = parent ? parent.index : null;
    if (!parent && heading.rank > 0) {
      warnings.push('unresolved_parent');
      parentIndex = null;
    }
    let confidence = heading.confidence;
    let status: StructureCandidateDraft['candidate_status'] = confidence >= 0.85 ? 'proposed' : confidence >= 0.55 ? 'proposed' : 'needs_review';
    if (confidence < 0.55) status = 'needs_review';
    if (warnings.includes('subsection_needs_context') || warnings.includes('unresolved_parent')) {
      status = 'needs_review';
      confidence = Math.min(confidence, 0.45);
    }
    const draft: StructureCandidateDraft = {
      candidate_kind: 'structure',
      candidate_status: status,
      kind_label: heading.kind_label,
      node_number: heading.node_number,
      title: heading.title,
      parent_index: parentIndex,
      page_start: heading.page_no,
      page_end: heading.page_no,
      excerpt: heading.excerpt,
      confidence,
      validation_warnings: warnings,
    };
    const dup = drafts.some(
      (other) =>
        other.kind_label === draft.kind_label &&
        other.node_number === draft.node_number &&
        other.parent_index === draft.parent_index &&
        other.title === draft.title,
    );
    if (dup) continue;
    drafts.push(draft);
    stack.push({ index: drafts.length - 1, rank: heading.rank, kind_label: heading.kind_label });
  }
  for (let i = 0; i < drafts.length - 1; i += 1) {
    if (drafts[i + 1].page_start > drafts[i].page_start) {
      drafts[i].page_end = drafts[i + 1].page_start;
    }
  }
  return drafts;
}

export const STRUCTURE_ANALYSIS_PREFIX = 'v2-analysis:';

export function encodeStructureAnalysis(analysis: StructureDetectionAnalysis): string {
  return `${STRUCTURE_ANALYSIS_PREFIX}${JSON.stringify(analysis)}`;
}

export function decodeStructureAnalysis(raw: string | null | undefined): StructureDetectionAnalysis | null {
  if (!raw || !raw.startsWith(STRUCTURE_ANALYSIS_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(STRUCTURE_ANALYSIS_PREFIX.length)) as StructureDetectionAnalysis;
    return {
      candidates_found: Number(parsed.candidates_found) || 0,
      toc_index_rejected: Number(parsed.toc_index_rejected) || 0,
      low_confidence_count: Number(parsed.low_confidence_count) || 0,
      unresolved_parent_count: Number(parsed.unresolved_parent_count) || 0,
      ocr_pages_untouched: Number(parsed.ocr_pages_untouched) || 0,
      ocr_gap_warning: parsed.ocr_gap_warning === true,
      layout_used: parsed.layout_used === true,
      layout_pages_used: Number(parsed.layout_pages_used) || 0,
    };
  } catch {
    return null;
  }
}

export function emptyStructureAnalysis(): StructureDetectionAnalysis {
  return {
    candidates_found: 0,
    toc_index_rejected: 0,
    low_confidence_count: 0,
    unresolved_parent_count: 0,
    ocr_pages_untouched: 0,
    ocr_gap_warning: false,
    layout_used: false,
    layout_pages_used: 0,
  };
}

export function detectStructureCandidates(
  pages: ExtractedPageText[],
  catalog: StructureKindCatalogItem[],
  opts?: { ocr_page_count?: number },
): { drafts: StructureCandidateDraft[]; analysis: StructureDetectionAnalysis } {
  const usable = usableKindCatalog(catalog);
  const labels = usable.map((item) => item.label.trim()).filter(Boolean);
  if (!labels.length) {
    return { drafts: [], analysis: { ...emptyStructureAnalysis(), ocr_pages_untouched: opts?.ocr_page_count ?? 0 } };
  }
  const collected: RawHeading[] = [];
  let tocRejected = 0;
  for (const page of pages) {
    const { headings, tocRejected: pageRejected } = scanHeadingsOnPage(page, usable, labels);
    tocRejected += pageRejected;
    collected.push(...headings);
  }
  collected.sort((a, b) => a.page_no - b.page_no || a.offset - b.offset);
  const drafts = attachParents(collected);
  const ocrPages = opts?.ocr_page_count ?? 0;
  const analysis: StructureDetectionAnalysis = {
    candidates_found: drafts.length,
    toc_index_rejected: tocRejected,
    low_confidence_count: drafts.filter((row) => row.confidence < 0.55).length,
    unresolved_parent_count: drafts.filter((row) => row.validation_warnings.includes('unresolved_parent')).length,
    ocr_pages_untouched: ocrPages,
    ocr_gap_warning: ocrPages > 0,
    layout_used: false,
    layout_pages_used: 0,
  };
  if (analysis.ocr_gap_warning) {
    for (const draft of drafts) {
      if (!draft.validation_warnings.includes('ocr_pages_may_affect_hierarchy')) {
        draft.validation_warnings.push('ocr_pages_may_affect_hierarchy');
        draft.candidate_status = 'needs_review';
      }
    }
  }
  return { drafts, analysis };
}

/**
 * Deterministic structure headings from extracted page text.
 * Kind labels come from the country catalog — never hardcoded statute titles or numbers.
 * Parentage follows document order and catalog rank, not a universal forced sequence.
 */
export function extractStructureCandidatesFromPages(
  pages: ExtractedPageText[],
  catalog: StructureKindCatalogItem[],
): StructureCandidateDraft[] {
  return detectStructureCandidates(pages, catalog).drafts;
}

export function validateStructureCandidates(
  drafts: StructureCandidateDraft[],
  context: {
    country_code: string;
    tax_source_id: string;
    existing_nodes: Array<{
      id: string;
      tax_source_id: string;
      country_code: string;
      kind_label: string;
      node_number: string | null;
      parent_node_id?: string | null;
      normalized_machine_identifier?: string | null;
      title: string;
    }>;
  },
): StructureCandidateDraft[] {
  const out = drafts.map((draft) => ({
    ...draft,
    validation_warnings: [...draft.validation_warnings],
    candidate_status: draft.candidate_status,
  }));

  const parentByIndex = new Map<number, number | null>();
  out.forEach((draft, index) => parentByIndex.set(index, draft.parent_index));

  for (let i = 0; i < out.length; i += 1) {
    const draft = out[i];
    if (draft.parent_index != null) {
      if (draft.parent_index < 0 || draft.parent_index >= out.length || draft.parent_index === i) {
        draft.parent_index = null;
        parentByIndex.set(i, null);
        draft.validation_warnings.push('invalid_parent_candidate');
        draft.candidate_status = 'needs_review';
      } else if (hasParentCycle(i, parentByIndex)) {
        draft.parent_index = null;
        parentByIndex.set(i, null);
        draft.validation_warnings.push('hierarchy_cycle');
        draft.candidate_status = 'needs_review';
      }
    }
    if ((draft.title && draft.title.length > 70) || countNavigationGoTokens(draft.excerpt) >= 2) {
      draft.validation_warnings.push('toc_or_merged_heading');
      draft.candidate_status = 'needs_review';
      draft.confidence = Math.min(draft.confidence, 0.35);
    }

    const siblings = out.filter(
      (other, otherIndex) =>
        otherIndex !== i &&
        other.kind_label === draft.kind_label &&
        other.parent_index === draft.parent_index &&
        Boolean(draft.normalized_machine_identifier?.trim()) &&
        Boolean(other.normalized_machine_identifier?.trim()) &&
        draft.normalized_machine_identifier === other.normalized_machine_identifier,
    );
    if (siblings.length) {
      draft.validation_warnings.push('duplicate_sibling_identifier');
      draft.candidate_status = 'needs_review';
    }

    const printedMarker = draft.printed_marker?.trim() || '';
    if (printedMarker && /קטן|פסקה/.test(draft.kind_label ?? '')) {
      const printedSiblings = out.filter(
        (other, otherIndex) =>
          otherIndex !== i &&
          other.kind_label === draft.kind_label &&
          other.parent_index === draft.parent_index &&
          (other.printed_marker?.trim() || '') === printedMarker,
      );
      if (printedSiblings.length) {
        if (!draft.validation_warnings.includes('duplicate_sibling_identifier')) {
          draft.validation_warnings.push('duplicate_sibling_identifier');
        }
        draft.candidate_status = 'needs_review';
      }
    }

    const exactDup = out.some(
      (other, otherIndex) =>
        otherIndex < i &&
        other.kind_label === draft.kind_label &&
        other.node_number === draft.node_number &&
        other.parent_index === draft.parent_index &&
        other.title === draft.title,
    );
    if (exactDup) {
      draft.validation_warnings.push('duplicate_candidate');
      draft.candidate_status = 'needs_review';
    }

    const existing = context.existing_nodes.find((node) => {
      if (node.tax_source_id !== context.tax_source_id || node.country_code !== context.country_code) return false;
      if (node.kind_label !== draft.kind_label) return false;
      const draftRoot = draft.parent_index == null;
      const nodeRoot = node.parent_node_id == null;
      if (draftRoot !== nodeRoot) return false;
      if (!draftRoot && draft.parent_index != null) {
        const parentDraft = out[draft.parent_index];
        const parentNode = context.existing_nodes.find((row) => row.id === node.parent_node_id) ?? null;
        if (parentDraft && parentNode && !sameParentIdentity(parentDraft, parentNode)) return false;
      }
      if (draft.normalized_machine_identifier && node.normalized_machine_identifier) {
        return draft.normalized_machine_identifier === node.normalized_machine_identifier;
      }
      return Boolean(node.node_number) && node.node_number === draft.node_number;
    });
    if (existing) {
      draft.validation_warnings.push('possible_existing_canonical_node');
      draft.candidate_status = 'needs_review';
    }
  }

  const groups = new Map<string, Array<{ index: number; n: number }>>();
  out.forEach((draft, index) => {
    const n = parseNumericIdentifier(draft.node_number);
    if (n == null) return;
    const key = `${draft.kind_label}::${draft.parent_index ?? 'root'}`;
    const list = groups.get(key) ?? [];
    list.push({ index, n });
    groups.set(key, list);
  });
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.n - b.n);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].n > sorted[i - 1].n + 1) {
        const draft = out[sorted[i].index];
        draft.validation_warnings.push('sequence_anomaly');
        draft.candidate_status = 'needs_review';
      }
    }
  }

  return out;
}

export function sameParentIdentity(
  parentDraft: Pick<StructureCandidateDraft, 'kind_label' | 'node_number' | 'normalized_machine_identifier'>,
  parentNode: { kind_label: string; node_number: string | null; normalized_machine_identifier?: string | null },
): boolean {
  if (parentDraft.kind_label !== parentNode.kind_label) return false;
  if (parentDraft.normalized_machine_identifier && parentNode.normalized_machine_identifier) {
    return parentDraft.normalized_machine_identifier === parentNode.normalized_machine_identifier;
  }
  return Boolean(parentDraft.node_number) && parentDraft.node_number === parentNode.node_number;
}

export function hasParentCycle(start: number, parentByIndex: Map<number, number | null>): boolean {
  const seen = new Set<number>();
  let current: number | null | undefined = start;
  while (current != null) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentByIndex.get(current);
  }
  return false;
}

/** Proof that later photo/text batches map onto the same page model. */
export function orderedPagesFromFutureInputs(input: {
  input_type: LegalIngestionInputType;
  items: Array<{ order: number; text?: string | null }>;
}): Array<{ page_no: number; extraction_method: 'ocr' | 'manual_text'; text: string | null; status: 'pending' }> {
  return input.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      page_no: index + 1,
      extraction_method: input.input_type === 'text' ? 'manual_text' : 'ocr',
      text: item.text ?? null,
      status: 'pending' as const,
    }));
}

export function summarizeJobProgress(pages: Array<{ status: string }>): {
  extracted_page_count: number;
  needs_ocr_page_count: number;
  failed_page_count: number;
  job_status: 'extracting' | 'partially_extracted' | 'ready_for_review' | 'needs_review' | 'extraction_failed';
} {
  const extracted_page_count = pages.filter((page) => page.status === 'extracted').length;
  const needs_ocr_page_count = pages.filter((page) => page.status === 'needs_ocr').length;
  const failed_page_count = pages.filter((page) => page.status === 'failed').length;
  const pending = pages.filter((page) => page.status === 'pending' || page.status === 'extracting').length;
  if (pending > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'extracting' };
  }
  if (extracted_page_count === 0 && needs_ocr_page_count === 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'extraction_failed' };
  }
  if (failed_page_count > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'partially_extracted' };
  }
  if (needs_ocr_page_count > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'needs_review' };
  }
  return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'ready_for_review' };
}

export function workerMustNotWriteCanonicalLaw(table: string): boolean {
  return [
    'tax_domains',
    'tax_sources',
    'tax_legal_nodes',
    'tax_rules',
    'tax_rule_versions',
    'country_legal_values',
    'country_legal_value_versions',
    'tax_fact_definitions',
    'legal_ingestion_legal_text_drafts',
    'legal_ingestion_tax_knowledge_proposals',
  ].includes(table);
}

export function assertCountryAgrees(entityCountry: string, payloadCountry: unknown): void {
  if (typeof payloadCountry !== 'string' || !payloadCountry.trim()) return;
  if (payloadCountry.trim().toUpperCase() !== entityCountry.toUpperCase()) {
    throw Object.assign(new Error('Country on payload does not match the tax source'), {
      code: 'COUNTRY_MISMATCH',
    });
  }
}

export function safeAuditExcerpt(value: string | null | undefined, max = 80): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildOriginalFileAccess(
  filename: string,
  url: string,
  expiresInSec = OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC,
  nowMs = Date.now(),
): OriginalFileAccessDto {
  return {
    filename,
    url,
    expires_in_sec: expiresInSec,
    expires_at: new Date(nowMs + expiresInSec * 1000).toISOString(),
  };
}

export function originalFileAccessNeedsRefresh(
  access: { url?: string | null; expires_at?: string | null } | null | undefined,
  nowMs = Date.now(),
  refreshSkewSec = OWNER_LEGAL_MATERIAL_SIGNED_URL_REFRESH_SKEW_SEC,
): boolean {
  if (!access?.url || !access.expires_at) return true;
  const expires = Date.parse(access.expires_at);
  if (!Number.isFinite(expires)) return true;
  return expires - nowMs <= refreshSkewSec * 1000;
}
