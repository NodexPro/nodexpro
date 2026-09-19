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

test('TAX-644A/645 UI is compact, locale-local, and creates only via the named command', () => {
  const ui = readRepo('apps/web/src/pages/owner-legal-text-draft-review.tsx');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const parser = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(trainer, /proposals=\{document\.tax_knowledge_proposals\}/);
  assert.match(ui, /nx-legal-draft-source[\s\S]*Full source region[\s\S]*OwnerTaxKnowledgeProposalView/);
  assert.doesNotMatch(ui, /<\/div>\s*\r?\n\s*<OwnerTaxKnowledgeProposalView/);
  assert.match(view, /by_locale/);
  assert.match(view, /setLocale/);
  assert.match(view, /source\.quote/);
  assert.match(view, /details_label/);
  assert.match(view, /generate_tax_knowledge_proposal/);
  assert.match(view, /onCommand\(view\.create\.action_key, \{ legal_text_draft_id: view\.create\.legal_text_draft_id \}\)/);
  assert.match(view, /inFlight\.current/);
  assert.match(view, /loc\.analyzing_label/);
  assert.match(view, /loc\.generation_failed/);
  assert.match(css, /nx-legal-draft-ai-proposal-langs/);
  assert.match(css, /nx-legal-draft-ai-proposal-create/);
  assert.match(parser, /parseTaxKnowledgeProposalSlice/);
  assert.match(owner, /generate_tax_knowledge_proposal/);
  assert.match(owner, /setPanel\(out\.refreshed\.aggregate\)/);
  assert.doesNotMatch(trainer, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(view, /apiJson/);
  assert.doesNotMatch(view, /review_status/);
  assert.doesNotMatch(view, /JSON\.stringify/);
  assert.doesNotMatch(view, /proposal_json/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /activate_tax_rule_version/);
  assert.doesNotMatch(view, /regenerate/);
});

test('TAX-644A parser copies by_locale and original Hebrew quote', () => {
  const empty = parseTaxKnowledgeProposalSlice(null);
  assert.equal(empty.owner_view.available, false);
  assert.equal(empty.owner_view.has_proposal, false);
  assert.equal(empty.owner_view.create.visible, false);
  assert.equal(empty.owner_view.default_locale, 'he');
  assert.equal(empty.owner_view.by_locale.he.empty_title, emptyTaxKnowledgeProposalSlice().owner_view.by_locale.he.empty_title);
  assert.equal(empty.owner_view.by_locale.ru.empty_title, 'AI Proposal ещё не создан');
  assert.equal(empty.owner_view.by_locale.en.empty_title, 'No AI Proposal yet');

  const parsed = parseTaxKnowledgeProposalSlice({
    latest: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    selected: { id: 'p1', revision_no: 1, status_label: 'Proposed / מוצע' },
    history: [],
    owner_view: {
      available: true,
      has_proposal: true,
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
      create: {
        action_key: 'generate_tax_knowledge_proposal',
        visible: false,
        enabled: false,
        legal_text_draft_id: 'draft-1',
      },
      by_locale: {
        he: {
          dir: 'rtl',
          question: 'מה ה-AI הבין מהחוק?',
          empty_title: 'טרם נוצרה הצעת AI',
          empty_detail: '',
          create_label: '✨ צור Proposal',
          create_disabled_reason: 'יש לבדוק ולאשר את טיוטת החוק לפני יצירת הצעת AI',
          analyzing_label: 'AI מנתח...',
          generation_failed: 'יצירת הצעת AI נכשלה. נסו שוב.',
          explanation: 'הכנסה של אזרח ישראלי שהופקה או שנצמחה באזור נחשבת כהכנסה שהופקה או שנצמחה בישראל.',
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
          create_label: '✨ Создать Proposal',
          create_disabled_reason: 'Сначала проверьте и отметьте текст закона как Reviewed',
          analyzing_label: 'AI анализирует…',
          generation_failed: 'Не удалось создать предложение AI. Попробуйте снова.',
          explanation: 'Доход гражданина Израиля, произведённый или возникший в Районе, рассматривается как доход, произведённый или возникший в Израиле.',
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
          create_label: '✨ Create Proposal',
          create_disabled_reason: 'Review the legal draft before creating an AI Proposal',
          analyzing_label: 'AI is analyzing…',
          generation_failed: 'AI Proposal could not be created. Try again.',
          explanation: 'The income of an Israeli citizen that was produced or accrued in the Area is treated as income produced or accrued in Israel.',
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
  assert.equal(parsed.owner_view.has_proposal, true);
  assert.equal(parsed.owner_view.create.visible, false);
  assert.equal(parsed.owner_view.create.enabled, false);
  assert.equal(parsed.owner_view.by_locale.en.create_label, '✨ Create Proposal');
  assert.equal(parsed.owner_view.source.identifier, '3א(ב)');
  assert.equal(parsed.owner_view.source.quote, 'הכנסתו של אזרח ישראלי');
  assert.equal(parsed.owner_view.by_locale.he.warning_tone, 'blocking');
  assert.match(parsed.owner_view.by_locale.he.explanation, /אזרח ישראלי/);
  assert.match(parsed.owner_view.by_locale.en.explanation, /Israeli citizen/);
  assert.match(parsed.owner_view.by_locale.en.applicability, /cannot yet be determined/);
  assert.equal(parsed.owner_view.details.facts.length, 0);
});

test('TAX-645 empty Reviewed Draft exposes Create action without inventing a proposal', () => {
  const parsed = parseTaxKnowledgeProposalSlice({
    latest: null,
    selected: null,
    history: [],
    owner_view: {
      available: false,
      has_proposal: false,
      default_locale: 'he',
      locale_options: [
        { code: 'he', label: 'עברית' },
        { code: 'ru', label: 'Русский' },
        { code: 'en', label: 'English' },
      ],
      source: { identifier: null, quote: null },
      create: {
        action_key: 'generate_tax_knowledge_proposal',
        visible: true,
        enabled: true,
        legal_text_draft_id: 'draft-ready',
      },
      by_locale: {
        he: {
          dir: 'rtl',
          question: 'מה ה-AI הבין מהחוק?',
          empty_title: 'טרם נוצרה הצעת AI',
          empty_detail: 'בחירת טיוטה אינה יוצרת הצעת AI.',
          create_label: '✨ צור Proposal',
          create_disabled_reason: 'יש לבדוק ולאשר את טיוטת החוק לפני יצירת הצעת AI',
          analyzing_label: 'AI מנתח...',
          generation_failed: 'יצירת הצעת AI נכשלה. נסו שוב.',
          explanation: '',
          applicability: '',
          uncertainty: null,
          warning_tone: null,
          citation_label: 'ציטוט מקור',
          details_label: 'פרטים נוספים',
        },
        ru: {
          dir: 'ltr',
          question: 'Что AI понял из закона?',
          empty_title: 'AI Proposal ещё не создан',
          empty_detail: '',
          create_label: '✨ Создать Proposal',
          create_disabled_reason: 'Сначала проверьте и отметьте текст закона как Reviewed',
          analyzing_label: 'AI анализирует…',
          generation_failed: 'Не удалось создать предложение AI. Попробуйте снова.',
          explanation: '',
          applicability: '',
          uncertainty: null,
          warning_tone: null,
          citation_label: 'Цитата источника',
          details_label: 'Подробнее',
        },
        en: {
          dir: 'ltr',
          question: 'What did AI understand from this law?',
          empty_title: 'No AI Proposal yet',
          empty_detail: '',
          create_label: '✨ Create Proposal',
          create_disabled_reason: 'Review the legal draft before creating an AI Proposal',
          analyzing_label: 'AI is analyzing…',
          generation_failed: 'AI Proposal could not be created. Try again.',
          explanation: '',
          applicability: '',
          uncertainty: null,
          warning_tone: null,
          citation_label: 'Source citation',
          details_label: 'Details',
        },
      },
      details: {
        status_label: '',
        revision_label: '',
        extraction_outcome: null,
        rules: [],
        facts: [],
        legal_values: [],
        relationships: [],
        calculations: [],
        publication_eligible: '',
        owner_approval_allowed: '',
        technical_rows: [],
      },
    },
  });
  assert.equal(parsed.owner_view.available, false);
  assert.equal(parsed.owner_view.has_proposal, false);
  assert.equal(parsed.owner_view.create.visible, true);
  assert.equal(parsed.owner_view.create.enabled, true);
  assert.equal(parsed.owner_view.create.action_key, 'generate_tax_knowledge_proposal');
  assert.equal(parsed.owner_view.create.legal_text_draft_id, 'draft-ready');
  assert.equal(parsed.owner_view.by_locale.he.empty_title, 'טרם נוצרה הצעת AI');
  assert.equal(parsed.selected, null);
});
