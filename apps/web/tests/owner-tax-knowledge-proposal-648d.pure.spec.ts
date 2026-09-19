import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { emptyTaxKnowledgeProposalSlice } from '../src/pages/owner-legal-control-types.ts';
import {
  isPublishedToCanonicalDraft,
  parseTaxKnowledgeProposalSlice,
  publishActionFromProposalSlice,
} from '../src/pages/owner-tax-knowledge-proposal-view.tsx';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function slice(overrides: Record<string, unknown> = {}) {
  const empty = emptyTaxKnowledgeProposalSlice();
  return parseTaxKnowledgeProposalSlice({
    latest: { id: 'p1', revision_no: 1, status: 'proposed', status_label: 'Proposed / מוצע' },
    selected: { id: 'p1', revision_no: 1, status: 'proposed', status_label: 'Proposed / מוצע', allowed_actions: [] },
    history: [],
    owner_view: empty.owner_view,
    ...overrides,
  });
}

test('TAX-648D publish icon appears only from backend allowed_actions after ✓', () => {
  const before = slice();
  const beforeAction = publishActionFromProposalSlice(before);
  assert.equal(beforeAction.visible, false);
  assert.equal(isPublishedToCanonicalDraft(before), false);

  const disabled = slice({
    selected: {
      id: 'p1',
      revision_no: 1,
      status: 'owner_approved',
      status_label: 'Owner approved',
      allowed_actions: [{ action_key: 'publish_tax_knowledge_proposal_to_canonical_draft', enabled: false }],
    },
  });
  assert.equal(publishActionFromProposalSlice(disabled).visible, false);

  const allowed = slice({
    selected: {
      id: 'p1',
      revision_no: 1,
      status: 'owner_approved',
      status_label: 'Owner approved',
      allowed_actions: [{ action_key: 'publish_tax_knowledge_proposal_to_canonical_draft', enabled: true }],
    },
  });
  const action = publishActionFromProposalSlice(allowed);
  assert.equal(action.visible, true);
  assert.equal(action.action_key, 'publish_tax_knowledge_proposal_to_canonical_draft');
  assert.equal(action.tax_knowledge_proposal_id, 'p1');
  assert.equal(isPublishedToCanonicalDraft(allowed), false);

  const published = slice({
    selected: {
      id: 'p1',
      revision_no: 1,
      status: 'published_to_canonical_draft',
      status_label: 'Published to canonical draft / פורסם לטיוטת קנון',
      allowed_actions: [{ action_key: 'publish_tax_knowledge_proposal_to_canonical_draft', enabled: false }],
    },
  });
  assert.equal(publishActionFromProposalSlice(published).visible, false);
  assert.equal(isPublishedToCanonicalDraft(published), true);
  assert.equal(emptyTaxKnowledgeProposalSlice().owner_view.by_locale.he.published_to_draft_label, 'פורסם לטיוטת מאגר הידע');
  assert.equal(emptyTaxKnowledgeProposalSlice().owner_view.by_locale.ru.published_to_draft_label, 'Опубликовано в базу знаний как черновик');
  assert.equal(emptyTaxKnowledgeProposalSlice().owner_view.by_locale.en.published_to_draft_label, 'Published to canonical draft');
});

test('TAX-648D UI calls the named publish command with proposal id only and shows published state', () => {
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(view, /publishActionFromProposalSlice/);
  assert.match(view, /publish\.visible/);
  assert.match(view, /nx-legal-draft-ai-proposal-publish/);
  assert.match(view, /loc\.publish_aria_label/);
  assert.match(view, /onCommand\(publish\.action_key, \{\s*tax_knowledge_proposal_id: publish\.tax_knowledge_proposal_id,\s*\}\)/);
  assert.match(view, /publishedToDraft/);
  assert.match(view, /loc\.published_to_draft_label/);
  assert.match(view, /<svg /);
  assert.doesNotMatch(view, /nx-legal-draft-ai-proposal-publish[\s\S]{0,400}>[\s\S]{0,80}Publish/);
  assert.doesNotMatch(view, /nx-legal-draft-ai-proposal-publish[\s\S]{0,400}>[\s\S]{0,80}פרסום/);
  assert.doesNotMatch(view, /nx-legal-draft-ai-proposal-publish[\s\S]{0,400}>[\s\S]{0,80}Опубликовать/);
  assert.doesNotMatch(view, /publication_eligible ===/);
  assert.doesNotMatch(view, /owner_approval_allowed ===/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
  assert.doesNotMatch(view, /legal_knowledge\.activate/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(view, /apiJson/);
  assert.doesNotMatch(view, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(view, /proposal_json/);
  assert.match(css, /nx-legal-draft-ai-proposal-publish/);
  assert.match(css, /nx-legal-draft-ai-proposal-published/);
  assert.match(owner, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.match(owner, /setPanel\(out\.refreshed\.aggregate\)/);
  assert.match(owner, /LEGAL_TEXT_DRAFT_COMMANDS[\s\S]*publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.doesNotMatch(owner, /activate_tax_rule_version/);
});
