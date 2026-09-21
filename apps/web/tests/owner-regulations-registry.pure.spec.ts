import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  BUSINESS_SETUP_AI_OWNER_NAV,
  BUSINESS_SETUP_AI_OWNER_SECTION_IDS,
  parseOwnerWorkspaceNavigation,
} from '../src/pages/owner-business-setup-ai-nav.ts';
import { emptyTaxKnowledgeAggregate } from '../src/pages/owner-legal-control-types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-652 system UI remains English', () => {
  assert.equal((BUSINESS_SETUP_AI_OWNER_SECTION_IDS as readonly string[]).includes('regulations-orders'), true);
  const fallback = BUSINESS_SETUP_AI_OWNER_NAV[0]?.items.find((item) => item.id === 'regulations-orders');
  assert.equal(fallback?.label, 'Regulations & Orders');
  const parsed = parseOwnerWorkspaceNavigation([
    {
      group: 'TAX & LAW',
      items: [
        { id: 'tax-knowledge', label: 'Legal Library' },
        { id: 'regulations-orders', label: 'Regulations & Orders' },
      ],
    },
  ]);
  assert.equal(parsed?.[0]?.items[1]?.label, 'Regulations & Orders');
  const empty = emptyTaxKnowledgeAggregate();
  assert.equal(empty.regulations_orders_registry.labels.title, 'Regulations & Orders');
  assert.equal(empty.regulations_orders_registry.labels.missing, 'Missing');
  assert.equal(empty.regulations_orders_registry.labels.last_owner_review, 'Last Owner review');
  assert.equal(empty.regulations_orders_registry.labels.effective, 'Effective');

  const panel = readRepo('apps/web/src/pages/owner-regulations-registry-panel.tsx');
  const draft = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const nav = readRepo('apps/web/src/pages/owner-business-setup-ai-nav.ts');
  const types = readRepo('apps/web/src/pages/owner-legal-control-types.ts');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  for (const source of [panel, nav, types, parser]) {
    assert.doesNotMatch(source, /תקנות וצווים/);
  }
  assert.match(panel, /Owner catalog of Regulations and Orders/);
  assert.match(panel, /Owner number/);
  assert.match(panel, /All: \{category.counts.all\}/);
  assert.match(panel, /Missing: \{category.counts.missing\}/);
  assert.match(panel, /Needs review: \{category.counts.needs_review\}/);
  assert.match(panel, /Reviewed: \{category.counts.reviewed\}/);
  assert.match(panel, /Add placeholder/);
  assert.match(panel, /<th>Name<\/th>/);
  assert.match(panel, /<th>Year<\/th>/);
  assert.match(panel, /<th>Status<\/th>/);
  assert.match(draft, />Category</);
  assert.match(draft, />Owner number</);
  assert.match(draft, /Save reference/);
  assert.doesNotMatch(draft, /Owner reference number/);
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

test('TAX-652 Owner content is preserved exactly and never translated', () => {
  const panel = readRepo('apps/web/src/pages/owner-regulations-registry-panel.tsx');
  const draft = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  assert.match(panel, /\{category.title\}/);
  assert.match(panel, /\{entry.name \|\| '—'\}/);
  assert.match(draft, /\{category.title\}/);
  assert.match(draft, /\{ref.label\}/);
  assert.match(parser, /title: asString\(row.title\)/);
  assert.match(parser, /name: asNullableString\(entry.name\)/);
  assert.match(parser, /label: asString\(row.label\)/);
  assert.match(parser, /category_title: asNullableString\(row.category_title\)/);
  assert.doesNotMatch(parser, /translate|i18n|toHebrew|toEnglish/);
  assert.doesNotMatch(panel, /תקנות מס הכנסה/);
  assert.doesNotMatch(panel, /Income Tax/);
  assert.doesNotMatch(draft, /תקנות מס הכנסה/);
});

test('TAX-652 content direction follows Owner text, not the page', () => {
  const panel = readRepo('apps/web/src/pages/owner-regulations-registry-panel.tsx');
  const draft = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');
  assert.match(panel, /className="nx-reg-registry" dir="ltr"/);
  assert.match(panel, /className="nx-reg-registry-table" dir="ltr"/);
  assert.match(panel, /<h3 dir="auto" className="nx-reg-owner-text">/);
  assert.match(panel, /className="nx-reg-link nx-reg-owner-text"[\s\S]*dir="auto"/);
  assert.match(panel, /className="nx-input nx-reg-owner-text"[\s\S]*dir="auto"/);
  assert.doesNotMatch(panel, /dir="rtl"/);
  assert.match(draft, /className="nx-reg-popover" dir="ltr"/);
  assert.match(draft, /className="nx-reg-chips" dir="ltr"/);
  assert.match(draft, /<span dir="auto" className="nx-reg-owner-text">/);
  assert.match(draft, /<option key=\{category.id\} value=\{category.id\} dir="auto">/);
  assert.match(css, /unicode-bidi:\s*plaintext/);
  assert.match(css, /\.nx-reg-registry-table \{[\s\S]*direction:\s*ltr/);
});

test('TAX-652 typography uses scoped Arial for registry chrome and Owner labels', () => {
  const css = readRepo('apps/web/src/styles/nx-modal.css');
  assert.match(
    css,
    /\.nx-reg-registry,\s*\.nx-reg-popover,\s*\.nx-reg-chips \{\s*font-family:\s*Arial,\s*Helvetica,\s*sans-serif;/,
  );
  assert.match(css, /\.nx-reg-registry \*,\s*\.nx-reg-popover \*,\s*\.nx-reg-chips \* \{\s*font-family:\s*inherit;/);
});

test('TAX-652 categories reuse backend tax_domains; New tax domain keeps create_tax_domain', () => {
  const panel = readRepo('apps/web/src/pages/owner-regulations-registry-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  assert.match(panel, /run\('create_tax_domain'/);
  assert.match(panel, />New tax domain</);
  assert.match(panel, /Add tax domain/);
  assert.match(panel, /Groups reuse existing tax domains/);
  assert.match(panel, /It is not a cosmetic regulation folder/);
  assert.doesNotMatch(panel, /create_regulation_category|create_regulation_folder/);
  assert.match(parser, /regulations_orders_registry: parseRegulationRegistry/);
  assert.equal(emptyTaxKnowledgeAggregate().regulations_orders_registry.categories.length, 0);
});
