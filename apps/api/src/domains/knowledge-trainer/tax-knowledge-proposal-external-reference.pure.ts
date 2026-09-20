import { AppError } from '../../shared/errors.js';

const RELATIONSHIP_TYPES = ['depends_on', 'calculation_basis', 'procedural_requirement', 'applies_with'] as const;
const INSTRUMENT_KINDS = ['law', 'section', 'regulation', 'instruction', 'order', 'other'] as const;

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseOwnerExternalReferencePayload(payload: Record<string, unknown>): {
  tax_knowledge_proposal_id: unknown;
  proposal_rule_key: string | null;
  relationship_type: (typeof RELATIONSHIP_TYPES)[number];
  cited_instrument_kind: (typeof INSTRUMENT_KINDS)[number];
  locator_text: string;
  cited_law_name: string;
  cited_title: string | null;
  cited_provision_number: string | null;
} {
  const extra = Object.keys(payload).filter(
    (key) =>
      ![
        'tax_knowledge_proposal_id',
        'source_tax_knowledge_proposal_id',
        'proposal_id',
        'proposal_rule_key',
        'relationship_type',
        'cited_instrument_kind',
        'locator_text',
        'cited_law_name',
        'cited_title',
        'cited_provision_number',
      ].includes(key) && payload[key] !== undefined,
  );
  if (extra.length) {
    throw new AppError(400, `unexpected fields: ${extra.join(', ')}`, 'BAD_REQUEST');
  }
  const locator_text = asTrimmed(payload.locator_text);
  const cited_law_name = asTrimmed(payload.cited_law_name);
  if (!locator_text) throw new AppError(400, 'locator_text is required', 'BAD_REQUEST');
  if (!cited_law_name) throw new AppError(400, 'cited_law_name is required', 'BAD_REQUEST');
  const relationship_type = (asTrimmed(payload.relationship_type) || 'depends_on') as (typeof RELATIONSHIP_TYPES)[number];
  if (!(RELATIONSHIP_TYPES as readonly string[]).includes(relationship_type)) {
    throw new AppError(400, 'relationship_type is invalid', 'BAD_REQUEST');
  }
  const cited_instrument_kind = (asTrimmed(payload.cited_instrument_kind) ||
    'regulation') as (typeof INSTRUMENT_KINDS)[number];
  if (!(INSTRUMENT_KINDS as readonly string[]).includes(cited_instrument_kind)) {
    throw new AppError(400, 'cited_instrument_kind is invalid', 'BAD_REQUEST');
  }
  return {
    tax_knowledge_proposal_id:
      payload.tax_knowledge_proposal_id ?? payload.source_tax_knowledge_proposal_id ?? payload.proposal_id,
    proposal_rule_key: asTrimmed(payload.proposal_rule_key) || null,
    relationship_type,
    cited_instrument_kind,
    locator_text,
    cited_law_name,
    cited_title: asTrimmed(payload.cited_title) || null,
    cited_provision_number: asTrimmed(payload.cited_provision_number) || null,
  };
}

export function appendOwnerExternalUnresolvedReference(
  proposalJson: Record<string, unknown>,
  input: {
    proposal_rule_key: string | null;
    relationship_type: string;
    cited_instrument_kind: string;
    locator_text: string;
    cited_law_name: string;
    cited_title: string | null;
    cited_provision_number: string | null;
  },
): Record<string, unknown> {
  const rules = Array.isArray(proposalJson.rules) ? proposalJson.rules.map((row) => asPlainObject(row)).filter(Boolean) : [];
  const firstRuleKey = asTrimmed(rules[0]?.proposal_rule_key);
  const proposal_rule_key = input.proposal_rule_key || firstRuleKey;
  if (!proposal_rule_key) {
    throw new AppError(
      409,
      'A legal rule must exist on the Proposal before an external תקנות reference can be recorded',
      'TAX_KNOWLEDGE_PROPOSAL_NO_RULE_FOR_EXTERNAL_REFERENCE',
    );
  }
  if (!rules.some((row) => asTrimmed(row?.proposal_rule_key) === proposal_rule_key)) {
    throw new AppError(400, 'proposal_rule_key does not exist on this Proposal', 'BAD_REQUEST');
  }

  const relationships = Array.isArray(proposalJson.relationships)
    ? proposalJson.relationships.map((row) => asPlainObject(row)).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
  const duplicate = relationships.some((row) => {
    const unresolved = asPlainObject(row.unresolved);
    const from = asPlainObject(row.from);
    return (
      asTrimmed(from?.key) === proposal_rule_key &&
      asTrimmed(row.relationship_type) === input.relationship_type &&
      asTrimmed(unresolved?.locator_text) === input.locator_text
    );
  });
  if (duplicate) {
    throw new AppError(409, 'This external legal reference is already recorded on the Proposal', 'TAX_KNOWLEDGE_PROPOSAL_EXTERNAL_REFERENCE_EXISTS');
  }

  const unresolved: Record<string, unknown> = {
    cited_instrument_kind: input.cited_instrument_kind,
    locator_text: input.locator_text,
    cited_law_name: input.cited_law_name,
  };
  if (input.cited_title) unresolved.cited_title = input.cited_title;
  if (input.cited_provision_number) unresolved.cited_provision_number = input.cited_provision_number;

  relationships.push({
    from: { kind: 'proposal_rule', key: proposal_rule_key },
    to: { kind: 'unresolved' },
    relationship_type: input.relationship_type,
    unresolved,
  });

  const uncertainties = Array.isArray(proposalJson.uncertainties)
    ? proposalJson.uncertainties.map((row) => asPlainObject(row)).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
  const hasUncertainty = uncertainties.some(
    (row) => asTrimmed(row.code) === 'unresolved_reference' && asTrimmed(asPlainObject(row.subject)?.key) === proposal_rule_key,
  );
  if (!hasUncertainty) {
    uncertainties.push({
      code: 'unresolved_reference',
      severity: 'blocks_activation_only',
      subject: { kind: 'relationship', key: proposal_rule_key },
      message: `Owner-recorded external legal reference: ${input.cited_law_name}`,
    });
  }

  return {
    ...proposalJson,
    relationships,
    uncertainties,
  };
}
