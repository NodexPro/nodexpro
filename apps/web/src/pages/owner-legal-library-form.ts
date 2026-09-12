import type { OwnerLegalLibraryNode, OwnerLegalLibrarySource } from './owner-legal-control-types';

/** Matches backend legalNodeDisplayTitle. Presentation only. */
export function legalStructureItemPreview(kindLabel: string, number: string, officialTitle: string): string {
  const head = [kindLabel.trim(), number.trim()].filter(Boolean).join(' ');
  const title = officialTitle.trim();
  if (head && title) return `${head} — ${title}`;
  return head || title;
}

export function flattenLegalLibraryNodes(
  nodes: OwnerLegalLibraryNode[],
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (list: OwnerLegalLibraryNode[]) => {
    for (const node of list) {
      out.push({ id: node.id, label: node.display_title || node.title });
      if (node.children.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function findLegalLibrarySource(
  sources: OwnerLegalLibrarySource[],
  sourceId: string,
): OwnerLegalLibrarySource | null {
  return sources.find((source) => source.id === sourceId) ?? null;
}
