import { parseLegalIdentifier } from '../tax-knowledge/legal-identifier.pure.js';
import {
  applyExactIdentifierToDraft,
  composeChildIdentifier,
  extractNestedStructureMarker,
  extractParenMarkersOnHeadingLine,
  extractParenthesizedMarkersFromTokens,
  extractTrailingStructuralMarkers,
  identifierForTopLevelDraft,
  isolatedItemIsStructuralMarker,
  kindLabelForNestedDepth,
  resolveNestedParent,
  titleFromFollowingLine,
  type NestedKindDepth,
  type NestedStackEntry,
} from './knowledge-trainer-nested.pure.js';
import {
  detectStructureCandidates,
  isYearLikeIdentifier,
  usableKindCatalog,
} from './knowledge-trainer.pure.js';
import type {
  ExtractedPageText,
  StructureCandidateDraft,
  StructureDetectionAnalysis,
  StructureKindCatalogItem,
} from './knowledge-trainer.types.js';

export const PAGE_LAYOUT_STATUSES = [
  'not_extracted',
  'pending',
  'extracting',
  'ready',
  'skipped_needs_ocr',
  'failed',
] as const;
export type PageLayoutStatus = (typeof PAGE_LAYOUT_STATUSES)[number];

export type StoredTextItem = {
  i: number;
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fn: string;
  fs: number;
  eol: boolean;
  d: string;
};

export type StoredPageLayout = {
  v: 1;
  h: number;
  items: StoredTextItem[];
};

export type PdfJsTextItemInput = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
  fontName?: string;
  hasEOL?: boolean;
  dir?: string;
};

export type LayoutLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  itemIndexes: number[];
};

export type PageLayoutProfile = {
  page_height: number;
  median_font_size: number;
  header_y: number;
  footer_y: number;
};

export type HeadingLayoutVerdict =
  | 'isolated_heading'
  | 'needs_owner_review'
  | 'running_citation'
  | 'amendment_or_gazette'
  | 'header_or_footer'
  | 'insufficient_evidence';

export function fontSizeFromTransform(transform: number[] | undefined, fallbackHeight = 0): number {
  if (!Array.isArray(transform) || transform.length < 2) {
    return roundLayout(fallbackHeight);
  }
  const a = Number(transform[0]) || 0;
  const b = Number(transform[1]) || 0;
  const size = Math.hypot(a, b);
  return roundLayout(size > 0 ? size : fallbackHeight);
}

export function roundLayout(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compactPdfJsTextItems(
  items: PdfJsTextItemInput[],
  pageHeight: number,
): StoredPageLayout {
  const compact: StoredTextItem[] = [];
  items.forEach((item, index) => {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str) return;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    compact.push({
      i: index,
      s: str,
      x: roundLayout(Number(transform[4]) || 0),
      y: roundLayout(Number(transform[5]) || 0),
      w: roundLayout(Number(item.width) || 0),
      h: roundLayout(Number(item.height) || 0),
      fn: typeof item.fontName === 'string' ? item.fontName.slice(0, 80) : '',
      fs: fontSizeFromTransform(transform, Number(item.height) || 0),
      eol: item.hasEOL === true,
      d: typeof item.dir === 'string' ? item.dir.slice(0, 8) : '',
    });
  });
  return { v: 1, h: roundLayout(pageHeight), items: compact };
}

export function parseStoredPageLayout(raw: unknown): StoredPageLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.items)) return null;
  const items = rec.items
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      if (typeof item.s !== 'string' || !item.s) return null;
      return {
        i: Number(item.i) || 0,
        s: item.s,
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
        w: Number(item.w) || 0,
        h: Number(item.h) || 0,
        fn: typeof item.fn === 'string' ? item.fn : '',
        fs: Number(item.fs) || 0,
        eol: item.eol === true,
        d: typeof item.d === 'string' ? item.d : '',
      };
    })
    .filter((row): row is StoredTextItem => row !== null);
  return { v: 1, h: Number(rec.h) || 0, items };
}

