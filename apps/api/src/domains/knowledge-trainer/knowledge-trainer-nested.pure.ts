import {
  legalIdentifierFields,
  parseLegalIdentifier,
  type LegalIdentifier,
} from '../tax-knowledge/legal-identifier.pure.js';
import { usableKindCatalog } from './knowledge-trainer.pure.js';
import type { StructureCandidateDraft, StructureKindCatalogItem } from './knowledge-trainer.types.js';

type LayoutLine = { text: string };
type PageLayoutProfile = { header_y: number; footer_y: number; median_font_size: number };
type StoredTextItem = { s: string; y: number; fs: number };

const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת';
const NESTED_COMPONENT_RE = /^([0-9]{1,2}[א-ת]?|[א-ת]{1,2}[0-9]{0,2})$/u;
const ISOLATED_MARKER_RE = /^\(\s*([^()]+)\s*\)$/u;
const TRAILING_MARKER_RUN_RE = /((?:\s*\(\s*[^()]+\s*\))+)\s*$/u;
const PAREN_GROUP_RE = /\(\s*([^()]+)\s*\)/gu;

export type NestedMarkerClass = 'number' | 'letter';

export type NestedStructureMarker = {
  component: string;
  title: string | null;
  isolated: boolean;
};

export type NestedKindDepth = 1 | 2 | 3;

export function isValidNestedComponent(raw: string): boolean {
  const component = raw.replace(/\s+/g, '');
  return NESTED_COMPONENT_RE.test(component);
}

export function nestedMarkerClass(component: string): NestedMarkerClass {
  return /^[0-9]+$/.test(component) ? 'number' : 'letter';
}

export function nextHebrewLetter(letter: string): string | null {
  if (letter.length !== 1) return null;
  const index = HEBREW_LETTERS.indexOf(letter);
  return index >= 0 && index < HEBREW_LETTERS.length - 1 ? HEBREW_LETTERS[index + 1] : null;
}

function hebrewLetterPrefix(component: string): string | null {
  const match = component.match(/^[א-ת]+/u);
  return match?.[0] ?? null;
}

export function letterContinuesSequence(previous: string, incoming: string): boolean {
  if (!previous || !incoming || previous === incoming) return false;
  const prevBase = hebrewLetterPrefix(previous);
  const incBase = hebrewLetterPrefix(incoming);
  if (!prevBase || !incBase) return false;
  if (prevBase === incBase) {
    const prevNum = previous.slice(prevBase.length);
    const incNum = incoming.slice(incBase.length);
    if (!prevNum && /^[0-9]+$/.test(incNum)) return true;
    if (/^[0-9]+$/.test(prevNum) && /^[0-9]+$/.test(incNum)) return Number(incNum) > Number(prevNum);
    return false;
  }
  if (prevBase.length !== 1 || incBase.length !== 1) return false;
  const prevIndex = HEBREW_LETTERS.indexOf(prevBase);
  const nextIndex = HEBREW_LETTERS.indexOf(incBase);
  return prevIndex >= 0 && nextIndex > prevIndex;
}

export function numberContinuesSequence(previous: string, incoming: string): boolean {
  if (!/^[0-9]+$/.test(previous) || !/^[0-9]+$/.test(incoming)) return false;
  return Number(incoming) > Number(previous);
}

export function recomposeParenthesizedInner(inner: string): string | null {
  const pieces = inner
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/\s+/g, ''))
    .filter(Boolean);
  if (!pieces.length) return null;
  const hasHebrew = pieces.some((part) => /[א-ת]/u.test(part));
  const hasDigit = pieces.some((part) => /[0-9]/.test(part));
  let ordered = pieces;
  if (hasHebrew && hasDigit) {
    const firstHebrew = pieces.findIndex((part) => /[א-ת]/u.test(part));
    const firstDigit = pieces.findIndex((part) => /[0-9]/.test(part));
    if (firstDigit >= 0 && firstHebrew > firstDigit) ordered = pieces.slice().reverse();
  } else if (hasHebrew && pieces.length > 1) {
    ordered = pieces.slice().reverse();
  }
  const component = ordered.join('');
  return isValidNestedComponent(component) ? component : null;
}

export function printedMarkerForNestedComponent(component: string): string {
  return `(${component})`;
}

