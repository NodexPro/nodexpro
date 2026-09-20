import { parseAndValidatePredicate } from '../tax-rule-engine/tax-rule-engine-predicate.pure.js';
import {
  isCanonicalIsoDate,
  type TaxRuleEngineFactType,
} from '../tax-rule-engine/tax-rule-engine.types.js';
import { parseLegalIdentifier } from '../tax-knowledge/legal-identifier.pure.js';
import { parseActivationCritical } from '../tax-knowledge/tax-knowledge-unresolved.pure.js';
import { FACT_KEY_SNAKE_CASE, RESERVED_FACT_KEY } from '../tax-fact-dictionary/tax-fact-dictionary.types.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_APPLICABILITY_STATUSES,
  TAX_KNOWLEDGE_PROPOSAL_CALC_KEYS as CALC_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_CALC_OUTPUT_TYPES,
  TAX_KNOWLEDGE_PROPOSAL_CITATION_KEYS as CITATION_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_CITED_INSTRUMENT_KINDS,
  TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
  TAX_KNOWLEDGE_PROPOSAL_ENDPOINT_KEYS as ENDPOINT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_KEYS as EVIDENCE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_QUOTE_ROLES,
  TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_SOURCE_ROLE,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACTION_OUTCOMES,
  TAX_KNOWLEDGE_PROPOSAL_FACT_DICTIONARY_STATUSES,
  TAX_KNOWLEDGE_PROPOSAL_FACT_KEYS as FACT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_FACT_ROLES,
  TAX_KNOWLEDGE_PROPOSAL_FORBIDDEN_IDENTITY_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_LEGAL_VALUE_KEYS as LEGAL_VALUE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_LOCATOR_KEYS as LOCATOR_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_NODE_KEYS as NODE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_PARENT_KEYS as PARENT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_QUOTE_KEYS as QUOTE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_KEYS as REL_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_TYPES,
  TAX_KNOWLEDGE_PROPOSAL_RULE_KEYS as RULE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_STATUTORY_LITERAL_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_SUBJECT_KEYS as SUBJECT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_CODES,
  TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_KEYS as UNCERTAINTY_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_SEVERITIES,
  TAX_KNOWLEDGE_PROPOSAL_UNRESOLVED_KEYS as UNRESOLVED_KEYS,
  type TaxKnowledgeProposalApplicabilityStatus,
  type TaxKnowledgeProposalCatalogFact,
  type TaxKnowledgeProposalEvidenceQuoteRole,
  type TaxKnowledgeProposalEvidenceValidation,
  type TaxKnowledgeProposalExtractionOutcome,
  type TaxKnowledgeProposalFactDictionaryStatus,
  type TaxKnowledgeProposalFactRole,
  type TaxKnowledgeProposalIssue,
  type TaxKnowledgeProposalResolvedExistingRuleRef,
  type TaxKnowledgeProposalResolvedFactBinding,
  type TaxKnowledgeProposalResolvedLegalValue,
  type TaxKnowledgeProposalUncertainty,
  type TaxKnowledgeProposalUncertaintyCode,
  type TaxKnowledgeProposalUncertaintySeverity,
  type TaxKnowledgeProposalV1ValidationResult,
  type TaxKnowledgeProposalV1ValidationSummary,
  type TaxKnowledgeProposalValidationCatalog,
  type TaxKnowledgeProposalValidationContext,
} from './tax-knowledge-proposal-v1.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TOP_LEVEL_KEY_SET = new Set<string>(TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS);
const STATUTORY_KEY_SET = new Set<string>(TAX_KNOWLEDGE_PROPOSAL_STATUTORY_LITERAL_KEYS);
const PROSE_KEYS = new Set([
  'text',
  'statement',
  'notes',
  'message',
  'title',
  'usage_hint',
  'owner_note',
  'locator',
  'locator_text',
  'source_locator',
  'cited_title',
  'cited_law_name',
  'cited_provision_number',
  'kind_label',
  'source_display_identifier',
  'printed_marker',
  'node_number',
  'detail',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyEvidence(draftLength: number): TaxKnowledgeProposalEvidenceValidation {
  return {
    draft_legal_text_length: draftLength,
    verbatim_quote_count: 0,
    paraphrase_quote_count: 0,
    citation_count: 0,
    authoritative_evidence: false,
    quotes: [],
  };
}

export function emptyTaxKnowledgeProposalValidationResult(
  draftLegalText = '',
): TaxKnowledgeProposalV1ValidationResult {
  return {
    valid_schema: false,
    publication_eligible: false,
    owner_approval_allowed: false,
    errors: [],
    warnings: [],
    blocking_uncertainties: [],
    resolved_fact_bindings: [],
    resolved_legal_values: [],
    resolved_existing_rule_refs: [],
    evidence_validation: emptyEvidence(draftLegalText.length),
  };
}

export function summarizeTaxKnowledgeProposalValidation(
  result: TaxKnowledgeProposalV1ValidationResult,
): TaxKnowledgeProposalV1ValidationSummary {
  return {
    valid_schema: result.valid_schema,
    publication_eligible: result.publication_eligible,
    owner_approval_allowed: result.owner_approval_allowed,
    error_count: result.errors.length,
    warning_count: result.warnings.length,
    blocking_uncertainty_count: result.blocking_uncertainties.length,
    errors: result.errors,
    warnings: result.warnings,
    blocking_uncertainties: result.blocking_uncertainties,
    resolved_fact_bindings: result.resolved_fact_bindings,
    resolved_legal_values: result.resolved_legal_values,
    resolved_existing_rule_refs: result.resolved_existing_rule_refs,
    evidence_validation: result.evidence_validation,
  };
}

export function canOwnerApproveTaxKnowledgeProposal(
  result: Pick<TaxKnowledgeProposalV1ValidationResult, 'valid_schema' | 'blocking_uncertainties'>,
): boolean {
  return (
    result.valid_schema &&
    !result.blocking_uncertainties.some((row) => row.severity === 'blocks_rule_publication')
  );
}

function pushIssue(list: TaxKnowledgeProposalIssue[], path: string, code: string, message: string): void {
  list.push({ path, code, message });
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): void {
  const allowedSet = new Set<string>(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      pushIssue(errors, `${path}.${key}`, 'unknown_field', `Unknown field ${key} is not part of tax_knowledge_proposal_v1`);
    }
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asLocalKey(value: unknown, path: string, errors: TaxKnowledgeProposalIssue[]): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    pushIssue(errors, path, 'local_key_required', 'Local proposal key is required');
    return null;
  }
  const key = value.trim();
  if (UUID_RE.test(key)) {
    pushIssue(errors, path, 'invented_canonical_id', 'Local proposal keys must not be canonical UUIDs');
    return null;
  }
  if (!LOCAL_KEY_RE.test(key)) {
    pushIssue(errors, path, 'local_key_invalid', 'Local proposal key must be an identifier, not a canonical code');
    return null;
  }
  return key;
}

function asOptionalUuid(value: unknown, path: string, errors: TaxKnowledgeProposalIssue[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) {
    pushIssue(errors, path, 'invalid_canonical_id', 'Canonical reference must be an existing UUID');
    return null;
  }
  return value.trim();
}

function asStringArray(value: unknown, path: string, errors: TaxKnowledgeProposalIssue[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    pushIssue(errors, path, 'type', `${path} must be an array`);
    return [];
  }
  const out: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      pushIssue(errors, `${path}[${index}]`, 'type', 'Array members must be non-empty strings');
      return;
    }
    out.push(item.trim());
  });
  return out;
}

function asObjectArray(value: unknown, path: string, errors: TaxKnowledgeProposalIssue[]): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    pushIssue(errors, path, 'type', `${path} must be an array`);
    return [];
  }
  const out: Record<string, unknown>[] = [];
  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      pushIssue(errors, `${path}[${index}]`, 'type', 'Array members must be objects');
      return;
    }
    out.push(item);
  });
  return out;
}

