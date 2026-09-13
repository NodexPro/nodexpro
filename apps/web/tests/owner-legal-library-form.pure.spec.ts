import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  flattenLegalLibraryNodes,
  legalStructureItemPreview,
} from '../src/pages/owner-legal-library-form.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('structure item preview is human Hebrew structure, not machine codes', () => {
  assert.equal(legalStructureItemPreview('חלק', 'א', 'פרשנות'), 'חלק א — פרשנות');
  assert.equal(legalStructureItemPreview('סעיף', '1', 'הגדרות'), 'סעיף 1 — הגדרות');
  assert.equal(legalStructureItemPreview('סעיף', '4א(א)(1)', 'מקום'), 'סעיף 4א(א)(1) — מקום');
});

test('Legal Library displays backend identifier and does not reconstruct parentheses', () => {
  const panel = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  assert.match(panel, /source_display_identifier/);
  assert.match(panel, /Legal identifier/);
  assert.doesNotMatch(panel, /parseLegalIdentifier/);
  assert.doesNotMatch(panel, /nodeNumber\.trim\(\) \+ ['"`]\(/);
  assert.doesNotMatch(panel, /identifier_nested_components/);
  assert.match(panel, /Printed marker/);
  assert.match(panel, /LegalIdentifierText/);
  assert.doesNotMatch(panel, /\.reverse\(/);
});

test('Add Structure Item form uses backend kind catalog and a parent picker', () => {
  const panel = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  assert.match(panel, /Legal identifier/);
  assert.match(panel, /Official title/);
  assert.match(panel, /Parent/);
  assert.match(panel, /nodeKinds\.map/);
  assert.match(panel, /structureParentNodes/);
  assert.match(panel, /Upload material/);
  assert.match(panel, /Add Structure Item/);
  assert.doesNotMatch(panel, /startsWith\(['"]cp-verify/);
});

test('flattenLegalLibraryNodes walks existing source nodes only', () => {
  const flat = flattenLegalLibraryNodes([
    {
      id: 'n1',
      tax_source_id: 's1',
      parent_node_id: null,
      tax_legal_node_kind_id: 'k1',
      kind_label: 'חלק',
      node_code: 'node_1',
      node_number: 'א',
      source_display_identifier: 'א',
      normalized_machine_identifier: 'א',
      identifier_base_number: null,
      identifier_letter_suffix: null,
      identifier_nested_components: [],
      printed_marker: null,
      display_identifier: 'א',
      title: 'פרשנות',
      display_title: 'חלק א — פרשנות',
      sort_order: 0,
      status: 'draft',
      owner_note: null,
      created_at: '',
      updated_at: '',
      linked_rules: [],
      children: [],
      allowed_actions: [],
    },
  ]);
  assert.deepEqual(flat, [{ id: 'n1', label: 'חלק א — פרשנות' }]);
});
