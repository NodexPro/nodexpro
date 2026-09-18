const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TAX_KNOWLEDGE_PROPOSAL_CANNOT_DETERMINE_MESSAGE =
  'Applicability cannot be determined from this Owner Draft' as const;

/** Intentionally invalid JS slice so unbound verbatim quotes fail TAX-639 `fake_evidence_span`. */
export const UNBOUND_VERBATIM_SPAN = { start: 0, end: 0 } as const;

export type TaxKnowledgeProposalCanonicalAllowlist = {
  tax_legal_node_ids: readonly string[];
  tax_source_ids: readonly string[];
};

export type NormalizeTaxKnowledgeProposalExtractInput = {
  draftLegalText: string;
  allowlist: TaxKnowledgeProposalCanonicalAllowlist;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function allowlistedUuid(value: unknown, allowed: ReadonlySet<string>): string | null {
  if (!isUuid(value)) return null;
  const id = value.trim();
  return allowed.has(id) ? id : null;
}

function asObjectItems(value: unknown): Array<Record<string, unknown> | unknown> {
  return Array.isArray(value) ? value : [];
}

function remapKey(value: unknown, map: Map<string, string>): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return map.get(value.trim()) ?? null;
}

function remapStringArray(value: unknown, map: Map<string, string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== 'string') return item;
    return map.get(item.trim()) ?? item;
  });
}

function assignLocalKeys(
  items: Array<Record<string, unknown> | unknown>,
  field: string,
  prefix: string,
): Map<string, string> {
  const map = new Map<string, string>();
  items.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const next = `${prefix}_${index + 1}`;
    const old = typeof item[field] === 'string' ? item[field].trim() : '';
    if (old && !map.has(old)) map.set(old, next);
    item[field] = next;
  });
  return map;
}

export function findExactTextOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    out.push(index);
    from = index + 1;
  }
  return out;
}

export function bindVerbatimEvidenceSpan(
  draftLegalText: string,
  quoteText: string,
): { start: number; end: number } | null {
  const hits = findExactTextOccurrences(draftLegalText, quoteText);
  if (hits.length !== 1) return null;
  const start = hits[0] ?? 0;
  return { start, end: start + quoteText.length };
}

function normalizeParent(
  parent: unknown,
  nodeKeyMap: Map<string, string>,
  legalNodeIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (parent === undefined || parent === null) return null;
  if (!isPlainObject(parent)) return null;
  const remappedKey = remapKey(parent.key, nodeKeyMap);
  const existingId = allowlistedUuid(parent.tax_legal_node_id, legalNodeIds);
  if (parent.kind === 'existing' && existingId) {
    return { kind: 'existing', key: null, tax_legal_node_id: existingId };
  }
  if (remappedKey) {
    return { kind: 'proposal_node', key: remappedKey, tax_legal_node_id: null };
  }
  return null;
}

function normalizeEndpoint(
  endpoint: unknown,
  ruleKeyMap: Map<string, string>,
): Record<string, unknown> | unknown {
  if (!isPlainObject(endpoint)) return endpoint;
  const next: Record<string, unknown> = { ...endpoint };
  if (next.kind === 'proposal_rule') {
    const remapped = remapKey(next.key, ruleKeyMap);
    if (remapped) next.key = remapped;
    next.tax_rule_version_id = null;
    return next;
  }
  next.tax_rule_version_id = null;
  if (next.kind !== 'unresolved') {
    next.key = remapKey(next.key, ruleKeyMap) ?? (typeof next.key === 'string' ? next.key : null);
  }
  return next;
}

function stripNonAllowlistedUuidField(
  obj: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
): void {
  if (!(field in obj)) return;
  obj[field] = allowlistedUuid(obj[field], allowed);
}

function remapUncertaintySubject(
  subject: unknown,
  nodeKeyMap: Map<string, string>,
  ruleKeyMap: Map<string, string>,
  calcKeyMap: Map<string, string>,
): Record<string, unknown> | null | unknown {
  if (subject === undefined) return subject;
  if (subject === null) return null;
  if (!isPlainObject(subject)) return subject;
  const next: Record<string, unknown> = { ...subject };
  const kind = typeof next.kind === 'string' ? next.kind : '';
  const map = kind === 'node' ? nodeKeyMap : kind === 'rule' ? ruleKeyMap : kind === 'calculation' ? calcKeyMap : null;
  if (map) {
    const remapped = remapKey(next.key, map);
    if (remapped) next.key = remapped;
  }
  return next;
}

function ensureCannotDetermineUncertainties(
  proposal: Record<string, unknown>,
  ruleKeyByIndex: string[],
): void {
  const rules = asObjectItems(proposal.rules);
  const uncertainties = Array.isArray(proposal.uncertainties) ? [...proposal.uncertainties] : [];
  rules.forEach((rule, index) => {
    if (!isPlainObject(rule)) return;
    if (rule.applicability_status !== 'cannot_determine') return;
    const key = ruleKeyByIndex[index];
    if (!key) return;
    const matchIndex = uncertainties.findIndex((row) => {
      if (!isPlainObject(row)) return false;
      if (row.code !== 'cannot_determine') return false;
      if (!isPlainObject(row.subject)) return false;
      return row.subject.kind === 'rule' && row.subject.key === key;
    });
    if (matchIndex >= 0) {
      const row = uncertainties[matchIndex];
      if (isPlainObject(row)) {
        row.severity = 'blocks_rule_publication';
        if (!isPlainObject(row.subject)) {
          row.subject = { kind: 'rule', key };
        } else {
          row.subject.kind = 'rule';
          row.subject.key = key;
        }
        if (typeof row.message !== 'string' || !row.message.trim()) {
          row.message = TAX_KNOWLEDGE_PROPOSAL_CANNOT_DETERMINE_MESSAGE;
        }
      }
      return;
    }
    uncertainties.push({
      code: 'cannot_determine',
      severity: 'blocks_rule_publication',
      subject: { kind: 'rule', key },
      message: TAX_KNOWLEDGE_PROPOSAL_CANNOT_DETERMINE_MESSAGE,
      detail: null,
    });
  });
  proposal.uncertainties = uncertainties;
}

