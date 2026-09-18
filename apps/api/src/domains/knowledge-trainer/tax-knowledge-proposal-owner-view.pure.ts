import type { TaxKnowledgeProposalV1ValidationSummary } from './tax-knowledge-proposal-v1.types.js';

export type TaxKnowledgeProposalOwnerViewRow = {
  label: string;
  value: string;
};

export type TaxKnowledgeProposalOwnerViewRule = {
  title: string;
  statement: string;
  applicability_status_label: string;
  applies_if: string | null;
  does_not_apply_if: string | null;
  notes: string | null;
};

export type TaxKnowledgeProposalOwnerViewItem = {
  label: string;
  detail: string | null;
};

export type TaxKnowledgeProposalOwnerViewDto = {
  available: boolean;
  heading: string;
  question: string;
  empty_title: string;
  empty_detail: string;
  status_label: string;
  revision_label: string;
  understanding_summary: string;
  publication_eligible_label: string;
  owner_approval_allowed_label: string;
  rules: TaxKnowledgeProposalOwnerViewRule[];
  facts_title: string;
  facts_empty_label: string;
  facts: TaxKnowledgeProposalOwnerViewItem[];
  legal_values_title: string;
  legal_values_empty_label: string;
  legal_values: TaxKnowledgeProposalOwnerViewItem[];
  relationships_title: string;
  relationships_empty_label: string;
  relationships: TaxKnowledgeProposalOwnerViewItem[];
  calculations_title: string;
  calculations_empty_label: string;
  calculations: TaxKnowledgeProposalOwnerViewItem[];
  evidence_title: string;
  evidence_empty_label: string;
  evidence_locator: string | null;
  evidence_quotes: TaxKnowledgeProposalOwnerViewItem[];
  evidence_citations: TaxKnowledgeProposalOwnerViewItem[];
  uncertainties_title: string;
  uncertainties_empty_label: string;
  uncertainties: TaxKnowledgeProposalOwnerViewItem[];
  technical_title: string;
  technical_rows: TaxKnowledgeProposalOwnerViewRow[];
};

const HEADING = 'AI Proposal / הצעת AI';
const QUESTION = 'What did AI understand from this law?';
const EMPTY_TITLE = 'No AI proposal yet / טרם נוצרה הצעת AI';
const EMPTY_DETAIL = 'Selecting a Draft does not generate an AI proposal.';
const NONE = 'None recorded / לא נרשם';
const TECHNICAL_TITLE = 'Technical details';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function yesNoLabel(value: boolean, yes: string, no: string): string {
  return value ? yes : no;
}

function applicabilityStatusLabel(status: string): string {
  switch (status) {
    case 'determined':
      return 'Determined / נקבע';
    case 'unconstrained':
      return 'Unconstrained / ללא תנאי';
    case 'cannot_determine':
      return 'Cannot determine / לא ניתן לקבוע';
    default:
      return status || '—';
  }
}

function factRoleLabel(role: string): string {
  switch (role) {
    case 'applicability_condition':
      return 'Applicability condition';
    case 'required_missing':
      return 'Required / missing';
    case 'informational':
      return 'Informational';
    case 'calculation_input':
      return 'Calculation input';
    default:
      return role;
  }
}

function dictionaryStatusLabel(status: string): string {
  switch (status) {
    case 'bound_existing':
      return 'Bound to Fact Dictionary';
    case 'missing_definition':
      return 'Missing Fact Dictionary definition';
    case 'reserved_forbidden':
      return 'Reserved / forbidden';
    default:
      return status;
  }
}

function quoteRoleLabel(role: string): string {
  switch (role) {
    case 'verbatim_from_draft':
      return 'Verbatim from draft / ציטוט מדויק מהטיוטה';
    case 'ai_paraphrase':
      return 'AI paraphrase / ניסוח AI';
    default:
      return role || 'Quote';
  }
}

function severityLabel(severity: string): string {
  switch (severity) {
    case 'blocks_rule_publication':
      return 'Blocks publication';
    case 'blocks_activation_only':
      return 'Blocks activation only';
    case 'review_only':
      return 'Review only';
    default:
      return severity || 'Uncertainty';
  }
}