function scanStatutoryLiterals(
  value: unknown,
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStatutoryLiterals(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (STATUTORY_KEY_SET.has(key)) {
      pushIssue(
        errors,
        `${path}.${key}`,
        'forbidden_statutory_literal',
        'Statutory rates, ceilings, amounts, and percentages are Country Pack legal values, not proposal semantics',
      );
    }
    if (PROSE_KEYS.has(key) && typeof child === 'string') continue;
    scanStatutoryLiterals(child, `${path}.${key}`, errors);
  }
}

function scanForbiddenIdentityKeys(
  value: unknown,
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenIdentityKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if ((TAX_KNOWLEDGE_PROPOSAL_FORBIDDEN_IDENTITY_KEYS as readonly string[]).includes(key)) {
      pushIssue(
        errors,
        `${path}.${key}`,
        'forbidden_identity_code',
        `${key} is backend-generated and must not be supplied`,
      );
    }
    scanForbiddenIdentityKeys(child, `${path}.${key}`, errors);
  }
}

export function collectPredicateFactLeaves(
  node: unknown,
): Array<{ fact: string; type: string | null }> {
  const leaves: Array<{ fact: string; type: string | null }> = [];
  const walk = (value: unknown): void => {
    if (!isPlainObject(value)) return;
    if (Array.isArray(value.all)) {
      value.all.forEach(walk);
      return;
    }
    if (Array.isArray(value.any)) {
      value.any.forEach(walk);
      return;
    }
    if ('not' in value) {
      walk(value.not);
      return;
    }
    if (typeof value.fact === 'string' && value.fact.trim()) {
      leaves.push({
        fact: value.fact.trim(),
        type: typeof value.type === 'string' ? value.type : null,
      });
    }
  };
  walk(node);
  return leaves;
}

function dictionaryTypeToK3(valueType: string | null): TaxRuleEngineFactType | null {
  switch (valueType) {
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'enum':
      return 'enum';
    case 'string':
      return 'string';
    case 'integer':
    case 'decimal':
    case 'money':
    case 'percentage':
      return 'number';
    default:
      return null;
  }
}

function resolveFactDefinition(
  factKey: string,
  countryCode: string,
  catalog: TaxKnowledgeProposalValidationCatalog,
): TaxKnowledgeProposalCatalogFact | null {
  const matches = catalog.facts.filter(
    (row) => row.fact_key === factKey && row.status !== 'retired',
  );
  return (
    matches.find((row) => row.country_code === countryCode) ??
    matches.find((row) => row.country_code == null) ??
    null
  );
}

function resolveLegalValue(
  valueKey: string,
  countryCode: string,
  catalog: TaxKnowledgeProposalValidationCatalog,
) {
  return (
    catalog.legal_values.find(
      (row) =>
        row.value_key === valueKey &&
        row.country_code === countryCode &&
        row.status !== 'disabled' &&
        row.status !== 'retired',
    ) ?? null
  );
}

function byId<T extends { id: string }>(rows: T[], id: string | null): T | null {
  if (!id) return null;
  return rows.find((row) => row.id === id) ?? null;
}

function sameCountry(actual: string | null | undefined, expected: string, path: string, errors: TaxKnowledgeProposalIssue[]): boolean {
  if (!actual) return false;
  if (actual !== expected) {
    pushIssue(errors, path, 'cross_country_reference', `Referenced object country ${actual} does not match proposal country ${expected}`);
    return false;
  }
  return true;
}

function parseUncertainties(
  raw: Record<string, unknown>[],
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): TaxKnowledgeProposalUncertainty[] {
  const out: TaxKnowledgeProposalUncertainty[] = [];
  raw.forEach((row, index) => {
    const at = `${path}[${index}]`;
    rejectUnknownKeys(row, UNCERTAINTY_KEYS, at, errors);
    const codeRaw = asTrimmedString(row.code);
    const severityRaw = asTrimmedString(row.severity);
    if (!codeRaw || !(TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_CODES as readonly string[]).includes(codeRaw)) {
      pushIssue(errors, `${at}.code`, 'uncertainty_code', 'Uncertainty code is not in the closed TAX-638 vocabulary');
      return;
    }
    if (
      !severityRaw ||
      !(TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_SEVERITIES as readonly string[]).includes(severityRaw)
    ) {
      pushIssue(errors, `${at}.severity`, 'uncertainty_severity', 'Uncertainty severity is invalid');
      return;
    }
    let subject: TaxKnowledgeProposalUncertainty['subject'] = null;
    if (row.subject !== undefined && row.subject !== null) {
      if (!isPlainObject(row.subject)) {
        pushIssue(errors, `${at}.subject`, 'type', 'subject must be an object or null');
      } else {
        rejectUnknownKeys(row.subject, SUBJECT_KEYS, `${at}.subject`, errors);
        const kind = asTrimmedString(row.subject.kind);
        const allowedKinds = ['proposal', 'rule', 'node', 'calculation', 'fact', 'legal_value', 'relationship'];
        if (!kind || !allowedKinds.includes(kind)) {
          pushIssue(errors, `${at}.subject.kind`, 'type', 'subject.kind is invalid');
        } else {
          const key =
            row.subject.key === undefined || row.subject.key === null || row.subject.key === ''
              ? null
              : asTrimmedString(row.subject.key);
          subject = { kind: kind as NonNullable<TaxKnowledgeProposalUncertainty['subject']>['kind'], key };
        }
      }
    }
    const message = asTrimmedString(row.message);
    if (!message) {
      pushIssue(errors, `${at}.message`, 'required', 'Uncertainty message is required');
      return;
    }
    out.push({
      code: codeRaw as TaxKnowledgeProposalUncertaintyCode,
      severity: severityRaw as TaxKnowledgeProposalUncertaintySeverity,
      subject,
      message,
      detail: asTrimmedString(row.detail),
    });
  });
  return out;
}

function validateIdentifier(
  sourceDisplay: string | null,
  normalized: string | null,
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): void {
  if (!sourceDisplay) return;
  const parsed = parseLegalIdentifier(sourceDisplay);
  if (!parsed) {
    pushIssue(errors, `${path}.source_display_identifier`, 'legal_identifier', 'source_display_identifier is not a valid exact legal identifier');
    return;
  }
  if (normalized && normalized !== parsed.normalized_machine_identifier) {
    pushIssue(
      errors,
      `${path}.normalized_machine_identifier`,
      'legal_identifier',
      'normalized_machine_identifier must match the existing legal identifier parser',
    );
  }
}

export type TaxKnowledgeProposalCatalogRefs = {
  legal_node_ids: string[];
  legal_node_kind_ids: string[];
  tax_rule_ids: string[];
  tax_rule_version_ids: string[];
  tax_source_ids: string[];
  legal_value_ids: string[];
  fact_keys: string[];
  value_keys: string[];
};

function pushUnique(list: string[], value: string | null | undefined): void {
  if (!value || list.includes(value)) return;
  list.push(value);
}

