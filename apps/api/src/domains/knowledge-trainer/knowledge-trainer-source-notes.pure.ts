import { countNavigationGoTokens } from './knowledge-trainer.pure.js';
import {
  buildPageLayoutProfile,
  evaluateLineHeadingEvidence,
  groupTextItemsIntoLines,
  lineLooksLikeAmendmentOrGazette,
  pageLooksLikeLegalApparatusZone,
  bboxFromLine,
  type LayoutLine,
  type PageLayoutProfile,
  type StoredPageLayout,
  type StoredTextItem,
} from './knowledge-trainer-layout.pure.js';
import { lineLooksLikeLegalApparatus } from './knowledge-trainer-nested.pure.js';
import type {
  ExtractedPageText,
  SourceBBox,
  SourceNoteAnchorDraft,
  SourceNoteClassification,
  SourceNoteDraft,
  SourceNoteOriginZone,
  SourceNoteReviewStatus,
} from './knowledge-trainer.types.js';

const SUPER_TO_DIGIT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const INLINE_MARKER_RE = /^(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d{1,2}|[*†‡⁎])$/;
const NOTE_START_MARKER_RE =
  /^(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\(\s*(?:\d{1,2}|[א-ת])\s*\)|(?:\d{1,2}|[א-ת])\)|\d{1,3}\s*[–-]\s*תיקון)/;

export function bboxFromItem(item: StoredTextItem): SourceBBox {
  return {
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  };
}

export function classifySourceNoteText(text: string): SourceNoteClassification {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';
  if (/תיקון\s*מס/.test(trimmed) || /תיקון\s+בסעיף/.test(trimmed) || /\d{1,3}\s*[–-]\s*תיקון/.test(trimmed)) {
    return 'amendment_history';
  }
  if (/ס["”]?ח/.test(trimmed) || /ה["”]?ח/.test(trimmed) || /י["”]?פ/.test(trimmed) || /ק["”]?ת/.test(trimmed) || /עמ['׳"]?\s*\d+/.test(trimmed)) {
    return 'publication_citation';
  }
  if (/הוראות\s+מעבר/.test(trimmed) || /הוראת\s+שעה/.test(trimmed) || /לענין\s+תחולה/.test(trimmed) || /לענין\s+תחילה/.test(trimmed) || /תחילתו\s+ביום/.test(trimmed)) {
    return 'editorial_note';
  }
  if (/ר['׳]?\s*סעיף/.test(trimmed) || /תקנות\s+/.test(trimmed) || /חוק\s+/.test(trimmed)) {
    return 'legal_reference_candidate';
  }
  return 'unknown';
}

export function extractSourceNotePrintedMarker(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const superMatch = trimmed.match(/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+/);
  if (superMatch) return superMatch[0];
  const leadingAmend = trimmed.match(/^[\s.]*(\d{1,3})\s*[–-]\s*תיקון/);
  if (leadingAmend) return leadingAmend[1];
  const paren = trimmed.match(/^\(\s*(\d{1,2}|[א-ת])\s*\)/);
  if (paren) return `(${paren[1]})`;
  const dotted = trimmed.match(/^(\d{1,2}|[א-ת])\)/);
  if (dotted) return dotted[1];
  const star = trimmed.match(/^[*†‡⁎]/);
  if (star) return star[0];
  return null;
}

export function normalizeSourceMarker(marker: string | null | undefined): string | null {
  if (!marker) return null;
  const trimmed = marker.trim();
  if (!trimmed) return null;
  const mapped = [...trimmed].map((ch) => SUPER_TO_DIGIT[ch] ?? ch).join('');
  const inner = mapped.replace(/[().\s]/g, '');
  return inner || null;
}

export function lineLooksLikeSourceChrome(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^\d{1,4}$/.test(trimmed)) return true;
  if (/^\d{5,}$/.test(trimmed)) return true;
  if (/\bGo\b/.test(trimmed)) return true;
  if (countNavigationGoTokens(trimmed) >= 1) return true;
  if (/^פקודת\s+מס\s+הכנסה/.test(trimmed) && trimmed.length < 48) return true;
  if (/^נוסח\s+חדש$/.test(trimmed)) return true;
  return false;
}

export function lineLooksLikeMeaningfulSourceNote(
  text: string,
  opts?: { apparatus_zone?: boolean },
): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 6) return false;
  if (lineLooksLikeSourceChrome(trimmed)) return false;
  if (opts?.apparatus_zone) return true;
  if (lineLooksLikeLegalApparatus(trimmed) || lineLooksLikeAmendmentOrGazette(trimmed)) return true;
  if (NOTE_START_MARKER_RE.test(trimmed) && trimmed.length >= 8) return true;
  return false;
}