export function parseIsolatedNestedMarker(text: string): string | null {
  const match = text.trim().match(ISOLATED_MARKER_RE);
  if (!match) return null;
  return recomposeParenthesizedInner(match[1] ?? '');
}

function collectParenthesizedComponents(text: string): string[] {
  const markers: string[] = [];
  const finder = new RegExp(PAREN_GROUP_RE.source, 'gu');
  let match: RegExpExecArray | null;
  while ((match = finder.exec(text))) {
    const component = recomposeParenthesizedInner(match[1] ?? '');
    if (component) markers.push(component);
  }
  return markers;
}

export type LayoutParenToken = {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function sameMarkerLine(left: LayoutParenToken, right: LayoutParenToken): boolean {
  const tol = Math.max(2, Math.max(left.h, right.h, 8) * 0.45);
  return Math.abs(left.y - right.y) <= tol;
}

function isOpenParenToken(text: string): boolean {
  return /^\(\s*[^)]*$/.test(text.trim());
}

function isCloseParenToken(text: string): boolean {
  return /^[^(\[]*\)\s*$/.test(text.trim());
}

export function extractParenthesizedMarkersFromTokens(
  items: LayoutParenToken[],
): Array<{ component: string; printed_marker: string }> {
  const lines: LayoutParenToken[][] = [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const line = lines.find((row) => row.every((other) => sameMarkerLine(other, item)));
    if (line) line.push(item);
    else lines.push([item]);
  }
  const out: Array<{ component: string; printed_marker: string }> = [];
  for (const line of lines) {
    const ltr = line.slice().sort((a, b) => a.x - b.x);
    let index = 0;
    while (index < ltr.length) {
      const current = ltr[index];
      const selfGroups = collectParenthesizedComponents(current.s);
      if (selfGroups.length && /\)/.test(current.s) && /\(/.test(current.s)) {
        for (const component of selfGroups) {
          out.push({ component, printed_marker: printedMarkerForNestedComponent(component) });
        }
        index += 1;
        continue;
      }
      if (!isOpenParenToken(current.s)) {
        index += 1;
        continue;
      }
      let closeIndex = -1;
      for (let look = index + 1; look < ltr.length; look += 1) {
        if (isOpenParenToken(ltr[look].s) && !isCloseParenToken(ltr[look].s)) break;
        if (isCloseParenToken(ltr[look].s)) {
          closeIndex = look;
          break;
        }
      }
      if (closeIndex < 0) {
        index += 1;
        continue;
      }
      const innerText = [
        current.s.replace(/^\(\s*/, ''),
        ...ltr.slice(index + 1, closeIndex).map((item) => item.s),
        ltr[closeIndex].s.replace(/\s*\)$/, ''),
      ]
        .join(' ')
        .replace(/[()]/g, ' ');
      const component = recomposeParenthesizedInner(innerText);
      if (component) out.push({ component, printed_marker: printedMarkerForNestedComponent(component) });
      index = closeIndex + 1;
    }
  }
  return out;
}

const SELF_REF_END = '(?:\\s|$|[.,;:–—\\-])';
const SELF_REF_SECTIONS_RE = new RegExp(`בסעיפים\\s+אלה${SELF_REF_END}`, 'u');
// Locative opener only: "בסעיף קטן זה" / leading "סעיף זה".
// Do not treat "לפי סעיף קטן זה" as a structure-defining self-reference.
const SELF_REF_SECTION_RE = new RegExp(
  `(?:^|[\\s,;:–—\\-])בסעיף(?:\\s+קטן)?\\s+זה${SELF_REF_END}`,
  'u',
);
const SELF_REF_BARE_SECTION_RE = new RegExp(`^סעיף(?:\\s+קטן)?\\s+זה${SELF_REF_END}`, 'u');

export function isSelfReferentialSectionPhrase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    SELF_REF_SECTION_RE.test(` ${trimmed}`) ||
    SELF_REF_BARE_SECTION_RE.test(trimmed) ||
    SELF_REF_SECTIONS_RE.test(trimmed)
  );
}