function formatPredicate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(formatPredicate).filter((row): row is string => Boolean(row));
    return parts.length ? parts.join('; ') : null;
  }
  if (!isPlainObject(value)) return null;
  const factKey = asString(value.fact_key);
  if (factKey) {
    const op = asString(value.op);
    const rhs = formatPredicate(value.value);
    return [factKey, op, rhs].filter(Boolean).join(' ');
  }
  if ('all' in value) {
    const inner = formatPredicate(value.all);
    return inner ? `All: ${inner}` : null;
  }
  if ('any' in value) {
    const inner = formatPredicate(value.any);
    return inner ? `Any: ${inner}` : null;
  }
  if ('not' in value) {
    const inner = formatPredicate(value.not);
    return inner ? `Not: ${inner}` : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function endpointLabel(endpoint: unknown): string {
  if (!isPlainObject(endpoint)) return '—';
  if (asString(endpoint.kind) === 'unresolved') {
    const unresolved = isPlainObject(endpoint.unresolved) ? endpoint.unresolved : {};
    return asString(unresolved.locator_text) || asString(unresolved.cited_title) || 'Unresolved reference';
  }
  return asString(endpoint.key) || asString(endpoint.tax_rule_version_id) || asString(endpoint.kind) || '—';
}

function emptyView(): TaxKnowledgeProposalOwnerViewDto {
  return {
    available: false,
    heading: HEADING,
    question: QUESTION,
    empty_title: EMPTY_TITLE,
    empty_detail: EMPTY_DETAIL,
    status_label: '',
    revision_label: '',
    understanding_summary: '',
    publication_eligible_label: '',
    owner_approval_allowed_label: '',
    rules: [],
    facts_title: 'Required / referenced facts',
    facts_empty_label: NONE,
    facts: [],
    legal_values_title: 'Legal values',
    legal_values_empty_label: NONE,
    legal_values: [],
    relationships_title: 'Relationships',
    relationships_empty_label: NONE,
    relationships: [],
    calculations_title: 'Calculations',
    calculations_empty_label: NONE,
    calculations: [],
    evidence_title: 'Evidence / source citation',
    evidence_empty_label: NONE,
    evidence_locator: null,
    evidence_quotes: [],
    evidence_citations: [],
    uncertainties_title: 'Uncertainties / missing information',
    uncertainties_empty_label: NONE,
    uncertainties: [],
    technical_title: TECHNICAL_TITLE,
    technical_rows: [],
  };
}

export function emptyTaxKnowledgeProposalOwnerView(): TaxKnowledgeProposalOwnerViewDto {
  return emptyView();
}

export function buildTaxKnowledgeProposalOwnerView(input: {
  selected: {
    id: string;
    revision_no: number;
    status: string;
    status_label: string;
    creation_origin: string;
    legal_text_draft_id: string;
  } | null;
  proposal_json: Record<string, unknown> | null;
  validation: TaxKnowledgeProposalV1ValidationSummary | null;
}): TaxKnowledgeProposalOwnerViewDto {
  const base = emptyView();
  if (!input.selected || !input.proposal_json) return base;

  const json = input.proposal_json;
  const validation = input.validation;
  const rulesRaw = asArray(json.rules).filter(isPlainObject);
  const factsRaw = asArray(json.facts).filter(isPlainObject);
  const legalValuesRaw = asArray(json.legal_values).filter(isPlainObject);
  const relationshipsRaw = asArray(json.relationships).filter(isPlainObject);
  const calculationsRaw = asArray(json.calculations).filter(isPlainObject);
  const uncertaintiesRaw = asArray(json.uncertainties).filter(isPlainObject);
  const evidence = isPlainObject(json.evidence) ? json.evidence : {};
  const locator = isPlainObject(evidence.legal_locator) ? evidence.legal_locator : {};
  const quotes = asArray(evidence.quotes).filter(isPlainObject);
  const citations = asArray(evidence.citations).filter(isPlainObject);

  const rules = rulesRaw.map((rule) => ({
    title: asString(rule.title) || 'Untitled rule',
    statement: asString(rule.statement),
    applicability_status_label: applicabilityStatusLabel(asString(rule.applicability_status)),
    applies_if: formatPredicate(rule.applies_if),
    does_not_apply_if: formatPredicate(rule.does_not_apply_if),
    notes: asString(rule.notes) || null,
  }));

  const factsFromProposal = factsRaw.map((fact) => {
    const key = asString(fact.fact_key) || 'fact';
    const role = asString(fact.role);
    const status = asString(fact.dictionary_status);
    const parts = [role ? factRoleLabel(role) : null, status ? dictionaryStatusLabel(status) : null].filter(Boolean);
    return { label: key, detail: parts.length ? parts.join(' · ') : null };
  });
  const factsFromResolved = (validation?.resolved_fact_bindings ?? []).map((row) => ({
    label: row.fact_key,
    detail: [factRoleLabel(row.role), dictionaryStatusLabel(row.dictionary_status)].filter(Boolean).join(' · '),
  }));
  const facts = factsFromProposal.length ? factsFromProposal : factsFromResolved;

  const legalValuesFromProposal = legalValuesRaw.map((row) => ({
    label: asString(row.value_key) || 'legal value',
    detail: asString(row.existing_legal_value_id) || null,
  }));
  const legalValuesFromResolved = (validation?.resolved_legal_values ?? []).map((row) => ({
    label: row.value_key,
    detail: row.legal_value_id,
  }));
  const legal_values = legalValuesFromProposal.length ? legalValuesFromProposal : legalValuesFromResolved;

  const relationships = relationshipsRaw.map((row) => ({
    label: `${endpointLabel(row.from)} → ${endpointLabel(row.to)}`,
    detail: asString(row.relationship_type) || null,
  }));

  const calculations = calculationsRaw.map((row) => ({
    label: asString(row.title) || asString(row.proposal_calc_key) || 'Calculation',
    detail: asString(row.expression) || null,
  }));

  const evidence_quotes = quotes.map((row) => ({
    label: quoteRoleLabel(asString(row.role)),
    detail: asString(row.text) || null,
  }));
  const evidence_citations = citations.map((row) => ({
    label: asString(row.locator) || 'Citation',
    detail: asString(row.tax_source_id) || null,
  }));
  const evidence_locator =
    asString(locator.source_display_identifier) || asString(locator.normalized_machine_identifier) || null;

  const blocking = validation?.blocking_uncertainties ?? [];
  const uncertaintySource = blocking.length ? blocking : uncertaintiesRaw;
  const uncertainties = uncertaintySource.map((row) => {
    const rec = isPlainObject(row) ? row : {};
    const severity = asString(rec.severity);
    const message = asString(rec.message);
    const detail = asString(rec.detail) || null;
    return {
      label: severityLabel(severity),
      detail: [message, detail].filter(Boolean).join(' ') || null,
    };
  });

  const extractionOutcome = asString(json.extraction_outcome);
  const understanding: string[] = [];
  if (extractionOutcome === 'rules' && rules.length) {
    understanding.push(rules.length === 1 ? 'AI extracted a legal rule.' : `AI extracted ${rules.length} legal rules.`);
    if (rules[0]?.statement) understanding.push(rules[0].statement);
  } else if (extractionOutcome === 'no_rules') {
    understanding.push('AI did not extract a legal rule from this draft.');
  } else if (extractionOutcome === 'cannot_determine') {
    understanding.push('AI could not determine the legal meaning of this draft.');
  } else if (rules[0]?.statement) {
    understanding.push(rules[0].statement);
  }
  if (rulesRaw.some((rule) => asString(rule.applicability_status) === 'cannot_determine')) {
    understanding.push('Applicability cannot yet be determined.');
  }
  for (const row of uncertainties) {
    if (row.detail) understanding.push(row.detail);
  }

  const technical_rows: TaxKnowledgeProposalOwnerViewRow[] = [
    { label: 'Proposal ID', value: input.selected.id },
    { label: 'Draft ID', value: input.selected.legal_text_draft_id },
    { label: 'Origin', value: input.selected.creation_origin },
    { label: 'Extraction outcome', value: extractionOutcome || '—' },
  ];

  return {
    ...base,
    available: true,
    status_label: input.selected.status_label,
    revision_label: `Revision ${input.selected.revision_no}`,
    understanding_summary: understanding.join(' '),
    publication_eligible_label: yesNoLabel(
      validation?.publication_eligible === true,
      'Yes — currently eligible / כן — זכאי לפרסום כרגע',
      'No — not currently eligible / לא — אינו זכאי לפרסום כרגע',
    ),
    owner_approval_allowed_label: yesNoLabel(
      validation?.owner_approval_allowed === true,
      'Yes — Owner approval is allowed / כן — אישור Owner מותר',
      'No — Owner approval is not allowed / לא — אישור Owner אינו מותר',
    ),
    rules,
    facts,
    legal_values,
    relationships,
    calculations,
    evidence_locator,
    evidence_quotes,
    evidence_citations,
    uncertainties,
    technical_rows,
  };
}
