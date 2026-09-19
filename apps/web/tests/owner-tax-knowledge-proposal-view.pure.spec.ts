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

test('TAX-644A UI is compact, locale-local, and does not generate or publish', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(trainer, /proposals=\{document\.tax_knowledge_proposals\}/);
  assert.match(ui, /OwnerTaxKnowledgeProposalView/);
  assert.match(view, /by_locale/);
  assert.match(view, /setLocale/);
  assert.match(view, /source\.quote/);
  assert.match(view, /details_label/);
  assert.match(css, /nx-legal-draft-ai-proposal-langs/);
  assert.match(parser, /parseTaxKnowledgeProposalSlice/);
  assert.doesNotMatch(view, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(trainer, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(ui, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(view, /onCommand/);
  assert.doesNotMatch(view, /JSON\.stringify/);
  assert.doesNotMatch(view, /proposal_json/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
});

test('TAX-644A parser copies by_locale and original Hebrew quote', () => {
  const empty = parseTaxKnowledgeProposalSlice(null);
  assert.equal(empty.owner_view.available, false);
  assert.equal(empty.owner_view.default_locale, 'he');
  assert.equal(empty.owner_view.by_locale.he.empty_title, emptyTaxKnowledgeProposalSlice().owner_view.by_locale.he.empty_title);

  const parsed = parseTaxKnowledgeProposalSlice({
    latest: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    selected: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    history: [],
    owner_view: {
      available: true,
      default_locale: 'he',
      locale_options: [
        { code: 'he', label: 'עברית' },
        { code: 'ru', label: 'Русский' },
        { code: 'en', label: 'English' },
      ],
      source: {
        identifier: '3א(ב)',
        quote: 'הכנסתו של אזרח ישראלי',
      },
      by_locale: {
        he: {
          dir: 'rtl',
          question: 'מה ה-AI הבין מהחוק?',
          empty_title: 'טרם נוצרה הצעת AI',
          empty_detail: '',
          explanation: 'ה-AI הבין כלל משפטי מהסעיף.',
          applicability: 'לא ניתן לקבוע תחולה.',
          uncertainty: 'חסרות הגדרות נדרשות ב-Fact Dictionary.',
          warning_tone: 'blocking',
          citation_label: 'ציטוט מקור',
          details_label: 'פרטים נוספים',
        },
        ru: {
          dir: 'ltr',
          question: 'Что AI понял из закона?',
          empty_title: '',
          empty_detail: '',
          explanation: 'AI понял правовую норму из этой статьи.',
          applicability: 'Применимость пока нельзя определить.',
          uncertainty: 'Отсутствуют нужные определения Fact Dictionary.',
          warning_tone: 'blocking',
          citation_label: 'Цитата источника',
          details_label: 'Подробнее',
        },
        en: {
          dir: 'ltr',
          question: 'What did AI understand from this law?',
          empty_title: '',
          empty_detail: '',
          explanation: 'AI understood a legal rule from this provision.',
          applicability: 'Applicability cannot yet be determined.',
          uncertainty: 'Required Fact Dictionary definitions are missing.',
          warning_tone: 'blocking',
          citation_label: 'Source citation',
          details_label: 'Details',
        },
      },
      details: {
        status_label: 'Proposed / מוצע',
        revision_label: 'Revision 1',
        extraction_outcome: 'rules',
        rules: [],
        facts: [],
        legal_values: [],
        relationships: [],
        calculations: [],
        publication_eligible: 'no',
        owner_approval_allowed: 'no',
        technical_rows: [{ label: 'proposal_id', value: 'p1' }],
      },
    },
  });
  assert.equal(parsed.owner_view.available, true);
  assert.equal(parsed.owner_view.source.identifier, '3א(ב)');
  assert.equal(parsed.owner_view.source.quote, 'הכנסתו של אזרח ישראלי');
  assert.equal(parsed.owner_view.by_locale.he.warning_tone, 'blocking');
  assert.match(parsed.owner_view.by_locale.en.applicability, /cannot yet be determined/);
  assert.equal(parsed.owner_view.details.facts.length, 0);
});