export function groupTextItemsIntoLines(items: StoredTextItem[], yTolerance?: number): LayoutLine[] {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: LayoutLine[] = [];
  for (const item of sorted) {
    const tol = yTolerance ?? Math.max(1.5, item.fs * 0.35, item.h * 0.4);
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= tol) {
      current.text = `${current.text} ${item.s}`.replace(/\s+/g, ' ').trim();
      current.x = Math.min(current.x, item.x);
      current.width = Math.max(current.x + current.width, item.x + item.w) - current.x;
      current.height = Math.max(current.height, item.h);
      current.fontSize = Math.max(current.fontSize, item.fs);
      current.itemIndexes.push(item.i);
      continue;
    }
    lines.push({
      text: item.s.trim(),
      x: item.x,
      y: item.y,
      width: item.w,
      height: item.h,
      fontSize: item.fs,
      itemIndexes: [item.i],
    });
  }
  return lines;
}

export function buildPageLayoutProfile(lines: LayoutLine[], pageHeight: number): PageLayoutProfile {
  const fonts = lines.map((line) => line.fontSize).filter((size) => size > 0).sort((a, b) => a - b);
  const median = fonts.length ? fonts[Math.floor(fonts.length / 2)] : 0;
  const height = pageHeight > 0 ? pageHeight : Math.max(...lines.map((line) => line.y), 0);
  return {
    page_height: height,
    median_font_size: median,
    header_y: height * 0.92,
    footer_y: height * 0.12,
  };
}

export function lineLooksLikeRunningCitation(text: string): boolean {
  return /(?:לפי|מכוח|כאמור|בהתאם|על\s+פי|לענין)\s+(?:ל)?(?:ב)?סעיף(?!\s+זה)/.test(text) ||
    /(?:בסעיף|לסעיף)\s+\S/.test(text) ||
    /סעיפים\s+\d/.test(text) ||
    /ר'\s*סעיף/.test(text);
}

