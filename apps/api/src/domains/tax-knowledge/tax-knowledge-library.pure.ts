export const LEGAL_LIBRARY_SCHEMA_NOT_APPLIED = 'tax_legal_library_schema_not_applied';

export const TAX_LEGAL_LIBRARY_COMMANDS = [
  'create_tax_domain',
  'update_tax_domain_metadata',
  'create_tax_legal_node_kind',
  'create_tax_legal_node',
  'update_tax_legal_node_metadata',
  'link_tax_rule_legal_node',
  'unlink_tax_rule_legal_node',
] as const;

export type TaxLegalLibraryCommandName = (typeof TAX_LEGAL_LIBRARY_COMMANDS)[number];

export type LegalLibraryLinkedRuleView = {
  link_id: string;
  tax_rule_id: string;
  tax_legal_node_id: string;
  title: string;
  rule_code: string;
  status: string;
  version_count: number;
};

export type LegalLibraryNodeRow = {
  id: string;
  tax_source_id: string;
  parent_node_id: string | null;
  tax_legal_node_kind_id: string;
  kind_label: string;
  node_code: string;
  node_number: string | null;
  title: string;
  sort_order: number;
  status: string;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
};

export type LegalLibraryNestedNode = LegalLibraryNodeRow & {
  linked_rules: LegalLibraryLinkedRuleView[];
  children: LegalLibraryNestedNode[];
};

export type LegalLibrarySourceRow = {
  id: string;
  tax_domain_id: string | null;
  title: string;
  provenance_type: string;
  status: string;
  issuer: string | null;
  source_code: string;
};

export type LegalLibraryDomainRow = {
  id: string;
  domain_code: string;
  title: string;
  status: string;
  owner_note: string | null;
  sort_order: number;
};

export type LegalLibraryRuleRow = {
  id: string;
  title: string;
  rule_code: string;
  status: string;
  version_count: number;
};

export type AssembledLegalLibrary = {
  domains: Array<LegalLibraryDomainRow & { sources: Array<LegalLibrarySourceRow & { nodes: LegalLibraryNestedNode[] }> }>;
  unassigned_sources: Array<LegalLibrarySourceRow & { nodes: LegalLibraryNestedNode[] }>;
  unassigned_rules: LegalLibraryRuleRow[];
};

/** ASCII slug for machine codes. Hebrew/non-latin titles yield an empty slug. */
export function slugifyLegalCodeFragment(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Backend-generated stable machine identifier.
 * Owner UX must not invent UUID / domain_code / source_code / rule_code / kind_code / node_code.
 */
/** Human structure label: "חלק א — <official title>". Codes are never part of this. */
export function legalNodeDisplayTitle(kindLabel: string, nodeNumber: string | null, title: string): string {
  const head = [kindLabel, nodeNumber].filter((part) => part && part.trim()).join(' ').trim();
  const official = title.trim();
  if (head && official) return `${head} — ${official}`;
  return head || official;
}

export function generateLegalMachineCode(prefix: string, title: string, uniqueSuffix: string): string {
  const slug = slugifyLegalCodeFragment(title);
  const tail = uniqueSuffix.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
  const body = slug && tail ? `${prefix}_${slug}_${tail}` : slug ? `${prefix}_${slug}` : `${prefix}_${tail || 'id'}`;
  return body.slice(0, 80);
}

export function nestLegalNodesForSource(
  sourceId: string,
  nodes: LegalLibraryNodeRow[],
  linkedRulesByNodeId: Map<string, LegalLibraryLinkedRuleView[]>,
): LegalLibraryNestedNode[] {
  const forSource = nodes
    .filter((node) => node.tax_source_id === sourceId)
    .slice()
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.title.localeCompare(b.title);
    });
  const byParent = new Map<string | null, LegalLibraryNodeRow[]>();
  for (const node of forSource) {
    const key = node.parent_node_id;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }

  const walk = (parentId: string | null): LegalLibraryNestedNode[] => {
    return (byParent.get(parentId) ?? []).map((node) => ({
      ...node,
      linked_rules: linkedRulesByNodeId.get(node.id) ?? [],
      children: walk(node.id),
    }));
  };

  return walk(null);
}

export function assembleLegalLibrary(input: {
  domains: LegalLibraryDomainRow[];
  sources: LegalLibrarySourceRow[];
  nodes: LegalLibraryNodeRow[];
  rules: LegalLibraryRuleRow[];
  links: Array<{ id: string; tax_rule_id: string; tax_legal_node_id: string }>;
}): AssembledLegalLibrary {
  const ruleById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const linkedRulesByNodeId = new Map<string, LegalLibraryLinkedRuleView[]>();
  const linkedRuleIds = new Set<string>();
  for (const link of input.links) {
    const rule = ruleById.get(link.tax_rule_id);
    if (!rule) continue;
    linkedRuleIds.add(rule.id);
    const list = linkedRulesByNodeId.get(link.tax_legal_node_id) ?? [];
    list.push({
      link_id: link.id,
      tax_rule_id: rule.id,
      tax_legal_node_id: link.tax_legal_node_id,
      title: rule.title,
      rule_code: rule.rule_code,
      status: rule.status,
      version_count: rule.version_count,
    });
    linkedRulesByNodeId.set(link.tax_legal_node_id, list);
  }

  const withNodes = (source: LegalLibrarySourceRow) => ({
    ...source,
    nodes: nestLegalNodesForSource(source.id, input.nodes, linkedRulesByNodeId),
  });

  const assigned = input.sources.filter((source) => source.tax_domain_id);
  const unassigned_sources = input.sources.filter((source) => !source.tax_domain_id).map(withNodes);

  const domains = input.domains
    .slice()
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.title.localeCompare(b.title);
    })
    .map((domain) => ({
      ...domain,
      sources: assigned.filter((source) => source.tax_domain_id === domain.id).map(withNodes),
    }));

  const unassigned_rules = input.rules.filter((rule) => !linkedRuleIds.has(rule.id));

  return { domains, unassigned_sources, unassigned_rules };
}
