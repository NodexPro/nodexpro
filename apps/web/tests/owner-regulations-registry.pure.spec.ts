import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUSINESS_SETUP_AI_OWNER_SECTION_IDS, parseOwnerWorkspaceNavigation } from '../src/pages/owner-business-setup-ai-nav.ts';
import { emptyTaxKnowledgeAggregate } from '../src/pages/owner-legal-control-types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-652 Owner nav accepts תקנות וצווים from backend truth', () => {
  assert.equal((BUSINESS_SETUP_AI_OWNER_SECTION_IDS as readonly string[]).includes('regulations-orders'), true);
  const parsed = parseOwnerWorkspaceNavigation([
    {
      group: 'TAX & LAW',
      items: [
        { id: 'tax-knowledge', label: 'Legal Library' },
        { id: 'regulations-orders', label: 'תקנות וצווים' },
      ],
    },
  ]);
  assert.equal(parsed?.[0]?.items[1]?.id, 'regulations-orders');
});

test('TAX-652 frontend renders backend registry counts and statuses only', () => {
  const panel = readRepo('apps/web/src/pages/owner-regulations-registry-panel.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const draft = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  assert.match(panel, /category.counts.all/);
  assert.match(panel, /category.counts.missing/);
  assert.match(panel, /entry.status_label/);
  assert.match(panel, /last_owner_review_at/);
  assert.match(panel, /effective_from/);
  assert.doesNotMatch(panel, /new Date\(\)/);
  assert.match(owner, /OwnerRegulationsRegistryPanel/);
  assert.match(owner, /regulations-orders/);
  assert.match(draft, /record_legal_text_draft_regulation_reference/);
  assert.match(draft, /locator_text: linkText/);
  assert.doesNotMatch(draft, /draft_legal_text: .*linkText/);
  assert.doesNotMatch(draft, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(draft, /from\('legal_ingestion/);
});

test('TAX-652 empty aggregate keeps backend-owned registry fields separate', () => {
  const empty = emptyTaxKnowledgeAggregate();
  assert.equal(empty.regulations_orders_registry.labels.title, 'תקנות וצווים');
  assert.equal(empty.regulations_orders_registry.categories.length, 0);
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  assert.match(parser, /regulations_orders_registry: parseRegulationRegistry/);
  assert.match(parser, /regulation_references: parseDraftLegalReferences/);
});