const HEBREW_YEAR_STAMP = /תש[א-ת]{0,2}["״׳'][א-ת]?-?/;

function stripAmendmentStamps(text: string): string {
  return text
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(new RegExp(HEBREW_YEAR_STAMP, 'g'), '')
    .replace(/תיקון\s*מס['׳"]?/g, '')
    .replace(/ת["״]ט/g, '')
    .replace(/מס['׳"]?(?=\s|$|[)\]])/g, '')
    .replace(/[0-9()[\]\s\-–—,;:.]+/g, '');
}

export function isAmendmentYearStamp(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\]\s+[א-ת]{2,}/.test(trimmed)) return false;
  const withoutStamps = stripAmendmentStamps(trimmed);
  return withoutStamps.length < 2 && (/(?:19|20)\d{2}/.test(trimmed) || HEBREW_YEAR_STAMP.test(trimmed));
}

export function isAmendmentDebris(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\]\s+[א-ת]{2,}/.test(trimmed)) return false;
  return stripAmendmentStamps(trimmed).length < 2 &&
    (/(?:19|20)\d{2}/.test(trimmed) || HEBREW_YEAR_STAMP.test(trimmed) || /מס['׳"]?/.test(trimmed) || /ת["״]ט/.test(trimmed));
}

export function parseRtlSectionNumber(text: string): string | null {
  const trimmed = text.trim();
  const letterSuffix = trimmed.match(/(?:^|[^א-ת])([א-ת])\.\s+([0-9]{1,3})\s*$/);
  if (letterSuffix && !isYearLikeIdentifier(letterSuffix[2])) {
    return `${letterSuffix[2]}${letterSuffix[1]}`;
  }
  const plain = trimmed.match(/(?<![א-ת\d])\.\s+([0-9]{1,3}[א-ת]?)\s*$/);
  if (plain && !isYearLikeIdentifier(plain[1])) return plain[1];
  return null;
}

export function lineLooksLikeAmendmentOrGazette(text: string): boolean {
  const hasYear = /(?:^|\s)(?:19|20)\d{2}(?:\s|$|[.,;:])/.test(text);
  const hasAmendmentContext = /תיקון|ס["”]?ח|עמ['׳"]?/.test(text);
  return (
    /תיקון\s*מס/.test(text) ||
    /עמ['׳"]?\s*\d+/.test(text) ||
    /ס["”]?ח\s/.test(text) ||
    /סעיף\s+\S+\s+יחול(?:\s|$|[.,;:])/.test(text) ||
    /תחילתו\s+ביום/.test(text) ||
    (hasYear && hasAmendmentContext)
  );
}

const HEBREW_ORDINALS = 'ראשון|שני|שלישי|רביעי|חמישי|ששי|שביעי|שמיני|תשיעי|עשירי';
const CONTAINER_NUMBER = `(?:${HEBREW_ORDINALS}|[א-ת]['׳']|[0-9]{1,3})`;

export function lineLooksLikeOfficialContainerHeading(text: string): boolean {
  return new RegExp(`^(?:חלק|פרק|סימן|תוספת)\\s+${CONTAINER_NUMBER}\\s*[:'׳]`).test(text.trim());
}

export function evaluateLineHeadingEvidence(
  line: LayoutLine,
  neighbors: { prev?: LayoutLine; next?: LayoutLine },
  profile: PageLayoutProfile,
): HeadingLayoutVerdict {
  if (
    (line.y >= profile.header_y || line.y <= profile.footer_y) &&
    !titleFromPreviousHeadingLine(neighbors.prev?.text) &&
    !parseRtlSectionNumber(line.text)
  ) {
    return 'header_or_footer';
  }
  if (
    profile.median_font_size > 0 &&
    line.fontSize > 0 &&
    line.fontSize <= profile.median_font_size * 0.78 &&
    line.y <= profile.page_height * 0.22
  ) {
    return 'header_or_footer';
  }
  if (lineLooksLikeOfficialContainerHeading(line.text) && line.text.length <= 56) {
    return 'isolated_heading';
  }
  if (lineLooksLikeAmendmentOrGazette(line.text)) return 'amendment_or_gazette';
  if (
    neighbors.prev &&
    neighbors.next &&
    lineLooksLikeAmendmentOrGazette(neighbors.prev.text) &&
    lineLooksLikeAmendmentOrGazette(neighbors.next.text) &&
    !parseRtlSectionNumber(line.text)
  ) {
    return 'amendment_or_gazette';
  }
  if (lineLooksLikeRunningCitation(line.text)) return 'running_citation';
  const gapAbove = neighbors.prev ? Math.abs(neighbors.prev.y - line.y) : profile.median_font_size * 3;
  const gapBelow = neighbors.next ? Math.abs(line.y - neighbors.next.y) : profile.median_font_size * 3;
  const isolated =
    line.text.length <= 56 &&
    gapAbove >= profile.median_font_size * 1.15 &&
    (profile.median_font_size === 0 || line.fontSize >= profile.median_font_size * 0.98);
  if (isolated && line.text.length <= 40) return 'isolated_heading';
  if (line.text.length <= 80 && gapAbove >= profile.median_font_size) return 'needs_owner_review';
  if (line.text.length > 90) return 'insufficient_evidence';
  return 'needs_owner_review';
}

export function canClaimLayoutPage(
  page: { status: string; layout_status: string; lease_expires_at: string | null },
  nowMs = Date.now(),
): boolean {
  if (page.status !== 'extracted') return false;
  if (!['pending', 'failed', 'extracting'].includes(page.layout_status)) return false;
  if (page.layout_status === 'extracting' && !page.lease_expires_at) return true;
  if (!page.lease_expires_at) return true;
  return Date.parse(page.lease_expires_at) < nowMs;
}

export function summarizeLayoutReadiness(
  pages: Array<{ status: string; layout_status?: string | null; layout_item_count?: number | null }>,
): {
  readiness: 'not_extracted' | 'processing' | 'ready' | 'partial';
  readiness_label: string;
  eligible_count: number;
  ready_count: number;
  skipped_ocr_count: number;
  failed_count: number;
  item_count: number;
  high_confidence_trusted: boolean;
} {
  const extracted = pages.filter((page) => page.status === 'extracted');
  const ready = extracted.filter((page) => page.layout_status === 'ready');
  const inFlight = extracted.filter((page) =>
    ['pending', 'extracting'].includes(String(page.layout_status)),
  );
  const skipped = pages.filter((page) => page.status === 'needs_ocr' || page.layout_status === 'skipped_needs_ocr').length;
  const failed = extracted.filter((page) => page.layout_status === 'failed').length;
  const itemCount = pages.reduce((sum, page) => sum + (Number(page.layout_item_count) || 0), 0);
  let readiness: 'not_extracted' | 'processing' | 'ready' | 'partial' = 'not_extracted';
  if (ready.length && ready.length === extracted.length) readiness = 'ready';
  else if (inFlight.length) readiness = 'processing';
  else if (ready.length || failed) readiness = 'partial';
  const labels = {
    not_extracted: 'Not extracted',
    processing: `Processing ${ready.length} / ${extracted.length || 0}`,
    ready: 'Ready',
    partial: skipped ? 'Partial / Needs OCR' : 'Partial / Needs OCR',
  };
  return {
    readiness,
    readiness_label: labels[readiness],
    eligible_count: extracted.length,
    ready_count: ready.length,
    skipped_ocr_count: skipped,
    failed_count: failed,
    item_count: itemCount,
    high_confidence_trusted: false,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleLooksLikeCitationOrDebris(text: string): boolean {
  return (
    isAmendmentYearStamp(text) ||
    isAmendmentDebris(text) ||
    /\(\s*[^)]*סעיף\s*\)/.test(text) ||
    /[;،,]$/.test(text.trim()) ||
    lineLooksLikeAmendmentOrGazette(text) ||
    lineLooksLikeRunningCitation(text)
  );
}

function titleFromCurrentRtlLine(text: string): string | null {
  const repealed = text.trim().match(/^\.?\s*(\(\s*בוטל\s*\))/);
  return repealed?.[1] ? repealed[1].replace(/\s+/g, ' ').trim() : null;
}

function titleFromPreviousHeadingLine(prev?: string): string | null {
  if (!prev) return null;
  const bracketTitle = prev.match(/\]\s+([א-ת][^0-9[\]]{1,50})$/);
  if (bracketTitle?.[1] && !titleLooksLikeCitationOrDebris(bracketTitle[1])) {
    return bracketTitle[1].trim().slice(0, 60);
  }
  const afterAmendment = prev.replace(/^.*תיקון\s*מס['׳"]?\s*\)\s*/, '').trim();
  if (
    afterAmendment &&
    afterAmendment !== prev.trim() &&
    afterAmendment.length <= 50 &&
    /[א-ת]{2,}/.test(afterAmendment) &&
    !/תיקון/.test(afterAmendment) &&
    !titleLooksLikeCitationOrDebris(afterAmendment)
  ) {
    return afterAmendment.slice(0, 60);
  }
  const cleaned = prev.replace(/^\s*\[\s*[^\]]+\]\s*/, '').trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  if (titleLooksLikeCitationOrDebris(cleaned)) return null;
  if (!/[א-ת]{2,}/.test(cleaned)) return null;
  return cleaned.slice(0, 60);
}

function seifLabelFromCatalog(labels: string[]): string | undefined {
  return labels.find((label) => label === 'סעיף') ?? labels.find((label) => /סעיף/.test(label) && !/קטן|פסקה/.test(label));
}

function isSeifKindLabel(label: string): boolean {
  return label === 'סעיף' || (/סעיף/.test(label) && !/קטן|פסקה/.test(label));
}

function collectNestedMarkersOnLine(
  line: LayoutLine,
  items: StoredTextItem[],
  profile: PageLayoutProfile,
): Array<{ component: string; title: string | null; isolated: boolean }> {
  const trailing = extractTrailingStructuralMarkers(line.text);
  if (trailing.length) return trailing;
  const fromText = extractNestedStructureMarker(line.text);
  if (fromText) return [fromText];
  const lineItems = items.filter((item) => line.itemIndexes.includes(item.i));
  for (const item of lineItems) {
    const neighbors = lineItems.filter((other) => other.i !== item.i);
    const component = isolatedItemIsStructuralMarker(item, neighbors, profile);
    if (!component) continue;
    const title = neighbors.map((other) => other.s).join(' ').replace(/\s+/g, ' ').trim();
    if (title.length > 80) continue;
    return [{ component, title: title.slice(0, 60) || null, isolated: true }];
  }
  const fromTokens = extractParenthesizedMarkersFromTokens(lineItems);
  return fromTokens.map((marker) => ({
    component: marker.component,
    title: null,
    isolated: fromTokens.length === 1,
  }));
}

function titleFromNearbyHeadingLines(previousLines: Array<string | undefined>): string | null {
  for (const previous of previousLines) {
    if (!previous || parseRtlSectionNumber(previous) || isAmendmentDebris(previous)) continue;
    const title = titleFromPreviousHeadingLine(previous);
    if (title && !titleLooksLikeCitationOrDebris(title)) return title;
  }
  return null;
}

function matchCatalogOnLine(
  lineText: string,
  catalog: StructureKindCatalogItem[],
  previousLines: Array<string | undefined> = [],
): Array<{ kind_label: string; node_number: string; title: string | null; printed_marker: string | null }> {
  const labels = usableKindCatalog(catalog).map((item) => item.label.trim()).filter(Boolean);
  if (!labels.length) return [];
  const out: Array<{ kind_label: string; node_number: string; title: string | null; printed_marker: string | null }> = [];
  const trimmed = lineText.trim();
  const containerKinds = labels
    .filter((label) => /^(חלק|פרק|סימן|תוספת)$/.test(label))
    .sort((a, b) => b.length - a.length);
  if (containerKinds.length) {
    const containerRe = new RegExp(
      `^(${containerKinds.map(escapeRegExp).join('|')})\\s+(${HEBREW_ORDINALS}|[א-ת]['׳']|[0-9]{1,3})(?:\\s*[:'׳.\\-–—]\\s*|\\s+|$)(.*)$`,
    );
    const container = trimmed.match(containerRe);
    if (container) {
      const title = container[3].trim().slice(0, 60) || null;
      out.push({ kind_label: container[1], node_number: container[2], title, printed_marker: container[2] });
    }
  }
  const seif = seifLabelFromCatalog(labels);
  const explicitSeif = trimmed.match(new RegExp(`^סעיף\\s+([0-9]{1,3}[א-ת]?)(?:\\s*[:.\\-–—]\\s*|\\s+|$)(.*)$`));
  if (seif && explicitSeif && !isYearLikeIdentifier(explicitSeif[1])) {
    out.push({
      kind_label: seif,
      node_number: explicitSeif[1],
      title: explicitSeif[2].trim().slice(0, 60) || null,
      printed_marker: /^סעיף\s+[0-9]{1,3}[א-ת]?\./.test(trimmed) ? `${explicitSeif[1]}.` : null,
    });
  }
  const ltrNumbered = trimmed.match(/^([0-9]{1,3}[א-ת]?)\.(?:\s+|$)(.*)$/);
  if (seif && ltrNumbered && !isYearLikeIdentifier(ltrNumbered[1])) {
    out.push({
      kind_label: seif,
      node_number: ltrNumbered[1],
      title: ltrNumbered[2].trim().slice(0, 60) || titleFromNearbyHeadingLines(previousLines),
      printed_marker: `${ltrNumbered[1]}.`,
    });
  }
  const lookbackTitle = titleFromCurrentRtlLine(trimmed) ?? titleFromNearbyHeadingLines(previousLines);
  const rtlNumber = parseRtlSectionNumber(trimmed);
  if (seif && lookbackTitle && rtlNumber && !lineLooksLikeRunningCitation(trimmed)) {
    out.push({
      kind_label: seif,
      node_number: rtlNumber,
      title: lookbackTitle,
      printed_marker: null,
    });
  }
  return out;
}

export function detectStructureCandidatesFromLayout(
  pages: Array<ExtractedPageText & { layout?: StoredPageLayout | null }>,
  catalog: StructureKindCatalogItem[],
  opts?: { ocr_page_count?: number },
): { drafts: StructureCandidateDraft[]; analysis: StructureDetectionAnalysis } {
  type LayoutEvent = {
    kind: 'heading' | 'nested';
    kind_label: string;
    node_number: string;
    title: string | null;
    page_no: number;
    offset: number;
    confidence: number;
    warnings: string[];
    component?: string;
    printed_marker?: string | null;
  };
  const events: LayoutEvent[] = [];
  let tocRejected = 0;
  const layoutPages = pages.filter((page) => page.layout?.items.length);
  for (const page of pages) {
    const layout = page.layout;
    if (!layout?.items.length) continue;
    const lines = groupTextItemsIntoLines(layout.items);
    const profile = buildPageLayoutProfile(lines, layout.h);
    lines.forEach((line, index) => {
      const offset = page.page_no * 10000 + index;
      const verdict = evaluateLineHeadingEvidence(line, { prev: lines[index - 1], next: lines[index + 1] }, profile);
      const trailing = extractTrailingStructuralMarkers(line.text);
      if (verdict === 'header_or_footer' && !trailing.length) return;
      if (lineLooksLikeAmendmentOrGazette(line.text) || lineLooksLikeRunningCitation(line.text)) {
        tocRejected += 1;
        return;
      }
      if (verdict === 'amendment_or_gazette' || verdict === 'running_citation') {
        tocRejected += 1;
        trailing.forEach((marker, markerIndex) => {
          events.push({
            kind: 'nested',
            kind_label: '',
            node_number: marker.component,
            title: marker.title,
            page_no: page.page_no,
            offset: offset + markerIndex,
            confidence: 0.52,
            warnings: ['layout_needs_owner_review'],
            component: marker.component,
            printed_marker: `(${marker.component})`,
          });
        });
        return;
      }
      const nearby = [lines[index - 1]?.text, lines[index - 2]?.text, lines[index - 3]?.text];
      const matches = matchCatalogOnLine(line.text, catalog, nearby);
      if (matches.length) {
        const isolated = verdict === 'isolated_heading';
        for (const hit of matches) {
          events.push({
            kind: 'heading',
            kind_label: hit.kind_label,
            node_number: hit.node_number,
            title: hit.title,
            page_no: page.page_no,
            offset,
            confidence: isolated ? 0.86 : 0.52,
            warnings: isolated ? [] : ['layout_needs_owner_review'],
            printed_marker: hit.printed_marker,
          });
        }
        const headingMarkers = extractParenMarkersOnHeadingLine(line.text);
        headingMarkers.forEach((component, markerIndex) => {
          events.push({
            kind: 'nested',
            kind_label: '',
            node_number: component,
            title: null,
            page_no: page.page_no,
            offset: offset + markerIndex + 1,
            confidence: 0.72,
            warnings: ['layout_needs_owner_review'],
            component,
            printed_marker: `(${component})`,
          });
        });
        return;
      }
      const markers = trailing.length ? trailing : collectNestedMarkersOnLine(line, layout.items, profile);
      if (!markers.length) return;
      markers.forEach((marker, markerIndex) => {
        events.push({
          kind: 'nested',
          kind_label: '',
          node_number: marker.component,
          title: marker.title ?? titleFromFollowingLine(lines[index + 1]),
          page_no: page.page_no,
          offset: offset + markerIndex,
          confidence: marker.isolated ? 0.8 : 0.58,
          warnings: marker.isolated ? [] : ['layout_needs_owner_review'],
          component: marker.component,
          printed_marker: `(${marker.component})`,
        });
      });
    });
  }

  const missingLayout = pages.filter((page) => !page.layout?.items.length && page.text);
  const fallback = missingLayout.length
    ? detectStructureCandidates(
        missingLayout.map((page) => ({ page_no: page.page_no, text: page.text })),
        catalog,
        opts,
      )
    : { drafts: [], analysis: { candidates_found: 0, toc_index_rejected: 0, low_confidence_count: 0, unresolved_parent_count: 0, ocr_pages_untouched: opts?.ocr_page_count ?? 0, ocr_gap_warning: (opts?.ocr_page_count ?? 0) > 0, layout_used: false } };

  const layoutDrafts = attachLayoutParents(buildLayoutDraftsFromEvents(events, catalog), catalog);
  const fallbackDrafts = fallback.drafts.map((draft) =>
    applyExactIdentifierToDraft(
      {
        ...draft,
        confidence: Math.min(draft.confidence, 0.5),
        candidate_status: 'needs_review' as const,
        validation_warnings: [...draft.validation_warnings, 'layout_evidence_missing'],
      },
      identifierForTopLevelDraft(draft),
    ),
  );

  const merged = [...layoutDrafts, ...fallbackDrafts].sort((a, b) => a.page_start - b.page_start);
  const analysis: StructureDetectionAnalysis = {
    candidates_found: merged.length,
    toc_index_rejected: tocRejected + (fallback.analysis.toc_index_rejected || 0),
    low_confidence_count: merged.filter((row) => row.confidence < 0.55).length,
    unresolved_parent_count: merged.filter((row) => row.validation_warnings.includes('unresolved_parent')).length,
    ocr_pages_untouched: opts?.ocr_page_count ?? 0,
    ocr_gap_warning: (opts?.ocr_page_count ?? 0) > 0,
    layout_used: layoutPages.length > 0,
    layout_pages_used: layoutPages.length,
  };
  return { drafts: merged, analysis };
}

function buildLayoutDraftsFromEvents(
  events: Array<{
    kind: 'heading' | 'nested';
    kind_label: string;
    node_number: string;
    title: string | null;
    page_no: number;
    offset: number;
    confidence: number;
    warnings: string[];
    component?: string;
    printed_marker?: string | null;
  }>,
  catalog: StructureKindCatalogItem[],
): StructureCandidateDraft[] {
  const drafts: StructureCandidateDraft[] = [];
  const nestedStack: NestedStackEntry[] = [];
  let currentSeif: { index: number; display: string } | null = null;

  const pushDraft = (
    event: (typeof events)[number],
    kindLabel: string,
    identifier: ReturnType<typeof identifierForTopLevelDraft>,
    parentIndex: number | null,
    extraWarnings: string[] = [],
  ) => {
    const warnings = [...event.warnings, ...extraWarnings];
    const draft = applyExactIdentifierToDraft(
      {
        candidate_kind: 'structure',
        candidate_status: event.confidence >= 0.85 ? 'proposed' : event.confidence >= 0.75 ? 'proposed' : 'needs_review',
        kind_label: kindLabel,
        node_number: event.node_number,
        title: event.title,
        parent_index: parentIndex,
        page_start: event.page_no,
        page_end: event.page_no,
        excerpt: `${kindLabel} ${identifier?.source_display_identifier ?? event.node_number}${event.title ? ` ${event.title}` : ''}`.slice(0, 200),
        confidence: event.confidence,
        validation_warnings: warnings,
      },
      identifier,
      event.printed_marker,
    );
    drafts.push(draft);
    return drafts.length - 1;
  };

  for (const event of events) {
    if (event.kind === 'heading') {
      const index = pushDraft(event, event.kind_label, parseLegalIdentifier(event.node_number), null);
      if (isSeifKindLabel(event.kind_label)) {
        currentSeif = {
          index,
          display: drafts[index].source_display_identifier ?? event.node_number,
        };
        nestedStack.length = 0;
      } else if (!/קטן|פסקה/.test(event.kind_label)) {
        currentSeif = null;
        nestedStack.length = 0;
      }
      continue;
    }

    if (!currentSeif || !event.component) continue;
    const resolved = resolveNestedParent(nestedStack, event.component);
    const parent = resolved.parent;
    const parentDisplay = parent?.display ?? currentSeif.display;
    const parentIndex = parent?.index ?? currentSeif.index;
    const identifier = composeChildIdentifier(parentDisplay, event.component);
    if (!identifier) continue;
    const depth = ((parent?.depth ?? 0) + 1) as NestedKindDepth;
    const kindLabel = kindLabelForNestedDepth(depth > 3 ? 3 : depth, catalog);
    if (!kindLabel) {
      continue;
    }
    const index = pushDraft(
      { ...event, node_number: event.component },
      kindLabel,
      identifier,
      parentIndex,
    );
    nestedStack.push({
      index,
      component: event.component,
      markerClass: /^[0-9]+$/.test(event.component) ? 'number' : 'letter',
      depth: depth > 3 ? 3 : depth,
      display: identifier.source_display_identifier,
    });
  }

  return drafts;
}

function attachLayoutParents(
  drafts: StructureCandidateDraft[],
  catalog: StructureKindCatalogItem[],
): StructureCandidateDraft[] {
  const usable = usableKindCatalog(catalog);
  const rank = (label: string) => {
    const index = usable.findIndex((item) => item.label === label);
    return index >= 0 ? index : usable.length;
  };
  const stack: Array<{ index: number; rank: number }> = [];
  return drafts.map((draft, index) => {
    const currentRank = rank(draft.kind_label);
    while (stack.length && stack[stack.length - 1].rank >= currentRank) stack.pop();
    const parent = draft.parent_index != null ? draft.parent_index : stack.length ? stack[stack.length - 1].index : null;
    stack.push({ index, rank: currentRank });
    return { ...draft, parent_index: parent };
  });
}

export function queueLayoutStatusForPage(status: string, currentLayout: string | null | undefined): PageLayoutStatus {
  if (status === 'needs_ocr') return 'skipped_needs_ocr';
  if (status === 'extracted') return 'pending';
  return (currentLayout as PageLayoutStatus) || 'not_extracted';
}

export function queueLayoutUpdatesByPageStatus(
  pages: Array<{ id: string; status: string; layout_status?: string | null }>,
): { pendingIds: string[]; skippedIds: string[] } {
  const pendingIds: string[] = [];
  const skippedIds: string[] = [];
  for (const page of pages) {
    const next = queueLayoutStatusForPage(page.status, page.layout_status);
    if (next === 'pending') pendingIds.push(page.id);
    if (next === 'skipped_needs_ocr') skippedIds.push(page.id);
  }
  return { pendingIds, skippedIds };
}

export function layoutPersistPreservesPageText(update: Record<string, unknown>): boolean {
  return !Object.prototype.hasOwnProperty.call(update, 'page_text') && !Object.prototype.hasOwnProperty.call(update, 'status');
}

export function layoutItemsEquivalent(left: StoredPageLayout | null, right: StoredPageLayout | null): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function stagingStructureIdsToReplace(
  rows: Array<{
    id: string;
    candidate_kind: string;
    candidate_status: string;
    accepted_tax_legal_node_id?: string | null;
  }>,
): string[] {
  return rows
    .filter(
      (row) =>
        row.candidate_kind === 'structure' &&
        row.candidate_status !== 'accepted' &&
        !row.accepted_tax_legal_node_id,
    )
    .map((row) => row.id);
}
