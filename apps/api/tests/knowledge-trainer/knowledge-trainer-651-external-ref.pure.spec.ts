import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import {
  appendOwnerExternalUnresolvedReference,
  parseOwnerExternalReferencePayload,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-external-reference.pure.js';
import { validateTaxKnowledgeProposalV1 } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';

const DRAFT = 'שר האוצר יקבע את שווי השימוש ברכב.';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';

function baseProposal(): Record<string, unknown> {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [{ proposal_node_key: 'n1', source_display_identifier: '2(2)(ב)', title: 'סעיף קטן' }],
    rules: [
      {
        proposal_rule_key: 'r1',
        title: 'Minister determines vehicle-use value',
        rule_kind: 'legal_rule',
        statement:
          'The Minister of Finance, with the approval of the Knesset Finance Committee, determines the value of the use of a vehicle made available to an employee.',
        applicability_status: 'cannot_determine',
        applies_if: null,
        does_not_apply_if: null,
        notes: null,
        effective_from: null,
        effective_to: null,
        legal_node_keys: ['n1'],
        existing_tax_legal_node_ids: [],
        legal_value_keys: [],
        calculation_keys: [],
      },
    ],
    relationships: [],
    calculations: [],
    facts: [],
    legal_values: [],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [{ role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length }],
      citations: [{ tax_source_id: SOURCE_ID, locator: '2(2)(ב)' }],
    },
    uncertainties: [
      {
        code: 'cannot_determine',
        severity: 'blocks_rule_publication',
        subject: { kind: 'rule', key: 'r1' },
        message: 'Client applicability requires additional facts or subordinate legislation.',
      },
    ],
  };
}

test('TAX-651 Owner external תקנות reference is Owner-authored unresolved depends_on', () => {
  const parsed = parseOwnerExternalReferencePayload({
    tax_knowledge_proposal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cited_law_name: 'תקנות מס הכנסה (שווי השימוש ברכב)',
    locator_text: 'ראו תקנות מ"ה שווי השימוש ברכב',
  });
  assert.equal(parsed.cited_instrument_kind, 'regulation');
  assert.equal(parsed.relationship_type, 'depends_on');
  const next = appendOwnerExternalUnresolvedReference(baseProposal(), parsed);
  const relationships = next.relationships as Array<Record<string, unknown>>;
  const last = relationships[relationships.length - 1];
  const unresolved = last.unresolved as Record<string, unknown>;
  assert.equal(last.relationship_type, 'depends_on');
  assert.deepEqual(last.to, { kind: 'unresolved' });
  assert.equal(unresolved.cited_instrument_kind, 'regulation');
  assert.equal(unresolved.cited_law_name, 'תקנות מס הכנסה (שווי השימוש ברכב)');
  assert.equal(unresolved.locator_text, 'ראו תקנות מ"ה שווי השימוש ברכב');
  const uncertainties = next.uncertainties as Array<Record<string, unknown>>;
  assert.equal(uncertainties.some((row) => row.code === 'unresolved_reference'), true);
});

test('TAX-651 external reference cannot be recorded without a Proposal rule', () => {
  assert.throws(
    () =>
      appendOwnerExternalUnresolvedReference(
        { ...baseProposal(), rules: [] },
        {
          proposal_rule_key: null,
          relationship_type: 'depends_on',
          cited_instrument_kind: 'regulation',
          locator_text: 'תקנות',
          cited_law_name: 'תקנות מ"ה',
          cited_title: null,
          cited_provision_number: null,
        },
      ),
    (error: unknown) => error instanceof AppError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_NO_RULE_FOR_EXTERNAL_REFERENCE',
  );
});

test('TAX-651 Owner-recorded unresolved regulation remains TAX-639 valid', () => {
  const next = appendOwnerExternalUnresolvedReference(baseProposal(), {
    proposal_rule_key: 'r1',
    relationship_type: 'depends_on',
    cited_instrument_kind: 'regulation',
    locator_text: 'ראו תקנות מ"ה שווי השימוש ברכב',
    cited_law_name: 'תקנות מס הכנסה (שווי השימוש ברכב)',
    cited_title: null,
    cited_provision_number: null,
  });
  const result = validateTaxKnowledgeProposalV1({
    proposal_json: next,
    context: {
      country_code: 'IL',
      tax_source_id: SOURCE_ID,
      legal_text_draft_id: DRAFT_ID,
      draft_legal_text: DRAFT,
    },
    catalog: {
      legal_nodes: [],
      legal_node_kinds: [],
      tax_rules: [],
      tax_rule_versions: [],
      tax_sources: [{ id: SOURCE_ID, country_code: 'IL' }],
      facts: [],
      legal_values: [],
    },
  });
  assert.equal(result.valid_schema, true, JSON.stringify(result.errors));
});