export function lineCitesExternalLegalProvision(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/(?:לפי|מכוח|כאמור|בהתאם)\s+(?:ל)?(?:ב)?סעיף/.test(trimmed)) return true;
  if (new RegExp(`(?:על\\s+פי|לענין)\\s+(?:ל)?(?:ב)?סעיף(?!\\s+(?:קטן\\s+)?זה${SELF_REF_END})`, 'u').test(trimmed)) {
    return true;
  }
  if (new RegExp(`(?:בסעיף|לסעיף)\\s+(?!(?:קטן\\s+)?זה${SELF_REF_END})\\S`, 'u').test(trimmed)) return true;
  if (/סעיפים\s+\d/.test(trimmed) || /ר'\s*סעיף/.test(trimmed)) return true;
  if (/כנוסחו/.test(trimmed)) return true;
  return false;
}

export function lineLooksLikeLegalApparatus(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /כנוסחו/.test(trimmed) ||
    /לפקודה,\s*כנוסחו/.test(trimmed) ||
    /ה["”]?ח\s+הממשלה/.test(trimmed) ||
    /י["”]?פ\s/.test(trimmed) ||
    /תחילתו\s+ביום/.test(trimmed) ||
    /לענין\s+תחולה/.test(trimmed) ||
    /הוראת\s+מעבר/.test(trimmed) ||
    /תיקון\s*מס/.test(trimmed) ||
    /עמ['׳"]?\s*\d+/.test(trimmed) ||
    /ס["”]?ח\s/.test(trimmed)
  );
}

export function lineLooksLikeDenseCitationParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const markers = collectParenthesizedComponents(trimmed);
  if (/פסקאות/.test(trimmed) && markers.length >= 1) return true;
  if (/\(\s*[^)]+\s*\)\s*עד\s*\(/.test(trimmed)) return true;
  if (markers.length >= 3 && (lineCitesExternalLegalProvision(trimmed) || lineLooksLikeLegalApparatus(trimmed))) {
    return true;
  }
  if (markers.length >= 4 && trimmed.length > 80) return true;
  if (/\d{1,4}[א-ת]?\s*\([^()]+\).*\d{1,4}[א-ת]?\s*\(/.test(trimmed)) return true;
  return false;
}

export function lineLooksLikeNestedBackReference(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\(\s*[^()]+\s*\)/.test(trimmed)) return false;
  if (/פסקאות/.test(trimmed)) return true;
  if (/(?:לפי|כאמור|על\s+פי|בהתאם)\s+(?:ל)?פסק/.test(trimmed)) return true;
  if (/ו-\s*\(\s*[^()]+\s*\)/.test(trimmed) && /פסק/.test(trimmed)) return true;
  if (/(?:^|[\s,;])או\s+\(\s*[^()]+\s*\)/.test(trimmed) && /פסק/.test(trimmed)) return true;
  return false;
}

export function lineLooksLikeNestedCitationNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (lineLooksLikeLegalApparatus(trimmed) || lineLooksLikeDenseCitationParagraph(trimmed)) return true;
  if (lineCitesExternalLegalProvision(trimmed)) return true;
  if (lineLooksLikeNestedBackReference(trimmed)) return true;
  if (/(?:הערת|שוליים|footnote)/i.test(trimmed)) return true;
  if (/(?:^|[\s,;])(?:לפי|מכוח|כאמור|בהתאם|על\s+פי|לענין)\s+(?:ל)?(?:ב)?סעיף/.test(trimmed)) return true;
  return false;
}

export function lineLooksLikeDefiningNestedStructure(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (lineLooksLikeDenseCitationParagraph(trimmed)) return false;
  if (lineCitesExternalLegalProvision(trimmed)) return false;
  const selfRef = isSelfReferentialSectionPhrase(trimmed);
  // Amendment stamps on the same printed line must not cancel a self-ref definition opener.
  if (lineLooksLikeLegalApparatus(trimmed) && !selfRef) return false;
  if (parseIsolatedNestedMarker(trimmed)) return true;
  const trailing = extractTrailingStructuralMarkers(trimmed);
  if (!trailing.length) return false;
  if (selfRef) return true;
  return trailing.some((marker) => marker.isolated);
}

export function extractTrailingStructuralMarkers(text: string): NestedStructureMarker[] {
  const original = text.trim();
  if (!original) return [];
  const selfRef = isSelfReferentialSectionPhrase(original);
  // Strip footnote callouts and amendment stamps so they do not hide real trailing markers.
  const trimmed = original
    .replace(/\([^)]*תיקון\s*מס[^)]*\)/g, ' ')
    .replace(/\[\s*\(?\s*\d+\s*\)?\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return [];
  if (/\[\s*\(\s*\d+\s*\)/.test(trimmed) && !selfRef) return [];
  if (/תיקון\s*מס/.test(trimmed) && /(?:19|20)\d{2}|תש/.test(trimmed) && !selfRef) return [];
  if (lineCitesExternalLegalProvision(trimmed)) return [];
  if (/הוראות\s+סעיף\s+קטן/.test(trimmed) && !selfRef) return [];
  if (/\(\s*[^)]+\s*\)\s*עד\s*\(/.test(trimmed) && !selfRef) return [];

  const tail = trimmed.match(TRAILING_MARKER_RUN_RE);
  if (!tail) return [];
  const markers = collectParenthesizedComponents(tail[1]);
  if (!markers.length) return [];
  const body = trimmed.slice(0, trimmed.length - tail[1].length).replace(/[;:,.\-–—]+$/g, '').trim();
  // Plural "פסקאות (1) ו-(2)" is a back-reference list, not a heading.
  // Singular "החזקה שבפסקה (2) ... (3)" still defines trailing (3).
  if (/פסקאות/.test(body) && markers.every((component) => /^[0-9]+/.test(component))) return [];
  if (markers.length === 1) {
    return [{ component: markers[0], title: body.slice(0, 60) || null, isolated: body.length <= 40 }];
  }
  // RTL print order: "( א ) ( 2 )" means subsection 2, then child א.
  return [
    { component: markers[markers.length - 1], title: body.slice(0, 60) || null, isolated: false },
    ...markers.slice(0, -1).map((component) => ({ component, title: null, isolated: false })),
  ];
}

export function isMixedSeifKatanComponent(component: string): boolean {
  return /[א-ת]/.test(component) && /[0-9]/.test(component);
}

export function lineLooksLikeQuotedDefinitionTerm(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 90) return false;
  return /["”„״][^"”„״]{2,40}["”„״]\s*[-–—:(]/.test(trimmed);
}

export function lineLooksLikeLeadingParenHeading(text: string): boolean {
  return /^\(\s*[^()]+\s*\)\s+\S/.test(text.trim());
}

export function extractLocativeSeifKatanMarker(text: string): { component: string; seif: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (lineLooksLikeDenseCitationParagraph(trimmed) && /פסקאות/.test(trimmed)) return null;
  const rtl = trimmed.match(/\(\s*([^()]+)\s*\)\s*([0-9]{1,3}[א-ת]?)\s*בסעיף\s*$/u);
  if (rtl) {
    const component = recomposeParenthesizedInner(rtl[1] ?? '');
    if (component) return { component, seif: rtl[2] };
  }
  const ltr = trimmed.match(/^בסעיף\s+([0-9]{1,3}[א-ת]?)\s*\(\s*([^()]+)\s*\)/u);
  if (ltr) {
    const component = recomposeParenthesizedInner(ltr[2] ?? '');
    if (component) return { component, seif: ltr[1] };
  }
  return null;
}

export function lineLooksLikeNewSeifKatanBoundary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (extractLocativeSeifKatanMarker(trimmed)) return true;
  const trailing = extractTrailingStructuralMarkers(trimmed);
  const letter = trailing.find((marker) => /^[א-ת]+$/.test(marker.component));
  if (!letter) return false;
  const body = (letter.title ?? '').trim() || trimmed.replace(/\(\s*[^()]+\s*\)/g, ' ').trim();
  if (/(?:רשאי|על אף האמור|בכפוף|בלי לגרוע|לענין סעיף קטן זה)/.test(trimmed)) return true;
  return body.length >= 45 && trailing.length === 1;
}

export function extractParenMarkersOnHeadingLine(text: string): string[] {
  if (/תיקון\s*מס/.test(text) || /\[\s*\(\s*\d+\s*\)/.test(text)) return [];
  return collectParenthesizedComponents(text);
}

export function extractNestedStructureMarker(text: string): NestedStructureMarker | null {
  const trimmed = text.trim();
  if (!trimmed || lineLooksLikeNestedCitationNoise(trimmed)) {
    const trailing = extractTrailingStructuralMarkers(trimmed);
    return trailing[0] ?? null;
  }

  const isolated = parseIsolatedNestedMarker(trimmed);
  if (isolated) return { component: isolated, title: null, isolated: true };

  const leading = trimmed.match(/^\(\s*([^()]+)\s*\)\s+(.+)$/u);
  if (leading) {
    const component = leading[1].replace(/\s+/g, '');
    const title = leading[2].trim();
    if (!isValidNestedComponent(component)) return null;
    if (lineLooksLikeNestedCitationNoise(title)) return null;
    return { component, title: title.slice(0, 60) || null, isolated: title.length <= 40 };
  }

  return extractTrailingStructuralMarkers(trimmed)[0] ?? null;
}

export function isolatedItemIsStructuralMarker(
  item: StoredTextItem,
  sameLineNeighbors: StoredTextItem[],
  profile: PageLayoutProfile,
): string | null {
  const component = parseIsolatedNestedMarker(item.s);
  if (!component) return null;
  if (item.y >= profile.header_y || item.y <= profile.footer_y) return null;
  if (profile.median_font_size > 0 && item.fs > 0 && item.fs < profile.median_font_size * 0.72) return null;
  const neighborText = sameLineNeighbors.map((row) => row.s).join(' ');
  if (lineLooksLikeLegalApparatus(neighborText) || lineLooksLikeDenseCitationParagraph(neighborText)) return null;
  if (lineCitesExternalLegalProvision(neighborText) && !isSelfReferentialSectionPhrase(neighborText)) return null;
  if (sameLineNeighbors.some((row) => /תיקון\s*מס/.test(row.s))) return null;
  return component;
}

export function nestedKindLabelsFromCatalog(catalog: StructureKindCatalogItem[]): {
  depth1: string | null;
  depth2: string | null;
  depth3: string | null;
} {
  const labels = usableKindCatalog(catalog).map((item) => item.label.trim());
  return {
    depth1: labels.find((label) => label === 'סעיף קטן') ?? labels.find((label) => /קטן/.test(label)) ?? null,
    depth2: labels.find((label) => label === 'פסקה') ?? null,
    depth3:
      labels.find((label) => label === 'פסקת משנה') ??
      labels.find((label) => label === 'תת-פסקה' || label === 'תת פסקה') ??
      null,
  };
}

export function kindLabelForNestedDepth(
  depth: NestedKindDepth,
  catalog: StructureKindCatalogItem[],
): string | null {
  const labels = nestedKindLabelsFromCatalog(catalog);
  if (depth === 1) return labels.depth1;
  if (depth === 2) return labels.depth2 ?? labels.depth1;
  return labels.depth3 ?? labels.depth2 ?? labels.depth1;
}

export type NestedStackEntry = {
  index: number;
  component: string;
  markerClass: NestedMarkerClass;
  depth: NestedKindDepth;
  display: string;
};

function componentContinues(previous: string, incoming: string, markerClass: NestedMarkerClass): boolean {
  return markerClass === 'letter'
    ? letterContinuesSequence(previous, incoming)
    : numberContinuesSequence(previous, incoming);
}

export function resolveNestedParent(
  stack: NestedStackEntry[],
  component: string,
  opts?: { preferSeifKatan?: boolean },
): { action: 'child' | 'sibling' | 'skip'; parent: NestedStackEntry | null } {
  const incomingClass = nestedMarkerClass(component);
  if (!stack.length) return { action: 'child', parent: null };

  const top = stack[stack.length - 1];
  const continuesTop =
    incomingClass === top.markerClass && componentContinues(top.component, component, incomingClass);
  // A long-body / רשאי letter is the next seif-katan only when it does not continue
  // the current nested letter list (e.g. 1(א)(2)(א) → (ב) stays under (2)).
  if (opts?.preferSeifKatan && incomingClass === 'letter' && !continuesTop) {
    const depth1 = stack.find((row) => row.depth === 1 && row.markerClass === 'letter');
    if (depth1 && componentContinues(depth1.component, component, 'letter')) {
      while (stack.length && stack[stack.length - 1] !== depth1) stack.pop();
      stack.pop();
      return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
    }
    stack.length = 0;
    return { action: 'child', parent: null };
  }

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (incomingClass === top.markerClass && top.component === component) {
      return { action: 'skip', parent: null };
    }
    if (incomingClass === top.markerClass) {
      if (componentContinues(top.component, component, incomingClass)) {
        stack.pop();
        return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
      }
      const shallower = [...stack.slice(0, -1)].reverse().find(
        (row) => row.markerClass === incomingClass && componentContinues(row.component, component, incomingClass),
      );
      if (shallower) {
        while (stack.length && stack[stack.length - 1] !== shallower) stack.pop();
        stack.pop();
        return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
      }
      stack.pop();
      return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
    }

    const sameClassAncestor = [...stack].reverse().find((row) => row.markerClass === incomingClass);
    if (sameClassAncestor && componentContinues(sameClassAncestor.component, component, incomingClass)) {
      while (stack.length && stack[stack.length - 1] !== sameClassAncestor) stack.pop();
      stack.pop();
      return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
    }

    if (top.depth < 3) return { action: 'child', parent: top };
    stack.pop();
  }

  return { action: 'child', parent: null };
}

export function sourceOccurrenceKey(draft: {
  page_start: number;
  source_line_index?: number;
  parent_index: number | null;
  kind_label: string;
  normalized_machine_identifier?: string | null;
}): string | null {
  const machine = draft.normalized_machine_identifier?.trim() || '';
  if (!machine) return null;
  const line = draft.source_line_index ?? -1;
  const parent = draft.parent_index ?? 'root';
  return `${draft.page_start}|${line}|${parent}|${draft.kind_label}|${machine}`;
}

function occurrenceQuality(draft: StructureCandidateDraft): number {
  let score = draft.confidence * 100;
  if (!draft.validation_warnings.includes('layout_needs_owner_review')) score += 30;
  if (draft.title && draft.title.trim()) score += 12;
  if (draft.title && !/לפי|כאמור|פסקאות|שבסעיף/.test(draft.title)) score += 8;
  if (draft.printed_marker) score += 4;
  score -= draft.validation_warnings.length * 6;
  if (draft.source_item_start != null && draft.source_item_end != null) {
    score += Math.max(0, 6 - Math.abs(draft.source_item_end - draft.source_item_start));
  }
  return score;
}

function titlesConflictForCollapse(left: StructureCandidateDraft, right: StructureCandidateDraft): boolean {
  const a = (left.title ?? '').trim();
  const b = (right.title ?? '').trim();
  if (!a || !b) return false;
  if (a === b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.startsWith(shorter) && shorter.length >= 12) return false;
  return true;
}

/**
 * Collapse detections of the same structural occurrence (same source span + parent + kind + id).
 * Different source lines/pages are not merged, even when the printed identifier repeats.
 */
export function collapseSameSourceOccurrenceDrafts(drafts: StructureCandidateDraft[]): {
  drafts: StructureCandidateDraft[];
  collapsed: number;
  ambiguous_groups: number;
} {
  const buckets = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const key = sourceOccurrenceKey(draft);
    if (!key) return;
    const list = buckets.get(key) ?? [];
    list.push(index);
    buckets.set(key, list);
  });

  const drop = new Set<number>();
  let collapsed = 0;
  let ambiguousGroups = 0;
  for (const indexes of buckets.values()) {
    if (indexes.length < 2) continue;
    const group = indexes.map((index) => drafts[index]);
    const conflicting = group.some((draft, index) =>
      group.slice(index + 1).some((other) => titlesConflictForCollapse(draft, other)),
    );
    if (conflicting) {
      ambiguousGroups += 1;
      for (const draft of group) {
        if (!draft.validation_warnings.includes('duplicate_sibling_identifier')) {
          draft.validation_warnings.push('duplicate_sibling_identifier');
        }
        draft.candidate_status = 'needs_review';
      }
      continue;
    }
    const winner = indexes.slice().sort((left, right) => {
      const quality = occurrenceQuality(drafts[right]) - occurrenceQuality(drafts[left]);
      if (quality !== 0) return quality;
      return left - right;
    })[0];
    for (const index of indexes) {
      if (index !== winner) {
        drop.add(index);
        collapsed += 1;
      }
    }
  }

  if (!drop.size) return { drafts, collapsed, ambiguous_groups: ambiguousGroups };

  const kept = drafts.filter((_, index) => !drop.has(index));
  const remap = new Map<number, number>();
  drafts.forEach((_, index) => {
    if (drop.has(index)) return;
    remap.set(index, remap.size);
  });
  const remapped = kept.map((draft) => ({
    ...draft,
    parent_index: draft.parent_index == null ? null : (remap.get(draft.parent_index) ?? null),
  }));
  return { drafts: remapped, collapsed, ambiguous_groups: ambiguousGroups };
}

