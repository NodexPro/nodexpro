import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { emptyTaxKnowledgeProposalSlice } from '../src/pages/owner-legal-control-types.ts';
import { parseTaxKnowledgeProposalSlice } from '../src/pages/owner-tax-knowledge-proposal-view.tsx';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-643 UI shows backend owner_view, empty state, and no generate/publish', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(trainer, /proposals=\{document\.tax_knowledge_proposals\}/);
  assert.match(ui, /OwnerTaxKnowledgeProposalView/);
  assert.match(view, /proposals\.owner_view/);
  assert.match(view, /empty_title/);
  assert.match(view, /understanding_summary/);
  assert.match(view, /publication_eligible_label/);
  assert.match(view, /owner_approval_allowed_label/);
  assert.match(css, /nx-legal-draft-ai-proposal/);
  assert.match(parser, /parseTaxKnowledgeProposalSlice/);
  assert.doesNotMatch(ui, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(trainer, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /JSON\.stringify/);
  assert.doesNotMatch(view, /proposal_json/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
});

test('TAX-643 parser copies owner_view labels and does not invent a proposal', () => {
  const empty = parseTaxKnowledgeProposalSlice(null);
  assert.equal(empty.owner_view.available, false);
  assert.equal(empty.owner_view.empty_title, emptyTaxKnowledgeProposalSlice().owner_view.empty_title);

  const parsed = parseTaxKnowledgeProposalSlice({
    latest: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    selected: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    history: [],
    owner_view: {
      available: true,
      heading: 'AI Proposal / הצעת AI',
      question: 'What did AI understand from this law?',
      empty_title: 'No AI proposal yet / טרם נוצרה הצעת AI',
      empty_detail: 'Selecting a Draft does not generate an AI proposal.',
      status_label: 'Proposed / מוצע',
      revision_label: 'Revision 1',
      understanding_summary: 'AI extracted a legal rule. Applicability cannot yet be determined.',
      publication_eligible_label: 'No — not currently eligible / לא — אינו זכאי לפרסום כרגע',
      owner_approval_allowed_label: 'No — Owner approval is not allowed / לא — אישור Owner אינו מותר',
      rules: [
        {
          title: 'Deeming rule',
          statement: 'Income in the Area is treated as income in Israel.',
          applicability_status_label: 'Cannot determine / לא ניתן לקבוע',
          applies_if: null,
          does_not_apply_if: null,
          notes: 'Missing Fact Dictionary definitions.',
        },
      ],
      facts_title: 'Required / referenced facts',
      facts_empty_label: 'None recorded / לא נרשם',
      facts: [],
      legal_values_title: 'Legal values',
      legal_values_empty_label: 'None recorded / לא נרשם',
      legal_values: [],
      relationships_title: 'Relationships',
      relationships_empty_label: 'None recorded / לא נרשם',
      relationships: [],
      calculations_title: 'Calculations',
      calculations_empty_label: 'None recorded / לא נרשם',
      calculations: [],
      evidence_title: 'Evidence / source citation',
      evidence_empty_label: 'None recorded / לא נרשם',
      evidence_locator: '3א(ב)',
      evidence_quotes: [],
      evidence_citations: [],
      uncertainties_title: 'Uncertainties / missing information',
      uncertainties_empty_label: 'None recorded / לא נרשם',
      uncertainties: [{ label: 'Blocks publication', detail: 'No tax fact definitions were provided.' }],
      technical_title: 'Technical details',
      technical_rows: [{ label: 'Proposal ID', value: 'p1' }],
    },
  });
  assert.equal(parsed.owner_view.available, true);
  assert.match(parsed.owner_view.understanding_summary, /Applicability cannot yet be determined/);
  assert.equal(parsed.owner_view.rules[0]?.applicability_status_label, 'Cannot determine / לא ניתן לקבוע');
  assert.equal(parsed.owner_view.evidence_locator, '3א(ב)');
});