export function collectTaxKnowledgeProposalCatalogRefs(raw: unknown): TaxKnowledgeProposalCatalogRefs {
  const refs: TaxKnowledgeProposalCatalogRefs = {
    legal_node_ids: [],
    legal_node_kind_ids: [],
    tax_rule_ids: [],
    tax_rule_version_ids: [],
    tax_source_ids: [],
    legal_value_ids: [],
    fact_keys: [],
    value_keys: [],
  };
  if (!isPlainObject(raw)) return refs;
  const addEndpoint = (endpoint: unknown) => {
    if (!isPlainObject(endpoint)) return;
    if (endpoint.kind === 'existing_rule_version' && typeof endpoint.tax_rule_version_id === 'string') {
      pushUnique(refs.tax_rule_version_ids, endpoint.tax_rule_version_id.trim());
    }
    if (isPlainObject(endpoint.unresolved) && typeof endpoint.unresolved.source_tax_source_id === 'string') {
      pushUnique(refs.tax_source_ids, endpoint.unresolved.source_tax_source_id.trim());
    }
  };
  for (const node of Array.isArray(raw.legal_nodes) ? raw.legal_nodes : []) {
    if (!isPlainObject(node)) continue;
    if (typeof node.existing_tax_legal_node_id === 'string') pushUnique(refs.legal_node_ids, node.existing_tax_legal_node_id.trim());
    if (typeof node.tax_legal_node_kind_id === 'string') pushUnique(refs.legal_node_kind_ids, node.tax_legal_node_kind_id.trim());
    if (isPlainObject(node.parent) && typeof node.parent.tax_legal_node_id === 'string') {
      pushUnique(refs.legal_node_ids, node.parent.tax_legal_node_id.trim());
    }
  }
  for (const rule of Array.isArray(raw.rules) ? raw.rules : []) {
    if (!isPlainObject(rule)) continue;
    if (typeof rule.existing_tax_rule_id === 'string') pushUnique(refs.tax_rule_ids, rule.existing_tax_rule_id.trim());
    for (const id of Array.isArray(rule.existing_tax_legal_node_ids) ? rule.existing_tax_legal_node_ids : []) {
      if (typeof id === 'string') pushUnique(refs.legal_node_ids, id.trim());
    }
    for (const key of Array.isArray(rule.legal_value_keys) ? rule.legal_value_keys : []) {
      if (typeof key === 'string') pushUnique(refs.value_keys, key.trim());
    }
    for (const leaf of [...collectPredicateFactLeaves(rule.applies_if), ...collectPredicateFactLeaves(rule.does_not_apply_if)]) {
      pushUnique(refs.fact_keys, leaf.fact);
    }
  }
  for (const rel of Array.isArray(raw.relationships) ? raw.relationships : []) {
    if (!isPlainObject(rel)) continue;
    addEndpoint(rel.from);
    addEndpoint(rel.to);
    if (isPlainObject(rel.unresolved) && typeof rel.unresolved.source_tax_source_id === 'string') {
      pushUnique(refs.tax_source_ids, rel.unresolved.source_tax_source_id.trim());
    }
  }
  for (const calc of Array.isArray(raw.calculations) ? raw.calculations : []) {
    if (!isPlainObject(calc)) continue;
    for (const key of Array.isArray(calc.input_fact_keys) ? calc.input_fact_keys : []) {
      if (typeof key === 'string') pushUnique(refs.fact_keys, key.trim());
    }
    for (const key of Array.isArray(calc.legal_value_keys) ? calc.legal_value_keys : []) {
      if (typeof key === 'string') pushUnique(refs.value_keys, key.trim());
    }
  }
  for (const fact of Array.isArray(raw.facts) ? raw.facts : []) {
    if (!isPlainObject(fact)) continue;
    if (typeof fact.fact_key === 'string') pushUnique(refs.fact_keys, fact.fact_key.trim());
    if (typeof fact.existing_tax_fact_definition_id === 'string') {
      /* definition ids are resolved via fact_key catalog, not a separate table fetch beyond facts */
    }
  }
  for (const value of Array.isArray(raw.legal_values) ? raw.legal_values : []) {
    if (!isPlainObject(value)) continue;
    if (typeof value.value_key === 'string') pushUnique(refs.value_keys, value.value_key.trim());
    if (typeof value.existing_legal_value_id === 'string') pushUnique(refs.legal_value_ids, value.existing_legal_value_id.trim());
  }
  if (isPlainObject(raw.evidence) && Array.isArray(raw.evidence.citations)) {
    for (const citation of raw.evidence.citations) {
      if (isPlainObject(citation) && typeof citation.tax_source_id === 'string') {
        pushUnique(refs.tax_source_ids, citation.tax_source_id.trim());
      }
    }
  }
  return refs;
}

function validatePredicateField(
  value: unknown,
  path: string,
  errors: TaxKnowledgeProposalIssue[],
): boolean {
  if (value === undefined || value === null) return true;
  const validated = parseAndValidatePredicate(value);
  if (!validated.ok) {
    pushIssue(errors, path, 'invalid_predicate', validated.message);
    return false;
  }
  return true;
}