/**
 * Same parent + kind + normalized id can exist at most once in a run.
 * Extra detections are dropped. If titles conflict, the survivor stays Needs review.
 */
export function dropSameParentIdentityDuplicates(drafts: StructureCandidateDraft[]): {
  drafts: StructureCandidateDraft[];
  dropped: number;
  ambiguous_resolved: number;
} {
  const buckets = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const machine = draft.normalized_machine_identifier?.trim() || '';
    if (!machine) return;
    const key = `${draft.parent_index ?? 'root'}|${draft.kind_label}|${machine}`;
    const list = buckets.get(key) ?? [];
    list.push(index);
    buckets.set(key, list);
  });
  const drop = new Set<number>();
  let dropped = 0;
  let ambiguousResolved = 0;
  for (const indexes of buckets.values()) {
    if (indexes.length < 2) continue;
    const conflicting = indexes.some((index, offset) =>
      indexes.slice(offset + 1).some((other) => titlesConflictForCollapse(drafts[index], drafts[other])),
    );
    const winner = indexes.slice().sort((left, right) => {
      const quality = occurrenceQuality(drafts[right]) - occurrenceQuality(drafts[left]);
      if (Math.abs(quality) > 15) return quality;
      return left - right;
    })[0];
    if (conflicting) {
      ambiguousResolved += 1;
      const draft = drafts[winner];
      if (!draft.validation_warnings.includes('duplicate_identity_resolved')) {
        draft.validation_warnings.push('duplicate_identity_resolved');
      }
      draft.candidate_status = 'needs_review';
    }
    for (const index of indexes) {
      if (index !== winner) {
        drop.add(index);
        dropped += 1;
      }
    }
  }
  if (!drop.size) return { drafts, dropped, ambiguous_resolved: ambiguousResolved };
  const kept = drafts.filter((_, index) => !drop.has(index));
  const remap = new Map<number, number>();
  drafts.forEach((_, index) => {
    if (drop.has(index)) return;
    remap.set(index, remap.size);
  });
  return {
    drafts: kept.map((draft) => ({
      ...draft,
      parent_index: draft.parent_index == null ? null : (remap.get(draft.parent_index) ?? null),
    })),
    dropped,
    ambiguous_resolved: ambiguousResolved,
  };
}