function itemLooksLikeInlineMarker(
  item: StoredTextItem,
  line: LayoutLine,
  profile: PageLayoutProfile,
): boolean {
  const token = item.s.trim();
  if (!INLINE_MARKER_RE.test(token)) return false;
  if (token.length > 3) return false;
  if (!(item.fs > 0) || !(profile.median_font_size > 0)) return false;
  if (item.fs > profile.median_font_size * 0.72) return false;
  if (line.fontSize > 0 && item.fs > line.fontSize * 0.78) return false;
  return true;
}

type CollectedNote = Omit<SourceNoteDraft, 'anchors' | 'inline_link_status'> & {
  marker_key: string | null;
};

type CollectedMarker = SourceNoteAnchorDraft & { marker_key: string | null };

function collectInlineMarkers(
  pageNo: number,
  lines: LayoutLine[],
  items: StoredTextItem[],
  profile: PageLayoutProfile,
): CollectedMarker[] {
  const byIndex = new Map(items.map((item) => [item.i, item]));
  const out: CollectedMarker[] = [];
  lines.forEach((line, lineIndex) => {
    for (const itemIndex of line.itemIndexes) {
      const item = byIndex.get(itemIndex);
      if (!item || !itemLooksLikeInlineMarker(item, line, profile)) continue;
      const printed = item.s.trim();
      out.push({
        printed_marker: printed,
        source_page: pageNo,
        source_item_start: item.i,
        source_item_end: item.i,
        source_line_index: lineIndex,
        source_bbox: bboxFromItem(item),
        link_status: 'unresolved',
        confidence: 0.55,
        marker_key: normalizeSourceMarker(printed),
      });
    }
  });
  return out;
}

function reviewStatusFor(classification: SourceNoteClassification, hasMarker: boolean): SourceNoteReviewStatus {
  if (classification === 'unknown' && !hasMarker) return 'unresolved';
  return 'needs_review';
}

export type SourceNoteDetection = {
  notes: SourceNoteDraft[];
  unresolved_anchors: SourceNoteAnchorDraft[];
};

function linkNotesAndMarkers(notes: CollectedNote[], markers: CollectedMarker[]): SourceNoteDetection {
  const usedMarkers = new Set<number>();
  const drafts: SourceNoteDraft[] = notes.map((note) => {
    if (!note.marker_key) {
      return {
        ...note,
        inline_link_status: 'missing_anchor' as const,
        anchors: [],
      };
    }
    const samePage = markers
      .map((marker, index) => ({ marker, index }))
      .filter(({ marker, index }) => !usedMarkers.has(index) && marker.source_page === note.source_page && marker.marker_key === note.marker_key);
    if (samePage.length !== 1) {
      return {
        ...note,
        inline_link_status: samePage.length === 0 ? 'missing_anchor' : 'unresolved',
        anchors: [],
        validation_warnings:
          samePage.length > 1 ? [...note.validation_warnings, 'inline_marker_ambiguous'] : note.validation_warnings,
      };
    }
    const hit = samePage[0];
    usedMarkers.add(hit.index);
    const linked: SourceNoteAnchorDraft = {
      printed_marker: hit.marker.printed_marker,
      source_page: hit.marker.source_page,
      source_item_start: hit.marker.source_item_start,
      source_item_end: hit.marker.source_item_end,
      source_line_index: hit.marker.source_line_index,
      source_bbox: hit.marker.source_bbox,
      link_status: 'linked',
      confidence: 0.86,
    };
    return {
      ...note,
      inline_link_status: 'linked' as const,
      confidence: Math.max(note.confidence, 0.8),
      anchors: [linked],
    };
  });

  const unresolved_anchors: SourceNoteAnchorDraft[] = markers
    .filter((_, index) => !usedMarkers.has(index))
    .map((marker) => ({
      printed_marker: marker.printed_marker,
      source_page: marker.source_page,
      source_item_start: marker.source_item_start,
      source_item_end: marker.source_item_end,
      source_line_index: marker.source_line_index,
      source_bbox: marker.source_bbox,
      link_status: 'unresolved' as const,
      confidence: marker.confidence,
    }));
  return { notes: drafts, unresolved_anchors };
}

