import { taxRulePayloadChecksum } from '../tax-knowledge/tax-knowledge-checksum.pure.js';
import { legalIdentifierFields, parseLegalIdentifier } from '../tax-knowledge/legal-identifier.pure.js';
import { validateTaxRulePayloadPredicates } from '../tax-rule-engine/tax-rule-engine-predicate.pure.js';
import type { TaxKnowledgeProposalV1ValidationResult } from './tax-knowledge-proposal-v1.types.js';

export const TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC =
  'legal_ingestion_apply_tk_proposal_canonical_draft' as const;

export class TaxKnowledgeProposalPublishPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaxKnowledgeProposalPublishPlanError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asTrimmed(item)).filter(Boolean);
}

export function isPublishableProposalRule(rule: Record<string, unknown>): boolean {
  const status = asTrimmed(rule.applicability_status);
  return status === 'determined' || status === 'unconstrained';
}

export function earliestPublishableRuleEffectiveFrom(proposalJson: Record<string, unknown>): string {
  const rules = Array.isArray(proposalJson.rules)
    ? proposalJson.rules.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  const dates = rules
    .filter(isPublishableProposalRule)
    .map((rule) => asTrimmed(rule.effective_from))
    .filter(Boolean)
    .sort();
  if (!dates[0]) {
    throw new TaxKnowledgeProposalPublishPlanError(
      'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
      'Canonical publish requires a sourced effective_from on a publication-eligible rule',
    );
  }
  return dates[0];
}

export function proposalMachineCodeTargets(proposalJson: Record<string, unknown>): {
  nodes: Array<{ local_key: string; title: string }>;
  rules: Array<{ local_key: string; title: string }>;
} {
  const nodes = Array.isArray(proposalJson.legal_nodes)
    ? proposalJson.legal_nodes.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  const rules = Array.isArray(proposalJson.rules)
    ? proposalJson.rules.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  return {
    nodes: nodes
      .filter((node) => !asTrimmed(node.existing_tax_legal_node_id))
      .map((node) => ({
        local_key: asTrimmed(node.proposal_node_key),
        title: asTrimmed(node.title),
      })),
    rules: rules
      .filter((rule) => isPublishableProposalRule(rule) && !asTrimmed(rule.existing_tax_rule_id))
      .map((rule) => ({
        local_key: asTrimmed(rule.proposal_rule_key),
        title: asTrimmed(rule.title) || asTrimmed(rule.statement),
      })),
  };
}

export function topologicalProposalLegalNodes(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    const key = asTrimmed(node.proposal_node_key);
    if (!key) {
      throw new TaxKnowledgeProposalPublishPlanError('TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE', 'legal node is missing proposal_node_key');
    }
    if (byKey.has(key)) {
      throw new TaxKnowledgeProposalPublishPlanError('TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE', `duplicate proposal_node_key ${key}`);
    }
    byKey.set(key, node);
  }
  const parentKeyOf = (node: Record<string, unknown>): string | null => {
    const parent = asRecord(node.parent);
    if (!parent || asTrimmed(parent.kind) !== 'proposal_node') return null;
    return asTrimmed(parent.key) || null;
  };
  const pending = new Set(byKey.keys());
  const ordered: Record<string, unknown>[] = [];
  while (pending.size) {
    const ready = [...pending].filter((key) => {
      const parentKey = parentKeyOf(byKey.get(key)!);
      return !parentKey || !pending.has(parentKey);
    });
    if (!ready.length) {
      throw new TaxKnowledgeProposalPublishPlanError('TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE', 'legal_nodes parent chain has a cycle');
    }
    ready.sort();
    for (const key of ready) {
      const parentKey = parentKeyOf(byKey.get(key)!);
      if (parentKey && !byKey.has(parentKey)) {
        throw new TaxKnowledgeProposalPublishPlanError(
          'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
          `parent proposal_node_key ${parentKey} is not in legal_nodes`,
        );
      }
      ordered.push(byKey.get(key)!);
      pending.delete(key);
    }
  }
  return ordered;
}