export function composeChildIdentifier(parentDisplay: string, component: string): LegalIdentifier | null {
  return parseLegalIdentifier(`${parentDisplay}(${component})`);
}

export function applyExactIdentifierToDraft(
  draft: StructureCandidateDraft,
  identifier: LegalIdentifier | null,
  sourcePrintedMarker?: string | null,
): StructureCandidateDraft {
  const fields = legalIdentifierFields(
    identifier
      ? {
          ...identifier,
          printed_marker:
            sourcePrintedMarker?.trim() || identifier.printed_marker,
        }
      : null,
  );
  return {
    ...draft,
    source_display_identifier: fields.source_display_identifier,
    normalized_machine_identifier: fields.normalized_machine_identifier,
    identifier_base_number: fields.identifier_base_number,
    identifier_letter_suffix: fields.identifier_letter_suffix,
    identifier_nested_components: fields.identifier_nested_components,
    printed_marker: fields.printed_marker,
  };
}

export function identifierForTopLevelDraft(draft: StructureCandidateDraft): LegalIdentifier | null {
  const raw = draft.source_display_identifier?.trim() || draft.node_number?.trim() || '';
  return raw ? parseLegalIdentifier(raw) : null;
}

export function titleFromFollowingLine(next?: LayoutLine): string | null {
  if (!next) return null;
  const text = next.text.trim();
  if (!text || text.length > 50) return null;
  if (parseIsolatedNestedMarker(text) || extractNestedStructureMarker(text)) return null;
  if (lineLooksLikeNestedCitationNoise(text) || !/[א-ת]{2,}/.test(text)) return null;
  return text.slice(0, 60);
}
