import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleLegalLibrary,
  generateLegalMachineCode,
  slugifyLegalCodeFragment,
} from '../../src/domains/tax-knowledge/tax-knowledge-library.pure.js';

test('Hebrew titles do not produce latin slugs; backend still generates a machine code', () => {
  assert.equal(slugifyLegalCodeFragment('מס הכנסה'), '');
  assert.equal(slugifyLegalCodeFragment('Income Tax'), 'income_tax');
  const hebrew = generateLegalMachineCode('dom', 'מס הכנסה', 'a1b2c3d4e5');
  assert.equal(hebrew, 'dom_a1b2c3d4e5');
  const latin = generateLegalMachineCode('src', 'Income Tax Ordinance', 'ff00aa11');
  assert.equal(latin, 'src_income_tax_ordinance_ff00aa11');
});

test('assembleLegalLibrary keeps unassigned sources/rules out of the domain tree', () => {
  const assembled = assembleLegalLibrary({
    domains: [
      { id: 'd1', domain_code: 'dom_1', title: 'מס הכנסה', status: 'draft', owner_note: null, sort_order: 0 },
    ],
    sources: [
      {
        id: 's1',
        tax_domain_id: 'd1',
        title: 'פקודת מס הכנסה',
        provenance_type: 'official_law',
        status: 'draft',
        issuer: null,
        source_code: 'src_1',
      },
      {
        id: 's-legacy',
        tax_domain_id: null,
        title: 'Legacy probe source',
        provenance_type: 'other',
        status: 'draft',
        issuer: null,
        source_code: 'legacy',
      },
    ],
    nodes: [
      {
        id: 'n1',
        tax_source_id: 's1',
        parent_node_id: null,
        tax_legal_node_kind_id: 'k1',
        kind_label: 'חלק',
        node_code: 'node_1',
        node_number: 'א',
        title: 'חלק א',
        sort_order: 0,
        status: 'draft',
        owner_note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'n2',
        tax_source_id: 's1',
        parent_node_id: 'n1',
        tax_legal_node_kind_id: 'k2',
        kind_label: 'סעיף',
        node_code: 'node_2',
        node_number: '2',
        title: 'סעיף 2',
        sort_order: 0,
        status: 'draft',
        owner_note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    rules: [
      { id: 'r1', title: 'Rule on section 2', rule_code: 'rule_1', status: 'draft', version_count: 1 },
      { id: 'r-legacy', title: 'Unassigned probe rule', rule_code: 'legacy_rule', status: 'draft', version_count: 0 },
    ],
    links: [{ id: 'l1', tax_rule_id: 'r1', tax_legal_node_id: 'n2' }],
  });

  assert.equal(assembled.domains.length, 1);
  assert.equal(assembled.domains[0].sources.length, 1);
  assert.equal(assembled.domains[0].sources[0].nodes.length, 1);
  assert.equal(assembled.domains[0].sources[0].nodes[0].children.length, 1);
  assert.equal(assembled.domains[0].sources[0].nodes[0].children[0].linked_rules.length, 1);
  assert.equal(assembled.domains[0].sources[0].nodes[0].children[0].linked_rules[0].tax_rule_id, 'r1');
  assert.equal(assembled.unassigned_sources.length, 1);
  assert.equal(assembled.unassigned_sources[0].id, 's-legacy');
  assert.deepEqual(
    assembled.unassigned_rules.map((row) => row.id),
    ['r-legacy'],
  );
});

test('a tax rule may link to more than one legal node', () => {
  const assembled = assembleLegalLibrary({
    domains: [{ id: 'd1', domain_code: 'dom_1', title: 'Domain', status: 'draft', owner_note: null, sort_order: 0 }],
    sources: [
      {
        id: 's1',
        tax_domain_id: 'd1',
        title: 'Source',
        provenance_type: 'official_law',
        status: 'draft',
        issuer: null,
        source_code: 'src_1',
      },
    ],
    nodes: [
      {
        id: 'n1',
        tax_source_id: 's1',
        parent_node_id: null,
        tax_legal_node_kind_id: 'k1',
        kind_label: 'סעיף',
        node_code: 'node_1',
        node_number: '2',
        title: '2',
        sort_order: 0,
        status: 'draft',
        owner_note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'n2',
        tax_source_id: 's1',
        parent_node_id: null,
        tax_legal_node_kind_id: 'k1',
        kind_label: 'סעיף',
        node_code: 'node_2',
        node_number: '3',
        title: '3',
        sort_order: 1,
        status: 'draft',
        owner_note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    rules: [{ id: 'r1', title: 'Shared rule', rule_code: 'rule_1', status: 'draft', version_count: 1 }],
    links: [
      { id: 'l1', tax_rule_id: 'r1', tax_legal_node_id: 'n1' },
      { id: 'l2', tax_rule_id: 'r1', tax_legal_node_id: 'n2' },
    ],
  });
  assert.equal(assembled.unassigned_rules.length, 0);
  assert.equal(assembled.domains[0].sources[0].nodes[0].linked_rules.length, 1);
  assert.equal(assembled.domains[0].sources[0].nodes[1].linked_rules.length, 1);
});