export function validateTaxKnowledgeProposalV1(input: {
  proposal_json: unknown;
  context: TaxKnowledgeProposalValidationContext;
  catalog: TaxKnowledgeProposalValidationCatalog;
}): TaxKnowledgeProposalV1ValidationResult {
  const errors: TaxKnowledgeProposalIssue[] = [];
  const warnings: TaxKnowledgeProposalIssue[] = [];
  const resolvedFacts: TaxKnowledgeProposalResolvedFactBinding[] = [];
  const resolvedLegalValues: TaxKnowledgeProposalResolvedLegalValue[] = [];
  const resolvedRuleRefs: TaxKnowledgeProposalResolvedExistingRuleRef[] = [];
  const country = input.context.country_code.trim().toUpperCase();
  const draftText = input.context.draft_legal_text ?? '';
  const evidenceValidation = emptyEvidence(draftText.length);

  if (!isPlainObject(input.proposal_json)) {
    pushIssue(errors, 'proposal_json', 'type', 'proposal_json must be an object');
    const result = emptyTaxKnowledgeProposalValidationResult(draftText);
    result.errors = errors;
    return result;
  }

  const raw = input.proposal_json;
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEY_SET.has(key)) {
      pushIssue(errors, key, 'unknown_field', `Unknown top-level field ${key} is not part of tax_knowledge_proposal_v1`);
    }
  }
  for (const key of TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS) {
    if (!(key in raw)) {
      pushIssue(errors, key, 'required', `${key} is required`);
    }
  }

  scanForbiddenIdentityKeys(raw, 'proposal_json', errors);
  scanStatutoryLiterals(raw, 'proposal_json', errors);

  if (raw.schema_version !== TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION) {
    pushIssue(errors, 'schema_version', 'schema_version', 'schema_version must be 1');
  }
  if (raw.contract !== TAX_KNOWLEDGE_PROPOSAL_CONTRACT) {
    pushIssue(errors, 'contract', 'contract', 'contract must be tax_knowledge_proposal_v1');
  }

  const outcomeRaw = asTrimmedString(raw.extraction_outcome);
  const outcome = (TAX_KNOWLEDGE_PROPOSAL_EXTRACTION_OUTCOMES as readonly string[]).includes(outcomeRaw ?? '')
    ? (outcomeRaw as TaxKnowledgeProposalExtractionOutcome)
    : null;
  if (!outcome) {
    pushIssue(errors, 'extraction_outcome', 'extraction_outcome', 'extraction_outcome must be rules, no_rules, or cannot_determine');
  }

  const legalNodes = asObjectArray(raw.legal_nodes ?? [], 'legal_nodes', errors);
  const rules = asObjectArray(raw.rules ?? [], 'rules', errors);
  const relationships = asObjectArray(raw.relationships ?? [], 'relationships', errors);
  const calculations = asObjectArray(raw.calculations ?? [], 'calculations', errors);
  const facts = asObjectArray(raw.facts ?? [], 'facts', errors);
  const legalValues = asObjectArray(raw.legal_values ?? [], 'legal_values', errors);
  const uncertaintiesRaw = asObjectArray(raw.uncertainties ?? [], 'uncertainties', errors);
  const evidence = isPlainObject(raw.evidence) ? raw.evidence : null;
  if (raw.evidence !== undefined && !evidence) {
    pushIssue(errors, 'evidence', 'type', 'evidence must be an object');
  }

  if (outcome && outcome !== 'rules' && rules.length > 0) {
    pushIssue(errors, 'rules', 'extraction_outcome', 'rules must be [] when extraction_outcome is not rules');
  }
  if (outcome === 'rules' && rules.length === 0) {
    pushIssue(errors, 'rules', 'extraction_outcome', 'extraction_outcome=rules requires one or more rules');
  }

  const nodeKeys = new Set<string>();
  const ruleKeys = new Set<string>();
  const calcKeys = new Set<string>();
  const declaredFacts = new Map<string, { role: TaxKnowledgeProposalFactRole; path: string; requestedId: string | null; requestedStatus: TaxKnowledgeProposalFactDictionaryStatus | null }>();
  const declaredValueKeys = new Set<string>();

  legalNodes.forEach((node, index) => {
    const at = `legal_nodes[${index}]`;
    rejectUnknownKeys(node, NODE_KEYS, at, errors);
    const key = asLocalKey(node.proposal_node_key, `${at}.proposal_node_key`, errors);
    if (key) {
      if (nodeKeys.has(key)) pushIssue(errors, `${at}.proposal_node_key`, 'duplicate_local_key', 'proposal_node_key must be unique');
      nodeKeys.add(key);
    }
    const existingId = asOptionalUuid(node.existing_tax_legal_node_id, `${at}.existing_tax_legal_node_id`, errors);
    if (existingId) {
      const found = byId(input.catalog.legal_nodes, existingId);
      if (!found) {
        pushIssue(errors, `${at}.existing_tax_legal_node_id`, 'invalid_canonical_id', 'existing_tax_legal_node_id does not exist');
      } else {
        sameCountry(found.country_code, country, `${at}.existing_tax_legal_node_id`, errors);
      }
    }
    const kindId = asOptionalUuid(node.tax_legal_node_kind_id, `${at}.tax_legal_node_kind_id`, errors);
    if (kindId) {
      const kind = byId(input.catalog.legal_node_kinds, kindId);
      if (!kind) {
        pushIssue(errors, `${at}.tax_legal_node_kind_id`, 'invalid_canonical_id', 'tax_legal_node_kind_id does not exist');
      } else {
        sameCountry(kind.country_code, country, `${at}.tax_legal_node_kind_id`, errors);
      }
    }
    const sourceDisplay = asTrimmedString(node.source_display_identifier);
    validateIdentifier(sourceDisplay, null, at, errors);
    if (!existingId && !sourceDisplay) {
      pushIssue(errors, at, 'legal_identity', 'Proposed legal node must match an existing node or supply source_display_identifier');
    }
    if (!existingId && !asTrimmedString(node.title)) {
      pushIssue(errors, `${at}.title`, 'required', 'title is required when creating a legal node');
    }
    if (node.parent !== undefined && node.parent !== null) {
      if (!isPlainObject(node.parent)) {
        pushIssue(errors, `${at}.parent`, 'type', 'parent must be an object');
      } else {
        rejectUnknownKeys(node.parent, PARENT_KEYS, `${at}.parent`, errors);
        const kind = asTrimmedString(node.parent.kind);
        if (kind === 'proposal_node') {
          const parentKey = asLocalKey(node.parent.key, `${at}.parent.key`, errors);
          if (parentKey && !legalNodes.some((candidate) => candidate.proposal_node_key === parentKey)) {
            pushIssue(errors, `${at}.parent.key`, 'unknown_local_key', 'parent proposal_node_key is not in legal_nodes');
          }
        } else if (kind === 'existing') {
          const parentId = asOptionalUuid(node.parent.tax_legal_node_id, `${at}.parent.tax_legal_node_id`, errors);
          const found = byId(input.catalog.legal_nodes, parentId);
          if (parentId && !found) {
            pushIssue(errors, `${at}.parent.tax_legal_node_id`, 'invalid_canonical_id', 'parent tax_legal_node_id does not exist');
          } else if (found) {
            sameCountry(found.country_code, country, `${at}.parent.tax_legal_node_id`, errors);
            if (found.tax_source_id !== input.context.tax_source_id) {
              pushIssue(errors, `${at}.parent.tax_legal_node_id`, 'cross_source_reference', 'parent legal node must belong to the pinned tax source');
            }
          }
        } else {
          pushIssue(errors, `${at}.parent.kind`, 'type', 'parent.kind must be proposal_node or existing');
        }
      }
    }
  });

  const parsedUncertainties = parseUncertainties(uncertaintiesRaw, 'uncertainties', errors);
  if (outcome === 'cannot_determine' && !parsedUncertainties.some((row) => row.code === 'cannot_determine')) {
    pushIssue(errors, 'uncertainties', 'cannot_determine', 'extraction_outcome=cannot_determine requires a cannot_determine uncertainty');
  }

  const rulePublicationFlags: boolean[] = [];

  rules.forEach((rule, index) => {
    const at = `rules[${index}]`;
    rejectUnknownKeys(rule, RULE_KEYS, at, errors);
    const key = asLocalKey(rule.proposal_rule_key, `${at}.proposal_rule_key`, errors);
    if (key) {
      if (ruleKeys.has(key)) pushIssue(errors, `${at}.proposal_rule_key`, 'duplicate_local_key', 'proposal_rule_key must be unique');
      ruleKeys.add(key);
    }
    if (rule.rule_kind !== undefined && rule.rule_kind !== 'legal_rule') {
      pushIssue(errors, `${at}.rule_kind`, 'rule_kind', 'rule_kind must be legal_rule');
    }
    const existingRuleId = asOptionalUuid(rule.existing_tax_rule_id, `${at}.existing_tax_rule_id`, errors);
    if (existingRuleId) {
      const found = byId(input.catalog.tax_rules, existingRuleId);
      if (!found) {
        pushIssue(errors, `${at}.existing_tax_rule_id`, 'invalid_canonical_id', 'existing_tax_rule_id does not exist');
      } else if (sameCountry(found.country_code, country, `${at}.existing_tax_rule_id`, errors)) {
        resolvedRuleRefs.push({
          path: `${at}.existing_tax_rule_id`,
          tax_rule_id: found.id,
          tax_rule_version_id: null,
          country_code: found.country_code,
        });
      }
    }
    const statusRaw = asTrimmedString(rule.applicability_status);
    const status = (TAX_KNOWLEDGE_PROPOSAL_APPLICABILITY_STATUSES as readonly string[]).includes(statusRaw ?? '')
      ? (statusRaw as TaxKnowledgeProposalApplicabilityStatus)
      : null;
    if (!status) {
      pushIssue(errors, `${at}.applicability_status`, 'applicability_status', 'applicability_status must be determined, unconstrained, or cannot_determine');
    }
    const appliesIf = rule.applies_if === undefined ? null : rule.applies_if;
    const doesNotApplyIf = rule.does_not_apply_if === undefined ? null : rule.does_not_apply_if;
    if (status === 'determined') {
      if (appliesIf === null) {
        pushIssue(errors, `${at}.applies_if`, 'applicability_status', 'determined rules require a non-null K3 applies_if predicate');
      } else {
        validatePredicateField(appliesIf, `${at}.applies_if`, errors);
      }
    }
    if (status === 'unconstrained') {
      if (appliesIf !== null) {
        pushIssue(errors, `${at}.applies_if`, 'applicability_status', 'unconstrained rules must set applies_if to null');
      }
      warnings.push({
        path: at,
        code: 'unconstrained_requires_owner_review',
        message: 'Null applies_if is vacuously true; Owner must confirm this rule is always applicable',
      });
    }
    if (status === 'cannot_determine') {
      if (appliesIf !== null) {
        pushIssue(errors, `${at}.applies_if`, 'applicability_status', 'cannot_determine rules must set applies_if to null');
      }
      if (doesNotApplyIf !== null) {
        pushIssue(errors, `${at}.does_not_apply_if`, 'applicability_status', 'cannot_determine rules must set does_not_apply_if to null');
      }
      const blocking = parsedUncertainties.some(
        (row) =>
          row.code === 'cannot_determine' &&
          row.severity === 'blocks_rule_publication' &&
          row.subject?.kind === 'rule' &&
          row.subject.key === key,
      );
      if (!blocking) {
        pushIssue(
          errors,
          `${at}.applicability_status`,
          'cannot_determine',
          'cannot_determine rules require a blocks_rule_publication cannot_determine uncertainty on this rule',
        );
      }
    }
    if (doesNotApplyIf !== null) {
      validatePredicateField(doesNotApplyIf, `${at}.does_not_apply_if`, errors);
    }

    const statement = asTrimmedString(rule.statement);
    if (status && status !== 'cannot_determine' && !statement) {
      pushIssue(errors, `${at}.statement`, 'required', 'statement is required for publication-eligible rules');
    }
    const effectiveFrom = asTrimmedString(rule.effective_from);
    const effectiveTo = asTrimmedString(rule.effective_to);
    if (effectiveFrom && !isCanonicalIsoDate(effectiveFrom)) {
      pushIssue(errors, `${at}.effective_from`, 'effective_date', 'effective_from must be a canonical YYYY-MM-DD date');
    }
    if (effectiveTo && !isCanonicalIsoDate(effectiveTo)) {
      pushIssue(errors, `${at}.effective_to`, 'effective_date', 'effective_to must be a canonical YYYY-MM-DD date');
    }
    if (effectiveFrom && effectiveTo && isCanonicalIsoDate(effectiveFrom) && isCanonicalIsoDate(effectiveTo) && effectiveTo < effectiveFrom) {
      pushIssue(errors, `${at}.effective_to`, 'effective_date', 'effective_to must be on or after effective_from');
    }
    if (status && status !== 'cannot_determine' && !effectiveFrom) {
      const honestUnresolvedDate = Boolean(
        key &&
          parsedUncertainties.some(
            (row) =>
              row.code === 'insufficient_evidence' &&
              row.severity === 'blocks_rule_publication' &&
              row.subject?.kind === 'rule' &&
              row.subject.key === key,
          ),
      );
      if (!honestUnresolvedDate) {
        pushIssue(errors, `${at}.effective_from`, 'required', 'effective_from is required for publication-eligible rules');
      }
    }

    const nodeKeyRefs = asStringArray(rule.legal_node_keys, `${at}.legal_node_keys`, errors);
    for (const nodeKey of nodeKeyRefs) {
      if (!nodeKeys.has(nodeKey) && !legalNodes.some((candidate) => candidate.proposal_node_key === nodeKey)) {
        pushIssue(errors, `${at}.legal_node_keys`, 'unknown_local_key', `legal_node_keys references unknown proposal_node_key ${nodeKey}`);
      }
    }
    const existingNodeIds = Array.isArray(rule.existing_tax_legal_node_ids) ? rule.existing_tax_legal_node_ids : [];
    existingNodeIds.forEach((id, nodeIndex) => {
      const nodeId = asOptionalUuid(id, `${at}.existing_tax_legal_node_ids[${nodeIndex}]`, errors);
      if (!nodeId) return;
      const found = byId(input.catalog.legal_nodes, nodeId);
      if (!found) {
        pushIssue(errors, `${at}.existing_tax_legal_node_ids[${nodeIndex}]`, 'invalid_canonical_id', 'existing_tax_legal_node_id does not exist');
      } else {
        sameCountry(found.country_code, country, `${at}.existing_tax_legal_node_ids[${nodeIndex}]`, errors);
      }
    });

    const calcKeyRefs = asStringArray(rule.calculation_keys, `${at}.calculation_keys`, errors);
    void calcKeyRefs;
    const valueKeyRefs = asStringArray(rule.legal_value_keys, `${at}.legal_value_keys`, errors);
    for (const valueKey of valueKeyRefs) declaredValueKeys.add(valueKey);

    const predicateLeaves = [
      ...collectPredicateFactLeaves(appliesIf),
      ...collectPredicateFactLeaves(doesNotApplyIf),
    ];
    for (const leaf of predicateLeaves) {
      if (leaf.fact === RESERVED_FACT_KEY) {
        pushIssue(errors, at, 'reserved_fact', `${RESERVED_FACT_KEY} is reserved and cannot appear in predicates`);
      }
    }

    const ruleBlocked = parsedUncertainties.some(
      (row) =>
        row.severity === 'blocks_rule_publication' &&
        row.subject?.kind === 'rule' &&
        row.subject.key === key,
    );
    rulePublicationFlags.push(Boolean(status && status !== 'cannot_determine' && statement && effectiveFrom && !ruleBlocked));
  });

  facts.forEach((fact, index) => {
    const at = `facts[${index}]`;
    rejectUnknownKeys(fact, FACT_KEYS, at, errors);
    const factKey = asTrimmedString(fact.fact_key);
    if (!factKey) {
      pushIssue(errors, `${at}.fact_key`, 'required', 'fact_key is required');
      return;
    }
    if (factKey === RESERVED_FACT_KEY) {
      pushIssue(errors, `${at}.fact_key`, 'reserved_fact', `${RESERVED_FACT_KEY} is reserved`);
    }
    if (!FACT_KEY_SNAKE_CASE.test(factKey)) {
      pushIssue(errors, `${at}.fact_key`, 'fact_key', 'fact_key must be snake_case');
    }
    const roleRaw = asTrimmedString(fact.role);
    if (!roleRaw || !(TAX_KNOWLEDGE_PROPOSAL_FACT_ROLES as readonly string[]).includes(roleRaw)) {
      pushIssue(errors, `${at}.role`, 'fact_role', 'fact role must be applicability_condition, required_missing, informational, or calculation_input');
      return;
    }
    const role = roleRaw as TaxKnowledgeProposalFactRole;
    const requestedStatusRaw = asTrimmedString(fact.dictionary_status);
    const requestedStatus =
      requestedStatusRaw &&
      (TAX_KNOWLEDGE_PROPOSAL_FACT_DICTIONARY_STATUSES as readonly string[]).includes(requestedStatusRaw)
        ? (requestedStatusRaw as TaxKnowledgeProposalFactDictionaryStatus)
        : requestedStatusRaw
          ? (pushIssue(errors, `${at}.dictionary_status`, 'type', 'dictionary_status is invalid'), null)
          : null;
    const requestedId = asOptionalUuid(
      fact.existing_tax_fact_definition_id,
      `${at}.existing_tax_fact_definition_id`,
      errors,
    );
    if (declaredFacts.has(factKey)) {
      pushIssue(errors, `${at}.fact_key`, 'duplicate_fact', 'facts.fact_key must be unique');
    }
    declaredFacts.set(factKey, { role, path: at, requestedId, requestedStatus });
  });

  const predicateFactKeys = new Set<string>();
  rules.forEach((rule) => {
    for (const leaf of [
      ...collectPredicateFactLeaves(rule.applies_if),
      ...collectPredicateFactLeaves(rule.does_not_apply_if),
    ]) {
      predicateFactKeys.add(leaf.fact);
      const declared = declaredFacts.get(leaf.fact);
      if (!declared) {
        pushIssue(errors, 'facts', 'undeclared_fact', `Predicate fact ${leaf.fact} must be declared in facts[]`);
        continue;
      }
      if (declared.role === 'informational' || declared.role === 'required_missing') {
        pushIssue(errors, declared.path, 'fact_role', `Fact ${leaf.fact} is in a K3 predicate and cannot be ${declared.role}`);
      }
    }
  });

  calculations.forEach((calc, index) => {
    const at = `calculations[${index}]`;
    rejectUnknownKeys(calc, CALC_KEYS, at, errors);
    const key = asLocalKey(calc.proposal_calc_key, `${at}.proposal_calc_key`, errors);
    if (key) {
      if (calcKeys.has(key)) pushIssue(errors, `${at}.proposal_calc_key`, 'duplicate_local_key', 'proposal_calc_key must be unique');
      calcKeys.add(key);
    }
    if (typeof calc.required !== 'boolean') {
      pushIssue(errors, `${at}.required`, 'type', 'required must be a boolean');
    }
    if (!asTrimmedString(calc.title)) {
      pushIssue(errors, `${at}.title`, 'required', 'calculation title is required');
    }
    const outputType = asTrimmedString(calc.output_type);
    if (!outputType || !(TAX_KNOWLEDGE_PROPOSAL_CALC_OUTPUT_TYPES as readonly string[]).includes(outputType)) {
      pushIssue(errors, `${at}.output_type`, 'calc_output_type', 'output_type must be a K4 value type');
    }
    if (calc.expression !== undefined && calc.expression !== null) {
      pushIssue(
        errors,
        `${at}.expression`,
        'k4_expression_forbidden',
        'calculations.expression must be null; do not emit a K4 AST or a fake statutory constant',
      );
    }
    const pinKeys = asStringArray(calc.pin_rule_keys, `${at}.pin_rule_keys`, errors);
    for (const pin of pinKeys) {
      if (!ruleKeys.has(pin) && !rules.some((rule) => rule.proposal_rule_key === pin)) {
        pushIssue(errors, `${at}.pin_rule_keys`, 'unknown_local_key', `pin_rule_keys references unknown proposal_rule_key ${pin}`);
      }
    }
    const inputKeys = asStringArray(calc.input_fact_keys, `${at}.input_fact_keys`, errors);
    for (const factKey of inputKeys) {
      if (factKey === RESERVED_FACT_KEY) {
        pushIssue(errors, `${at}.input_fact_keys`, 'reserved_fact', `${RESERVED_FACT_KEY} is reserved`);
      }
      const declared = declaredFacts.get(factKey);
      if (!declared) {
        pushIssue(errors, `${at}.input_fact_keys`, 'undeclared_fact', `Calculation input ${factKey} must be declared in facts[]`);
      } else if (declared.role !== 'calculation_input' && declared.role !== 'applicability_condition') {
        pushIssue(errors, declared.path, 'fact_role', `Fact ${factKey} is a calculation input and cannot be ${declared.role}`);
      }
    }
    const calcValueKeys = asStringArray(calc.legal_value_keys, `${at}.legal_value_keys`, errors);
    for (const valueKey of calcValueKeys) declaredValueKeys.add(valueKey);
    if (calc.required === true && (calc.expression === undefined || calc.expression === null)) {
      const honest = parsedUncertainties.some(
        (row) =>
          (row.code === 'insufficient_evidence' || row.code === 'cannot_determine') &&
          row.subject?.kind === 'calculation' &&
          row.subject.key === key,
      );
      if (!honest) {
        pushIssue(
          errors,
          at,
          'calculation_not_supplied',
          'Required calculation with no expression must declare insufficient_evidence or cannot_determine on this calculation',
        );
      }
    }
  });

  rules.forEach((rule, index) => {
    for (const calcKey of asStringArray(rule.calculation_keys, `rules[${index}].calculation_keys`, errors)) {
      if (!calcKeys.has(calcKey) && !calculations.some((calc) => calc.proposal_calc_key === calcKey)) {
        pushIssue(errors, `rules[${index}].calculation_keys`, 'unknown_local_key', `calculation_keys references unknown proposal_calc_key ${calcKey}`);
      }
    }
  });

  for (const [factKey, declared] of declaredFacts.entries()) {
    if (factKey === RESERVED_FACT_KEY) {
      resolvedFacts.push({
        fact_key: factKey,
        role: declared.role,
        dictionary_status: 'reserved_forbidden',
        tax_fact_definition_id: null,
        country_code: null,
        value_type: null,
        k3_type: null,
      });
      continue;
    }
    const definition = resolveFactDefinition(factKey, country, input.catalog);
    const usedInPredicate = predicateFactKeys.has(factKey);
    const usedInCalc = calculations.some(
      (calc) => Array.isArray(calc.input_fact_keys) && calc.input_fact_keys.includes(factKey),
    );
    if (!definition) {
      const missingRow = parsedUncertainties.find(
        (row) => row.code === 'missing_fact_definition' && row.subject?.kind === 'fact' && row.subject.key === factKey,
      );
      const missingUncertainty = Boolean(missingRow);
      if (missingRow && missingRow.severity !== 'blocks_rule_publication') {
        pushIssue(
          errors,
          declared.path,
          'missing_fact_definition',
          `missing_fact_definition for ${factKey} must use blocks_rule_publication`,
        );
      }
      if (usedInPredicate || (usedInCalc && declared.role !== 'required_missing')) {
        pushIssue(
          errors,
          declared.path,
          'unknown_fact_key',
          `Fact ${factKey} is not in tax_fact_definitions and must not enter a K3 predicate or calculation input`,
        );
      } else if (!missingUncertainty) {
        pushIssue(
          errors,
          declared.path,
          'missing_fact_definition',
          `Unknown fact ${factKey} requires a missing_fact_definition uncertainty and must not enter a predicate`,
        );
      }
      if (declared.requestedStatus === 'bound_existing') {
        pushIssue(errors, `${declared.path}.dictionary_status`, 'fact_binding', 'dictionary_status bound_existing requires a catalog match');
      }
      resolvedFacts.push({
        fact_key: factKey,
        role: declared.role,
        dictionary_status: 'missing_definition',
        tax_fact_definition_id: null,
        country_code: null,
        value_type: null,
        k3_type: null,
      });
      continue;
    }
    if (declared.requestedId && declared.requestedId !== definition.id) {
      pushIssue(errors, `${declared.path}.existing_tax_fact_definition_id`, 'invalid_canonical_id', 'existing_tax_fact_definition_id does not match the dictionary binding');
    }
    const k3Type = dictionaryTypeToK3(definition.value_type);
    resolvedFacts.push({
      fact_key: factKey,
      role: declared.role,
      dictionary_status: 'bound_existing',
      tax_fact_definition_id: definition.id,
      country_code: definition.country_code,
      value_type: definition.value_type,
      k3_type: k3Type,
    });
  }

  rules.forEach((rule, index) => {
    const leaves = [
      ...collectPredicateFactLeaves(rule.applies_if),
      ...collectPredicateFactLeaves(rule.does_not_apply_if),
    ];
    for (const leaf of leaves) {
      const bound = resolvedFacts.find((row) => row.fact_key === leaf.fact);
      if (!bound || bound.dictionary_status !== 'bound_existing') continue;
      if (leaf.type && bound.k3_type && leaf.type !== bound.k3_type) {
        pushIssue(
          errors,
          `rules[${index}]`,
          'incompatible_fact_type',
          `Predicate type ${leaf.type} is incompatible with dictionary fact ${leaf.fact} (${bound.value_type} → ${bound.k3_type})`,
        );
      }
      if (bound.value_type === 'enum' && leaf.type === 'enum') {
        const definition = resolveFactDefinition(leaf.fact, country, input.catalog);
        const codes = definition?.enum_codes ?? [];
        const inspect = (node: unknown): void => {
          if (!isPlainObject(node)) return;
          if (Array.isArray(node.all)) node.all.forEach(inspect);
          if (Array.isArray(node.any)) node.any.forEach(inspect);
          if ('not' in node) inspect(node.not);
          if (node.fact === leaf.fact && (node.op === 'eq' || node.op === 'neq') && typeof node.value === 'string') {
            if (codes.length && !codes.includes(node.value)) {
              pushIssue(errors, `rules[${index}]`, 'incompatible_fact_type', `Enum value ${node.value} is not in tax_fact_definitions for ${leaf.fact}`);
            }
          }
          if (node.fact === leaf.fact && (node.op === 'in' || node.op === 'not_in') && Array.isArray(node.value)) {
            for (const member of node.value) {
              if (typeof member === 'string' && codes.length && !codes.includes(member)) {
                pushIssue(errors, `rules[${index}]`, 'incompatible_fact_type', `Enum value ${member} is not in tax_fact_definitions for ${leaf.fact}`);
              }
            }
          }
        };
        inspect(rule.applies_if);
        inspect(rule.does_not_apply_if);
      }
    }
  });

  legalValues.forEach((value, index) => {
    const at = `legal_values[${index}]`;
    rejectUnknownKeys(value, LEGAL_VALUE_KEYS, at, errors);
    const valueKey = asTrimmedString(value.value_key);
    if (!valueKey) {
      pushIssue(errors, `${at}.value_key`, 'required', 'value_key is required');
      return;
    }
    declaredValueKeys.add(valueKey);
    const existingId = asOptionalUuid(value.existing_legal_value_id, `${at}.existing_legal_value_id`, errors);
    const found =
      (existingId ? input.catalog.legal_values.find((row) => row.id === existingId) : null) ??
      resolveLegalValue(valueKey, country, input.catalog);
    if (existingId && !input.catalog.legal_values.some((row) => row.id === existingId)) {
      pushIssue(errors, `${at}.existing_legal_value_id`, 'invalid_canonical_id', 'existing_legal_value_id does not exist');
      return;
    }
    if (found && !sameCountry(found.country_code, country, at, errors)) return;
    if (found && found.value_key !== valueKey) {
      pushIssue(errors, `${at}.value_key`, 'legal_value', 'value_key does not match existing_legal_value_id');
      return;
    }
    if (!found) {
      const honestRow = parsedUncertainties.find(
        (row) =>
          (row.code === 'cannot_determine' || row.code === 'insufficient_evidence') &&
          row.subject?.kind === 'legal_value' &&
          row.subject.key === valueKey,
      );
      const honest = Boolean(honestRow);
      if (honestRow && honestRow.severity !== 'blocks_rule_publication') {
        pushIssue(errors, at, 'unknown_legal_value', `Unknown value_key ${valueKey} uncertainty must use blocks_rule_publication`);
      }
      if (!honest) {
        pushIssue(
          errors,
          at,
          'unknown_legal_value',
          `Unknown Country Pack value_key ${valueKey} requires a blocking uncertainty and must not be created automatically`,
        );
      }
      return;
    }
    resolvedLegalValues.push({
      value_key: found.value_key,
      legal_value_id: found.id,
      country_code: found.country_code,
    });
  });

  for (const valueKey of declaredValueKeys) {
    if (resolvedLegalValues.some((row) => row.value_key === valueKey)) continue;
    if (legalValues.some((row) => asTrimmedString(row.value_key) === valueKey)) continue;
    const found = resolveLegalValue(valueKey, country, input.catalog);
    if (found) {
      resolvedLegalValues.push({
        value_key: found.value_key,
        legal_value_id: found.id,
        country_code: found.country_code,
      });
      continue;
    }
    const honest = parsedUncertainties.some(
      (row) =>
        (row.code === 'cannot_determine' || row.code === 'insufficient_evidence') &&
        row.subject?.kind === 'legal_value' &&
        row.subject.key === valueKey,
    );
    if (!honest) {
      pushIssue(
        errors,
        'legal_values',
        'unknown_legal_value',
        `Unknown Country Pack value_key ${valueKey} requires a blocking uncertainty`,
      );
    }
  }

  relationships.forEach((rel, index) => {
    const at = `relationships[${index}]`;
    rejectUnknownKeys(rel, REL_KEYS, at, errors);
    const type = asTrimmedString(rel.relationship_type);
    if (!type || !(TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_TYPES as readonly string[]).includes(type)) {
      pushIssue(errors, `${at}.relationship_type`, 'relationship_type', 'relationship_type must be one of the existing 10 Tax Knowledge types');
      return;
    }
    try {
      parseActivationCritical(rel.activation_critical, type, false);
    } catch (error) {
      pushIssue(
        errors,
        `${at}.activation_critical`,
        'activation_critical',
        error instanceof Error ? error.message : 'activation_critical is invalid',
      );
    }
    const parseEndpoint = (endpoint: unknown, field: 'from' | 'to'): { kind: string; key: string | null; versionId: string | null } | null => {
      if (!isPlainObject(endpoint)) {
        pushIssue(errors, `${at}.${field}`, 'type', `${field} must be an object`);
        return null;
      }
      rejectUnknownKeys(endpoint, ENDPOINT_KEYS, `${at}.${field}`, errors);
      const kind = asTrimmedString(endpoint.kind);
      if (kind === 'proposal_rule') {
        const key = asLocalKey(endpoint.key, `${at}.${field}.key`, errors);
        if (key && !ruleKeys.has(key) && !rules.some((rule) => rule.proposal_rule_key === key)) {
          pushIssue(errors, `${at}.${field}.key`, 'unknown_local_key', `${field} proposal_rule_key is not in rules`);
        }
        return { kind, key, versionId: null };
      }
      if (kind === 'existing_rule_version') {
        const versionId = asOptionalUuid(endpoint.tax_rule_version_id, `${at}.${field}.tax_rule_version_id`, errors);
        const found = byId(input.catalog.tax_rule_versions, versionId);
        if (!versionId) {
          pushIssue(errors, `${at}.${field}.tax_rule_version_id`, 'invalid_relationship_endpoint', 'existing_rule_version requires tax_rule_version_id');
        } else if (!found) {
          pushIssue(errors, `${at}.${field}.tax_rule_version_id`, 'invalid_canonical_id', 'tax_rule_version_id does not exist');
        } else if (sameCountry(found.country_code, country, `${at}.${field}.tax_rule_version_id`, errors)) {
          resolvedRuleRefs.push({
            path: `${at}.${field}.tax_rule_version_id`,
            tax_rule_id: found.tax_rule_id,
            tax_rule_version_id: found.id,
            country_code: found.country_code,
          });
        }
        return { kind, key: null, versionId };
      }
      if (field === 'to' && kind === 'unresolved') {
        return { kind, key: null, versionId: null };
      }
      pushIssue(errors, `${at}.${field}.kind`, 'invalid_relationship_endpoint', `${field}.kind must be proposal_rule, existing_rule_version, or unresolved (to only)`);
      return null;
    };
    const from = parseEndpoint(rel.from, 'from');
    const to = parseEndpoint(rel.to, 'to');
    if (from && to && from.kind === 'proposal_rule' && to.kind === 'proposal_rule' && from.key && from.key === to.key) {
      pushIssue(errors, at, 'invalid_relationship_endpoint', 'relationship endpoints must be distinct');
    }
    if (to?.kind === 'unresolved' || rel.unresolved !== undefined) {
      if (to?.kind !== 'unresolved') {
        pushIssue(errors, `${at}.unresolved`, 'unresolved_reference', 'unresolved object is only valid when to.kind is unresolved');
      }
      if (!isPlainObject(rel.unresolved)) {
        pushIssue(errors, `${at}.unresolved`, 'unresolved_reference', 'unresolved legal reference object is required');
      } else {
        rejectUnknownKeys(rel.unresolved, UNRESOLVED_KEYS, `${at}.unresolved`, errors);
        const kind = asTrimmedString(rel.unresolved.cited_instrument_kind);
        if (!kind || !(TAX_KNOWLEDGE_PROPOSAL_CITED_INSTRUMENT_KINDS as readonly string[]).includes(kind)) {
          pushIssue(errors, `${at}.unresolved.cited_instrument_kind`, 'unresolved_reference', 'cited_instrument_kind is invalid');
        }
        const locator = asTrimmedString(rel.unresolved.locator_text);
        if (!locator) {
          pushIssue(errors, `${at}.unresolved.locator_text`, 'unresolved_reference', 'locator_text is required');
        }
        const sourceId = asOptionalUuid(
          rel.unresolved.source_tax_source_id,
          `${at}.unresolved.source_tax_source_id`,
          errors,
        );
        if (sourceId) {
          const source = byId(input.catalog.tax_sources, sourceId);
          if (!source) {
            pushIssue(errors, `${at}.unresolved.source_tax_source_id`, 'invalid_canonical_id', 'source_tax_source_id does not exist');
          } else {
            sameCountry(source.country_code, country, `${at}.unresolved.source_tax_source_id`, errors);
          }
        }
        if (rel.unresolved.source_locator !== undefined && rel.unresolved.source_locator !== null) {
          if (!asTrimmedString(rel.unresolved.source_locator)) {
            pushIssue(errors, `${at}.unresolved.source_locator`, 'unresolved_reference', 'source_locator must be non-blank when provided');
          }
        }
        const unresolvedUncertainty = parsedUncertainties.some(
          (row) => row.code === 'unresolved_reference' && row.subject?.kind === 'relationship',
        );
        if (!unresolvedUncertainty) {
          warnings.push({
            path: at,
            code: 'unresolved_reference',
            message: 'Unresolved relationship should also appear in uncertainties[]',
          });
        }
      }
    }
  });

  if (evidence) {
    rejectUnknownKeys(evidence, EVIDENCE_KEYS, 'evidence', errors);
    if (evidence.source_role !== undefined && evidence.source_role !== TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_SOURCE_ROLE) {
      pushIssue(errors, 'evidence.source_role', 'evidence', 'source_role must be reviewed_owner_draft');
    }
    const quotes = asObjectArray(evidence.quotes ?? [], 'evidence.quotes', errors);
    quotes.forEach((quote, index) => {
      const at = `evidence.quotes[${index}]`;
      rejectUnknownKeys(quote, QUOTE_KEYS, at, errors);
      const roleRaw = asTrimmedString(quote.role);
      const role = (TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_QUOTE_ROLES as readonly string[]).includes(roleRaw ?? '')
        ? (roleRaw as TaxKnowledgeProposalEvidenceQuoteRole)
        : null;
      if (!role) {
        pushIssue(errors, `${at}.role`, 'evidence', 'quote role must be verbatim_from_draft or ai_paraphrase');
        evidenceValidation.quotes.push({ index, role: 'ai_paraphrase', matched: false, message: 'invalid role' });
        return;
      }
      const text = typeof quote.text === 'string' ? quote.text : null;
      if (text == null) {
        pushIssue(errors, `${at}.text`, 'evidence', 'quote text is required');
      }
      if (role === 'verbatim_from_draft') {
        evidenceValidation.verbatim_quote_count += 1;
        const start = quote.start;
        const end = quote.end;
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
          pushIssue(errors, at, 'evidence_span', 'verbatim_from_draft requires integer start/end spans');
          evidenceValidation.quotes.push({ index, role, matched: false, message: 'span missing' });
          return;
        }
        if (start < 0 || end > draftText.length || start >= end) {
          pushIssue(errors, at, 'fake_evidence_span', 'verbatim span is outside the pinned Owner Draft');
          evidenceValidation.quotes.push({ index, role, matched: false, message: 'span out of range' });
          return;
        }
        const slice = draftText.slice(start, end);
        if (text !== slice) {
          pushIssue(errors, at, 'fake_evidence_span', 'verbatim_from_draft text does not match current draft_legal_text');
          evidenceValidation.quotes.push({ index, role, matched: false, message: 'text mismatch' });
          return;
        }
        evidenceValidation.quotes.push({ index, role, matched: true, message: null });
      } else {
        evidenceValidation.paraphrase_quote_count += 1;
        evidenceValidation.quotes.push({
          index,
          role,
          matched: false,
          message: 'ai_paraphrase is review-only and cannot satisfy authoritative evidence',
        });
      }
    });
    const citations = asObjectArray(evidence.citations ?? [], 'evidence.citations', errors);
    citations.forEach((citation, index) => {
      const at = `evidence.citations[${index}]`;
      rejectUnknownKeys(citation, CITATION_KEYS, at, errors);
      const sourceId = asOptionalUuid(citation.tax_source_id, `${at}.tax_source_id`, errors);
      if (!sourceId) {
        pushIssue(errors, `${at}.tax_source_id`, 'required', 'citation tax_source_id is required');
        return;
      }
      const source = byId(input.catalog.tax_sources, sourceId);
      if (!source) {
        pushIssue(errors, `${at}.tax_source_id`, 'invalid_canonical_id', 'citation tax_source_id does not exist');
      } else {
        sameCountry(source.country_code, country, `${at}.tax_source_id`, errors);
      }
      if (citation.locator !== undefined && citation.locator !== null && !asTrimmedString(citation.locator)) {
        pushIssue(errors, `${at}.locator`, 'evidence', 'locator must be non-blank when provided');
      }
      evidenceValidation.citation_count += 1;
    });
    if (evidence.legal_locator !== undefined && evidence.legal_locator !== null) {
      if (!isPlainObject(evidence.legal_locator)) {
        pushIssue(errors, 'evidence.legal_locator', 'type', 'legal_locator must be an object');
      } else {
        rejectUnknownKeys(evidence.legal_locator, LOCATOR_KEYS, 'evidence.legal_locator', errors);
        validateIdentifier(
          asTrimmedString(evidence.legal_locator.source_display_identifier),
          asTrimmedString(evidence.legal_locator.normalized_machine_identifier),
          'evidence.legal_locator',
          errors,
        );
      }
    }
  }

  evidenceValidation.authoritative_evidence =
    evidenceValidation.quotes.some((row) => row.role === 'verbatim_from_draft' && row.matched) ||
    evidenceValidation.citation_count > 0;

  const needsAuthoritativeEvidence =
    outcome === 'rules' &&
    rules.some((rule) => {
      const status = asTrimmedString(rule.applicability_status);
      return status === 'determined' || status === 'unconstrained';
    });
  if (needsAuthoritativeEvidence && !evidenceValidation.authoritative_evidence) {
    pushIssue(
      errors,
      'evidence',
      'authoritative_evidence_required',
      'Publication-eligible rules require verbatim_from_draft evidence that matches the Owner Draft, or a same-country citation; ai_paraphrase is not sufficient',
    );
  }

  const blocking = parsedUncertainties.filter((row) => row.severity !== 'review_only');
  for (const row of parsedUncertainties) {
    if (row.severity === 'blocks_rule_publication' && row.subject?.kind === 'rule' && row.subject.key) {
      const idx = [...ruleKeys].indexOf(row.subject.key);
      if (idx >= 0) rulePublicationFlags[idx] = false;
    }
  }

  const validSchema = errors.length === 0;
  const anyEligibleRule = outcome === 'rules' && rulePublicationFlags.some(Boolean);
  const publicationEligible =
    validSchema && anyEligibleRule && !blocking.some((row) => row.severity === 'blocks_rule_publication');
  const result: TaxKnowledgeProposalV1ValidationResult = {
    valid_schema: validSchema,
    publication_eligible: publicationEligible,
    owner_approval_allowed: false,
    errors,
    warnings,
    blocking_uncertainties: blocking,
    resolved_fact_bindings: resolvedFacts,
    resolved_legal_values: resolvedLegalValues,
    resolved_existing_rule_refs: resolvedRuleRefs,
    evidence_validation: evidenceValidation,
  };
  result.owner_approval_allowed = canOwnerApproveTaxKnowledgeProposal(result);
  return result;
}

export function emptyTaxKnowledgeProposalValidationCatalog(): TaxKnowledgeProposalValidationCatalog {
  return {
    legal_nodes: [],
    legal_node_kinds: [],
    tax_rules: [],
    tax_rule_versions: [],
    tax_sources: [],
    facts: [],
    legal_values: [],
  };
}