function noteFromLine(
  pageNo: number,
  lineIndex: number,
  line: LayoutLine,
  originZone: SourceNoteOriginZone,
  extraWarnings: string[] = [],
): CollectedNote {
  const printed = extractSourceNotePrintedMarker(line.text);
  const classification = classifySourceNoteText(line.text);
  const itemStart = line.itemIndexes[0] ?? null;
  const itemEnd = line.itemIndexes[line.itemIndexes.length - 1] ?? null;
  return {
    source_page: pageNo,
    source_item_start: itemStart,
    source_item_end: itemEnd,
    source_line_index: lineIndex,
    source_bbox: bboxFromLine(line),
    printed_marker: printed,
    note_text: line.text.trim(),
    classification,
    origin_zone: originZone,
    review_status: reviewStatusFor(classification, Boolean(printed)),
    confidence: originZone === 'apparatus_zone' ? 0.78 : originZone === 'footer_line' ? 0.62 : 0.58,
    validation_warnings: extraWarnings,
    marker_key: normalizeSourceMarker(printed),
  };
}

export function detectSourceNotesFromLayout(
  pages: Array<ExtractedPageText & { layout?: StoredPageLayout | null }>,
): SourceNoteDetection {
  const notes: CollectedNote[] = [];
  const markers: CollectedMarker[] = [];
  for (const page of pages) {
    const layout = page.layout;
    if (!layout?.items.length) continue;
    const lines = groupTextItemsIntoLines(layout.items);
    const profile = buildPageLayoutProfile(lines, layout.h);
    const apparatusZone = pageLooksLikeLegalApparatusZone(lines, profile);
    markers.push(...collectInlineMarkers(page.page_no, lines, layout.items, profile));
    lines.forEach((line, index) => {
      if (line.fontSize > 0 && line.fontSize < 4) return;
      if (apparatusZone) {
        if (!lineLooksLikeMeaningfulSourceNote(line.text, { apparatus_zone: true })) return;
        notes.push(noteFromLine(page.page_no, index, line, 'apparatus_zone'));
        return;
      }
      const verdict = evaluateLineHeadingEvidence(line, { prev: lines[index - 1], next: lines[index + 1] }, profile);
      const apparatus = lineLooksLikeLegalApparatus(line.text) || lineLooksLikeAmendmentOrGazette(line.text);
      const footerBand = line.y <= profile.footer_y;
      const smallFooterType =
        profile.median_font_size > 0 &&
        line.fontSize > 0 &&
        line.fontSize <= profile.median_font_size * 0.85;
      if (apparatus && lineLooksLikeMeaningfulSourceNote(line.text)) {
        notes.push(
          noteFromLine(
            page.page_no,
            index,
            line,
            footerBand || verdict === 'header_or_footer' ? 'footer_line' : 'body_line',
          ),
        );
        return;
      }
      if (
        (verdict === 'header_or_footer' || footerBand) &&
        !lineLooksLikeSourceChrome(line.text) &&
        line.text.trim().length >= 8 &&
        (NOTE_START_MARKER_RE.test(line.text.trim()) || smallFooterType)
      ) {
        notes.push(noteFromLine(page.page_no, index, line, 'footer_line'));
      }
    });
  }
  return linkNotesAndMarkers(notes, markers);
}

export function emptySourceNoteSummary(): {
  all: number;
  apparatus_zone: number;
  body_line: number;
  footer_line: number;
  missing_anchor: number;
  linked: number;
  unresolved: number;
  by_classification: Record<SourceNoteClassification, number>;
} {
  return {
    all: 0,
    apparatus_zone: 0,
    body_line: 0,
    footer_line: 0,
    missing_anchor: 0,
    linked: 0,
    unresolved: 0,
    by_classification: {
      unknown: 0,
      legal_reference_candidate: 0,
      amendment_history: 0,
      publication_citation: 0,
      editorial_note: 0,
      other: 0,
    },
  };
}

export function summarizeSourceNotes(
  notes: Array<{
    origin_zone: SourceNoteOriginZone;
    inline_link_status: string;
    classification: string;
  }>,
) {
  const summary = emptySourceNoteSummary();
  summary.all = notes.length;
  for (const note of notes) {
    if (note.origin_zone === 'apparatus_zone') summary.apparatus_zone += 1;
    if (note.origin_zone === 'body_line') summary.body_line += 1;
    if (note.origin_zone === 'footer_line') summary.footer_line += 1;
    if (note.inline_link_status === 'missing_anchor') summary.missing_anchor += 1;
    if (note.inline_link_status === 'linked') summary.linked += 1;
    if (note.inline_link_status === 'unresolved') summary.unresolved += 1;
    if (note.classification in summary.by_classification) {
      summary.by_classification[note.classification as SourceNoteClassification] += 1;
    }
  }
  return summary;
}

export function parseSourceBBox(raw: unknown): SourceBBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!('x' in rec) || !('y' in rec) || !('w' in rec) || !('h' in rec)) return null;
  return {
    x: Number(rec.x) || 0,
    y: Number(rec.y) || 0,
    w: Number(rec.w) || 0,
    h: Number(rec.h) || 0,
  };
}
