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
const TRAILING_MARKER_RUN_RE = /((?:\s*\(\s*(?:[0-9]{1,2}[א-ת]?|[א-ת]{1,2}[0-9]{0,2})\s*\))+)\s*$/u;
const PAREN_COMPONENT_RE = /\(\s*([0-9]{1,2}[א-ת]?|[א-ת]{1,2}[0-9]{0,2})\s*\)/gu;

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

export function letterContinuesSequence(previous: string, incoming: string): boolean {
  if (previous.length !== 1 || incoming.length !== 1) return false;
  const prevIndex = HEBREW_LETTERS.indexOf(previous);
  const nextIndex = HEBREW_LETTERS.indexOf(incoming);
  return prevIndex >= 0 && nextIndex > prevIndex;
}

export function numberContinuesSequence(previous: string, incoming: string): boolean {
  if (!/^[0-9]+$/.test(previous) || !/^[0-9]+$/.test(incoming)) return false;
  return Number(incoming) > Number(previous);
}

export function parseIsolatedNestedMarker(text: string): string | null {
  const compact = text.replace(/\s+/g, '');
  const match = compact.match(ISOLATED_MARKER_RE);
  if (!match) return null;
  const inner = match[1];
  return isValidNestedComponent(inner) ? inner : null;
}

export function lineLooksLikeNestedCitationNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/(?:לפי|מכוח|כאמור|בהתאם|על\s+פי|לענין)\s+(?:ל)?(?:ב)?סעיף/.test(trimmed)) return true;
  if (/(?:בסעיף|לסעיף)\s+\S/.test(trimmed) || /סעיפים\s+\d/.test(trimmed) || /ר'\s*סעיף/.test(trimmed)) return true;
  if (/תיקון\s*מס/.test(trimmed) || /עמ['׳"]?\s*\d+/.test(trimmed) || /ס["”]?ח\s/.test(trimmed)) return true;
  if (/(?:הערת|שוליים|footnote)/i.test(trimmed)) return true;
  if (/(?:^|[\s,;])(?:לפי|מכוח|כאמור|בהתאם|על\s+פי|לענין|ר')/.test(trimmed)) return true;
  if (/סעיף/.test(trimmed)) return true;
  if (/\d{1,4}[א-ת]?\s*\([^()]+\).*\d{1,4}[א-ת]?\s*\(/.test(trimmed)) return true;
  return false;
}

export function extractTrailingStructuralMarkers(text: string): NestedStructureMarker[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/\[\s*\(\s*\d+\s*\)/.test(trimmed)) return [];
  if (/תיקון\s*מס/.test(trimmed) && /(?:19|20)\d{2}|תש/.test(trimmed)) return [];
  if (/(?:לפי|מכוח|כאמור|בהתאם|על\s+פי|לענין)\s+(?:ל)?(?:ב)?סעיף/.test(trimmed)) return [];
  if (/(?:בסעיף|לסעיף)\s+\S/.test(trimmed) || /סעיפים\s+\d/.test(trimmed)) return [];
  if (/הוראות\s+סעיף\s+קטן/.test(trimmed)) return [];

  const tail = trimmed.match(TRAILING_MARKER_RUN_RE);
  if (!tail) return [];
  const markers: string[] = [];
  let match: RegExpExecArray | null;
  const finder = new RegExp(PAREN_COMPONENT_RE.source, 'gu');
  while ((match = finder.exec(tail[1]))) {
    const component = match[1].replace(/\s+/g, '');
    if (isValidNestedComponent(component)) markers.push(component);
  }
  if (!markers.length) return [];
  const body = trimmed.slice(0, trimmed.length - tail[1].length).replace(/[;:,.\-–—]+$/g, '').trim();
  if (/פסקאות/.test(body) && markers.length > 1) {
    return [{ component: markers[markers.length - 1], title: body.slice(0, 60) || null, isolated: false }];
  }
  if (markers.length === 1) {
    return [{ component: markers[0], title: body.slice(0, 60) || null, isolated: body.length <= 40 }];
  }
  // RTL print order: "( א ) ( 2 )" means subsection 2, then child א.
  return [
    { component: markers[markers.length - 1], title: body.slice(0, 60) || null, isolated: false },
    ...markers.slice(0, -1).map((component) => ({ component, title: null, isolated: false })),
  ];
}

export function extractParenMarkersOnHeadingLine(text: string): string[] {
  if (/תיקון\s*מס/.test(text) || /\[\s*\(\s*\d+\s*\)/.test(text)) return [];
  const markers: string[] = [];
  const finder = new RegExp(PAREN_COMPONENT_RE.source, 'gu');
  let match: RegExpExecArray | null;
  while ((match = finder.exec(text))) {
    const component = match[1].replace(/\s+/g, '');
    if (isValidNestedComponent(component)) markers.push(component);
  }
  return markers;
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
  if (lineLooksLikeNestedCitationNoise(neighborText)) return null;
  if (sameLineNeighbors.some((row) => /סעיף|לפי|כאמור|תיקון/.test(row.s))) return null;
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
    depth3: labels.find((label) => label === 'תת-פסקה' || label === 'תת פסקה') ?? null,
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

export function resolveNestedParent(
  stack: NestedStackEntry[],
  component: string,
): { action: 'child' | 'sibling'; parent: NestedStackEntry | null } {
  const incomingClass = nestedMarkerClass(component);
  if (!stack.length) return { action: 'child', parent: null };

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (incomingClass === top.markerClass) {
      stack.pop();
      return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
    }

    const sameClassAncestor = [...stack].reverse().find((row) => row.markerClass === incomingClass);
    if (sameClassAncestor) {
      const continues =
        incomingClass === 'letter'
          ? letterContinuesSequence(sameClassAncestor.component, component)
          : numberContinuesSequence(sameClassAncestor.component, component);
      if (continues) {
        while (stack.length && stack[stack.length - 1] !== sameClassAncestor) stack.pop();
        stack.pop();
        return { action: 'sibling', parent: stack[stack.length - 1] ?? null };
      }
    }

    if (top.depth < 3) return { action: 'child', parent: top };
    stack.pop();
  }

  return { action: 'child', parent: null };
}

export function composeChildIdentifier(parentDisplay: string, component: string): LegalIdentifier | null {
  return parseLegalIdentifier(`${parentDisplay}(${component})`);
}

export function applyExactIdentifierToDraft(
  draft: StructureCandidateDraft,
  identifier: LegalIdentifier | null,
): StructureCandidateDraft {
  const fields = legalIdentifierFields(identifier);
  return {
    ...draft,
    source_display_identifier: fields.source_display_identifier,
    normalized_machine_identifier: fields.normalized_machine_identifier,
    identifier_base_number: fields.identifier_base_number,
    identifier_letter_suffix: fields.identifier_letter_suffix,
    identifier_nested_components: fields.identifier_nested_components,
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