export function buildTaxKnowledgeProposalCanonicalDraftPlan(input: {
  country_code: string;
  tax_source_id: string;
  country_pack_id: string;
  country_pack_ruleset_id: string;
  proposal_json: Record<string, unknown>;
  validation: TaxKnowledgeProposalV1ValidationResult;
  node_codes: Record<string, string>;
  rule_codes: Record<string, string>;
}): Record<string, unknown> {
  if (input.proposal_json.calculations && Array.isArray(input.proposal_json.calculations) && input.proposal_json.calculations.length) {
    // K4 stays on the B2 snapshot only. The RPC forbids calculations/calculation_keys.
  }
  const crossCountryFacts = input.validation.resolved_fact_bindings.filter(
    (row) => row.country_code && row.country_code !== input.country_code,
  );
  const crossCountryValues = input.validation.resolved_legal_values.filter(
    (row) => row.country_code !== input.country_code,
  );
  if (crossCountryFacts.length || crossCountryValues.length) {
    throw new TaxKnowledgeProposalPublishPlanError(
      'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH',
      'Fact Dictionary and Country Legal Value bindings must stay in the proposal country',
    );
  }
  const missingFacts = input.validation.resolved_fact_bindings.filter(
    (row) =>
      row.dictionary_status !== 'bound_existing' &&
      (row.role === 'applicability_condition' || row.role === 'calculation_input'),
  );
  if (missingFacts.length) {
    throw new TaxKnowledgeProposalPublishPlanError(
      'TAX_KNOWLEDGE_PROPOSAL_MISSING_FACT',
      `Publication will not create Fact Dictionary definitions: ${missingFacts.map((row) => row.fact_key).join(', ')}`,
    );
  }
  const legalValueByKey = new Map(input.validation.resolved_legal_values.map((row) => [row.value_key, row.legal_value_id]));
  const nodesRaw = Array.isArray(input.proposal_json.legal_nodes)
    ? input.proposal_json.legal_nodes.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  const rulesRaw = Array.isArray(input.proposal_json.rules)
    ? input.proposal_json.rules.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  const relationshipsRaw = Array.isArray(input.proposal_json.relationships)
    ? input.proposal_json.relationships.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
  const evidence = asRecord(input.proposal_json.evidence);
  const citations = Array.isArray(evidence?.citations)
    ? evidence.citations.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];

  const nodes = topologicalProposalLegalNodes(nodesRaw).map((node, sortOrder) => {
    const localKey = asTrimmed(node.proposal_node_key);
    const existingId = asTrimmed(node.existing_tax_legal_node_id);
    const parent = asRecord(node.parent);
    const identifier = legalIdentifierFields(parseLegalIdentifier(asTrimmed(node.source_display_identifier)));
    const printed = asTrimmed(node.printed_marker) || identifier.printed_marker;
    const planNode: Record<string, unknown> = { local_key: localKey, sort_order: sortOrder };
    if (existingId) {
      planNode.existing_tax_legal_node_id = existingId;
    } else {
      const kindId = asTrimmed(node.tax_legal_node_kind_id);
      const title = asTrimmed(node.title);
      const nodeCode = input.node_codes[localKey];
      if (!kindId || !title || !nodeCode) {
        throw new TaxKnowledgeProposalPublishPlanError(
          'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
          `new legal node ${localKey} requires tax_legal_node_kind_id, title, and a backend-generated node_code`,
        );
      }
      planNode.tax_legal_node_kind_id = kindId;
      planNode.title = title;
      planNode.node_code = nodeCode;
      if (asTrimmed(node.node_number)) planNode.node_number = asTrimmed(node.node_number);
      if (identifier.source_display_identifier) planNode.source_display_identifier = identifier.source_display_identifier;
      else if (asTrimmed(node.source_display_identifier)) planNode.source_display_identifier = asTrimmed(node.source_display_identifier);
      if (identifier.normalized_machine_identifier) {
        planNode.normalized_machine_identifier = identifier.normalized_machine_identifier;
      }
      if (identifier.identifier_base_number) planNode.identifier_base_number = identifier.identifier_base_number;
      if (identifier.identifier_letter_suffix) planNode.identifier_letter_suffix = identifier.identifier_letter_suffix;
      planNode.identifier_nested_components = identifier.identifier_nested_components;
      if (printed) planNode.printed_marker = printed;
    }
    if (parent && asTrimmed(parent.kind) === 'proposal_node' && asTrimmed(parent.key)) {
      planNode.parent_local_key = asTrimmed(parent.key);
    }
    if (parent && asTrimmed(parent.kind) === 'existing' && asTrimmed(parent.tax_legal_node_id)) {
      planNode.parent_tax_legal_node_id = asTrimmed(parent.tax_legal_node_id);
    }
    return planNode;
  });

  const rules = rulesRaw.filter(isPublishableProposalRule).map((rule) => {
    const localKey = asTrimmed(rule.proposal_rule_key);
    const existingRuleId = asTrimmed(rule.existing_tax_rule_id);
    const valueKeys = asStringArray(rule.legal_value_keys);
    const missingValues = valueKeys.filter((key) => !legalValueByKey.has(key));
    if (missingValues.length) {
      throw new TaxKnowledgeProposalPublishPlanError(
        'TAX_KNOWLEDGE_PROPOSAL_MISSING_LEGAL_VALUE',
        `Publication will not create Country Legal Values: ${missingValues.join(', ')}`,
      );
    }
    const payload = {
      statement: asTrimmed(rule.statement),
      applies_if: rule.applies_if ?? null,
      does_not_apply_if: rule.does_not_apply_if ?? null,
      notes: rule.notes ?? null,
    };
    const predicates = validateTaxRulePayloadPredicates(payload);
    if (!predicates.ok) {
      throw new TaxKnowledgeProposalPublishPlanError(
        'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
        predicates.message ?? 'rule payload predicates are invalid',
      );
    }
    const effectiveFrom = asTrimmed(rule.effective_from);
    if (!effectiveFrom) {
      throw new TaxKnowledgeProposalPublishPlanError(
        'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
        `rule ${localKey} requires a sourced effective_from`,
      );
    }
    const planRule: Record<string, unknown> = {
      local_key: localKey,
      legal_node_local_keys: asStringArray(rule.legal_node_keys),
      existing_tax_legal_node_ids: asStringArray(rule.existing_tax_legal_node_ids),
      legal_value_ids: valueKeys.map((key) => legalValueByKey.get(key)),
      version: {
        effective_from: effectiveFrom,
        effective_to: asTrimmed(rule.effective_to) || null,
        payload_json: payload,
        payload_checksum: taxRulePayloadChecksum(payload),
      },
      source_pins: citations.length
        ? citations.map((citation) => ({
            tax_source_id: asTrimmed(citation.tax_source_id) || input.tax_source_id,
            locator: asTrimmed(citation.locator) || undefined,
          }))
        : [{ tax_source_id: input.tax_source_id }],
    };
    if (existingRuleId) {
      planRule.existing_tax_rule_id = existingRuleId;
    } else {
      const title = asTrimmed(rule.title) || payload.statement;
      const ruleCode = input.rule_codes[localKey];
      if (!title || !ruleCode) {
        throw new TaxKnowledgeProposalPublishPlanError(
          'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
          `new tax rule ${localKey} requires title and a backend-generated rule_code`,
        );
      }
      planRule.title = title;
      planRule.rule_code = ruleCode;
      if (asTrimmed(rule.usage_hint)) planRule.usage_hint = asTrimmed(rule.usage_hint);
      if (asTrimmed(rule.owner_note)) planRule.owner_note = asTrimmed(rule.owner_note);
    }
    return planRule;
  });

  const relationships: Record<string, unknown>[] = [];
  const unresolved: Record<string, unknown>[] = [];
  for (const rel of relationshipsRaw) {
    const from = asRecord(rel.from);
    const to = asRecord(rel.to);
    if (!from || !to) continue;
    const fromKind = asTrimmed(from.kind);
    const toKind = asTrimmed(to.kind);
    if (toKind === 'unresolved') {
      const detail = asRecord(rel.unresolved) ?? {};
      const row: Record<string, unknown> = {
        relationship_intent: asTrimmed(rel.relationship_type),
        locator_text: asTrimmed(detail.locator_text),
        cited_instrument_kind: asTrimmed(detail.cited_instrument_kind),
      };
      if (fromKind === 'proposal_rule') row.from_local_key = asTrimmed(from.key);
      else row.from_tax_rule_version_id = asTrimmed(from.tax_rule_version_id);
      if (asTrimmed(detail.cited_title)) row.cited_title = asTrimmed(detail.cited_title);
      if (asTrimmed(detail.source_tax_source_id)) row.source_tax_source_id = asTrimmed(detail.source_tax_source_id);
      if (rel.activation_critical !== undefined) row.activation_critical = rel.activation_critical;
      unresolved.push(row);
      continue;
    }
    const row: Record<string, unknown> = {
      relationship_type: asTrimmed(rel.relationship_type),
    };
    if (fromKind === 'proposal_rule') row.from_local_key = asTrimmed(from.key);
    else row.from_tax_rule_version_id = asTrimmed(from.tax_rule_version_id);
    if (toKind === 'proposal_rule') row.to_local_key = asTrimmed(to.key);
    else row.to_tax_rule_version_id = asTrimmed(to.tax_rule_version_id);
    if (rel.activation_critical !== undefined) row.activation_critical = rel.activation_critical;
    if (asTrimmed(rel.owner_note)) row.owner_note = asTrimmed(rel.owner_note);
    relationships.push(row);
  }

  return {
    country_code: input.country_code,
    country_pack_id: input.country_pack_id,
    country_pack_ruleset_id: input.country_pack_ruleset_id,
    nodes,
    rules,
    relationships,
    unresolved,
  };
}