function bindEvidenceQuotes(proposal: Record<string, unknown>, draftLegalText: string): void {
  if (!isPlainObject(proposal.evidence)) return;
  const quotes = asObjectItems(proposal.evidence.quotes);
  quotes.forEach((quote) => {
    if (!isPlainObject(quote)) return;
    if (quote.role !== 'verbatim_from_draft') return;
    const text = typeof quote.text === 'string' ? quote.text : '';
    const bound = bindVerbatimEvidenceSpan(draftLegalText, text);
    if (bound) {
      quote.start = bound.start;
      quote.end = bound.end;
      return;
    }
    quote.start = UNBOUND_VERBATIM_SPAN.start;
    quote.end = UNBOUND_VERBATIM_SPAN.end;
  });
}

export function emptyTaxKnowledgeProposalCanonicalAllowlist(): TaxKnowledgeProposalCanonicalAllowlist {
  return { tax_legal_node_ids: [], tax_source_ids: [] };
}

export function normalizeTaxKnowledgeProposalExtract(
  raw: unknown,
  input: NormalizeTaxKnowledgeProposalExtractInput,
): unknown {
  if (!isPlainObject(raw)) return raw;
  const proposal = cloneJson(raw);
  if (!isPlainObject(proposal)) return raw;

  const legalNodeIds = new Set(input.allowlist.tax_legal_node_ids.filter((id) => UUID_RE.test(id)));
  const taxSourceIds = new Set(input.allowlist.tax_source_ids.filter((id) => UUID_RE.test(id)));

  const legalNodes = asObjectItems(proposal.legal_nodes);
  const rules = asObjectItems(proposal.rules);
  const calculations = asObjectItems(proposal.calculations);

  const nodeKeyMap = assignLocalKeys(legalNodes, 'proposal_node_key', 'node');
  const ruleKeyMap = assignLocalKeys(rules, 'proposal_rule_key', 'rule');
  const calcKeyMap = assignLocalKeys(calculations, 'proposal_calc_key', 'calc');
  const ruleKeyByIndex = rules.map((rule, index) =>
    isPlainObject(rule) && typeof rule.proposal_rule_key === 'string' ? rule.proposal_rule_key : `rule_${index + 1}`,
  );

  legalNodes.forEach((node) => {
    if (!isPlainObject(node)) return;
    stripNonAllowlistedUuidField(node, 'existing_tax_legal_node_id', legalNodeIds);
    node.tax_legal_node_kind_id = null;
    node.parent = normalizeParent(node.parent, nodeKeyMap, legalNodeIds);
  });

  rules.forEach((rule) => {
    if (!isPlainObject(rule)) return;
    stripNonAllowlistedUuidField(rule, 'existing_tax_rule_id', new Set());
    rule.legal_node_keys = remapStringArray(rule.legal_node_keys, nodeKeyMap);
    rule.calculation_keys = remapStringArray(rule.calculation_keys, calcKeyMap);
    if (Array.isArray(rule.existing_tax_legal_node_ids)) {
      rule.existing_tax_legal_node_ids = rule.existing_tax_legal_node_ids
        .map((id) => allowlistedUuid(id, legalNodeIds))
        .filter((id): id is string => Boolean(id));
    }
  });

  calculations.forEach((calc) => {
    if (!isPlainObject(calc)) return;
    calc.pin_rule_keys = remapStringArray(calc.pin_rule_keys, ruleKeyMap);
  });

  const relationships = asObjectItems(proposal.relationships);
  relationships.forEach((rel, index) => {
    if (!isPlainObject(rel)) return;
    rel.from = normalizeEndpoint(rel.from, ruleKeyMap);
    rel.to = normalizeEndpoint(rel.to, ruleKeyMap);
    if (isPlainObject(rel.unresolved)) {
      stripNonAllowlistedUuidField(rel.unresolved, 'source_tax_source_id', taxSourceIds);
    }
    proposal.relationships = proposal.relationships ?? [];
    if (Array.isArray(proposal.relationships)) proposal.relationships[index] = rel;
  });

  asObjectItems(proposal.facts).forEach((fact) => {
    if (!isPlainObject(fact)) return;
    fact.existing_tax_fact_definition_id = null;
  });
  asObjectItems(proposal.legal_values).forEach((value) => {
    if (!isPlainObject(value)) return;
    value.existing_legal_value_id = null;
  });

  if (isPlainObject(proposal.evidence) && Array.isArray(proposal.evidence.citations)) {
    proposal.evidence.citations.forEach((citation) => {
      if (!isPlainObject(citation)) return;
      stripNonAllowlistedUuidField(citation, 'tax_source_id', taxSourceIds);
    });
  }

  const uncertainties = asObjectItems(proposal.uncertainties);
  uncertainties.forEach((row, index) => {
    if (!isPlainObject(row)) return;
    row.subject = remapUncertaintySubject(row.subject, nodeKeyMap, ruleKeyMap, calcKeyMap);
    if (Array.isArray(proposal.uncertainties)) proposal.uncertainties[index] = row;
  });

  bindEvidenceQuotes(proposal, input.draftLegalText);
  ensureCannotDetermineUncertainties(proposal, ruleKeyByIndex);
  return proposal;
}
