import { allowedTaxKnowledgeProposalReviewStatuses } from './knowledge-trainer-tax-knowledge-proposal.pure.js';
import type { TaxKnowledgeProposalV1ValidationSummary } from './tax-knowledge-proposal-v1.types.js';
import {
  extractOwnerPresentationStatements,
  joinOwnerPresentationStatements,
  parseOwnerPresentationJson,
} from './tax-knowledge-proposal-owner-presentation.pure.js';

export const TAX_KNOWLEDGE_PROPOSAL_OWNER_LOCALES = ['he', 'ru', 'en'] as const;
export type TaxKnowledgeProposalOwnerLocale = (typeof TAX_KNOWLEDGE_PROPOSAL_OWNER_LOCALES)[number];

export type TaxKnowledgeProposalOwnerLocaleOption = {
  code: TaxKnowledgeProposalOwnerLocale;
  label: string;
};

export type TaxKnowledgeProposalOwnerLocaleView = {
  dir: 'rtl' | 'ltr';
  question: string;
  empty_title: string;
  empty_detail: string;
  create_label: string;
  reanalyze_label: string;
  create_disabled_reason: string;
  analyzing_label: string;
  generation_failed: string;
  explanation: string;
  applicability: string;
  uncertainty: string | null;
  warning_tone: 'blocking' | 'review' | null;
  citation_label: string;
  details_label: string;
  approve_aria_label: string;
  correct_label: string;
  correct_save_label: string;
  correct_title_label: string;
  correct_statement_label: string;
  correct_notes_label: string;
  record_external_label: string;
  record_external_law_name_label: string;
  record_external_locator_label: string;
  record_external_save_label: string;
  presentations_retry_label: string;
  presentations_missing: string;
};

export type TaxKnowledgeProposalOwnerCreatePresentation = 'generate' | 'reanalyze';

export type TaxKnowledgeProposalOwnerCreateAction = {
  action_key: 'generate_tax_knowledge_proposal';
  visible: boolean;
  enabled: boolean;
  legal_text_draft_id: string | null;
  presentation: TaxKnowledgeProposalOwnerCreatePresentation;
};

export const TAX_KNOWLEDGE_PROPOSAL_APPROVE_PRESENTATIONS = [
  'hidden',
  'available',
  'approved',
  'unavailable',
] as const;

export type TaxKnowledgeProposalApprovePresentation =
  (typeof TAX_KNOWLEDGE_PROPOSAL_APPROVE_PRESENTATIONS)[number];

export type TaxKnowledgeProposalOwnerApproveAction = {
  action_key: 'set_tax_knowledge_proposal_review_status';
  visible: boolean;
  enabled: boolean;
  tax_knowledge_proposal_id: string | null;
  status: 'owner_approved';
  presentation: TaxKnowledgeProposalApprovePresentation;
};

export type TaxKnowledgeProposalOwnerCorrectRule = {
  proposal_rule_key: string;
  title: string;
  statement: string;
  notes: string;
};

export type TaxKnowledgeProposalOwnerCorrectAction = {
  action_key: 'create_corrected_tax_knowledge_proposal';
  visible: boolean;
  enabled: boolean;
  source_tax_knowledge_proposal_id: string | null;
  rules: TaxKnowledgeProposalOwnerCorrectRule[];
};

export type TaxKnowledgeProposalOwnerExternalReferenceAction = {
  action_key: 'record_tax_knowledge_proposal_external_reference';
  visible: boolean;
  enabled: boolean;
  tax_knowledge_proposal_id: string | null;
  proposal_rule_key: string | null;
  relationship_type: 'depends_on';
  cited_instrument_kind: 'regulation';
  disabled_reason: string | null;
};

export type TaxKnowledgeProposalOwnerPresentationsAction = {
  action_key: 'ensure_tax_knowledge_proposal_owner_presentations';
  visible: boolean;
  enabled: boolean;
  tax_knowledge_proposal_id: string | null;
};

export type TaxKnowledgeProposalOwnerViewRow = {
  label: string;
  value: string;
};

export type TaxKnowledgeProposalOwnerViewItem = {
  label: string;
  detail: string | null;
};

export type TaxKnowledgeProposalOwnerViewRule = {
  title: string;
  statement: string;
  applicability_status: string;
  applies_if: string | null;
  does_not_apply_if: string | null;
  notes: string | null;
};

export type TaxKnowledgeProposalOwnerViewDetails = {
  status_label: string;
  revision_label: string;
  extraction_outcome: string | null;
  rules: TaxKnowledgeProposalOwnerViewRule[];
  facts: TaxKnowledgeProposalOwnerViewItem[];
  legal_values: TaxKnowledgeProposalOwnerViewItem[];
  relationships: TaxKnowledgeProposalOwnerViewItem[];
  calculations: TaxKnowledgeProposalOwnerViewItem[];
  publication_eligible: string;
  owner_approval_allowed: string;
  technical_rows: TaxKnowledgeProposalOwnerViewRow[];
};

export type TaxKnowledgeProposalOwnerViewDto = {
  available: boolean;
  has_proposal: boolean;
  default_locale: 'he';
  locale_options: TaxKnowledgeProposalOwnerLocaleOption[];
  source: {
    identifier: string | null;
    quote: string | null;
  };
  create: TaxKnowledgeProposalOwnerCreateAction;
  approve: TaxKnowledgeProposalOwnerApproveAction;
  correct: TaxKnowledgeProposalOwnerCorrectAction;
  external_reference: TaxKnowledgeProposalOwnerExternalReferenceAction;
  presentations: TaxKnowledgeProposalOwnerPresentationsAction;
  by_locale: Record<TaxKnowledgeProposalOwnerLocale, TaxKnowledgeProposalOwnerLocaleView>;
  details: TaxKnowledgeProposalOwnerViewDetails;
};

const LOCALE_OPTIONS: TaxKnowledgeProposalOwnerLocaleOption[] = [
  { code: 'he', label: 'עברית' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];

type Catalog = {
  dir: 'rtl' | 'ltr';
  question: string;
  empty_title: string;
  empty_detail: string;
  create_label: string;
  reanalyze_label: string;
  create_disabled_reason: string;
  analyzing_label: string;
  generation_failed: string;
  citation_label: string;
  details_label: string;
  approve_aria_label: string;
  correct_label: string;
  correct_save_label: string;
  correct_title_label: string;
  correct_statement_label: string;
  correct_notes_label: string;
  record_external_label: string;
  record_external_law_name_label: string;
  record_external_locator_label: string;
  record_external_save_label: string;
  presentations_retry_label: string;
  presentations_missing: string;
  extraction: {
    rules_one: string;
    rules_many: string;
    no_rules: string;
    cannot_determine: string;
  };
  applicability: {
    determined: string;
    unconstrained: string;
    cannot_determine: string;
    no_extracted_rule: string;
  };
  uncertainty: {
    cannot_determine: string;
    missing_fact_definition: string;
    unresolved_reference: string;
    ambiguous_interpretation: string;
    professional_judgment_required: string;
    insufficient_evidence: string;
  };
};

const CATALOG: Record<TaxKnowledgeProposalOwnerLocale, Catalog> = {
  he: {
    dir: 'rtl',
    question: 'מה ה-AI הבין מהחוק?',
    empty_title: 'טרם נוצרה הצעת AI',
    empty_detail: 'בחירת טיוטה אינה יוצרת הצעת AI.',
    create_label: '✨ צור Proposal',
    reanalyze_label: '✨ נתח מחדש',
    create_disabled_reason: 'יש לבדוק ולאשר את טיוטת החוק לפני יצירת הצעת AI',
    analyzing_label: 'AI מנתח...',
    generation_failed: 'יצירת הצעת AI נכשלה. נסו שוב.',
    citation_label: 'ציטוט מקור',
    details_label: 'פרטים נוספים',
    approve_aria_label: 'אישור הצעת AI',
    correct_label: 'תיקון',
    correct_save_label: 'שמירת תיקון',
    correct_title_label: 'כותרת',
    correct_statement_label: 'ניסוח',
    correct_notes_label: 'הערות',
    record_external_label: 'תיעוד הפניה לתקנות',
    record_external_law_name_label: 'שם המקור החיצוני',
    record_external_locator_label: 'איתור / מזהה',
    record_external_save_label: 'שמירת הפניה',
    presentations_retry_label: 'נסה שוב תרגום להצגה',
    presentations_missing: 'הכלל המשפטי נשמר. התרגום להצגה נכשל — ניתן לנסות שוב.',
    extraction: {
      rules_one: 'ה-AI הבין כלל משפטי מהסעיף.',
      rules_many: 'ה-AI הבין כמה כללים משפטיים מהסעיף.',
      no_rules: 'ה-AI לא חילץ כלל משפטי מהטיוטה.',
      cannot_determine: 'ה-AI לא הצליח לקבוע את המשמעות המשפטית של הטיוטה.',
    },
    applicability: {
      determined: 'התחולה נקבעה.',
      unconstrained: 'הכלל ללא תנאי תחולה.',
      cannot_determine: 'לא ניתן לקבוע תחולה ללקוח בלי עובדות נוספות.',
      no_extracted_rule: 'אין כאן החלטת תחולה ללקוח — לא חולץ כלל משפטי.',
    },
    uncertainty: {
      cannot_determine: 'חסר מידע כדי לקבוע תחולה.',
      missing_fact_definition: 'חסרות הגדרות נדרשות ב-Fact Dictionary.',
      unresolved_reference: 'נותרה הפניה משפטית שלא יושבה.',
      ambiguous_interpretation: 'הפרשנות אינה חד-משמעית.',
      professional_judgment_required: 'נדרש שיקול דעת מקצועי.',
      insufficient_evidence: 'הראיות אינן מספיקות.',
    },
  },
  ru: {
    dir: 'ltr',
    question: 'Что AI понял из закона?',
    empty_title: 'AI Proposal ещё не создан',
    empty_detail: 'Выбор черновика не создаёт предложение AI.',
    create_label: '✨ Создать Proposal',
    reanalyze_label: '✨ Переанализировать',
    create_disabled_reason: 'Сначала проверьте и отметьте текст закона как Reviewed',
    analyzing_label: 'AI анализирует…',
    generation_failed: 'Не удалось создать предложение AI. Попробуйте снова.',
    citation_label: 'Цитата источника',
    details_label: 'Подробнее',
    approve_aria_label: 'Подтвердить предложение AI',
    correct_label: 'Исправить',
    correct_save_label: 'Сохранить исправление',
    correct_title_label: 'Заголовок',
    correct_statement_label: 'Формулировка',
    correct_notes_label: 'Заметки',
    record_external_label: 'Зафиксировать отсылку к תקנות',
    record_external_law_name_label: 'Название внешнего источника',
    record_external_locator_label: 'Локатор / идентификатор',
    record_external_save_label: 'Сохранить отсылку',
    presentations_retry_label: 'Повторить перевод для экрана',
    presentations_missing: 'Правовая норма сохранена. Перевод для экрана не удался — можно повторить.',
    extraction: {
      rules_one: 'AI понял правовую норму из этой статьи.',
      rules_many: 'AI понял несколько правовых норм из этой статьи.',
      no_rules: 'AI не извлёк правовую норму из этого черновика.',
      cannot_determine: 'AI не смог определить правовой смысл этого черновика.',
    },
    applicability: {
      determined: 'Применимость определена.',
      unconstrained: 'Норма без условий применимости.',
      cannot_determine: 'Применимость к клиенту пока нельзя определить без дополнительных фактов.',
      no_extracted_rule: 'Это не решение о применимости к клиенту: правовая норма не извлечена.',
    },
    uncertainty: {
      cannot_determine: 'Недостаточно данных, чтобы определить применимость.',
      missing_fact_definition: 'Отсутствуют нужные определения Fact Dictionary.',
      unresolved_reference: 'Осталась неразрешённая правовая отсылка.',
      ambiguous_interpretation: 'Толкование неоднозначно.',
      professional_judgment_required: 'Требуется профессиональное суждение.',
      insufficient_evidence: 'Доказательств недостаточно.',
    },
  },
  en: {
    dir: 'ltr',
    question: 'What did AI understand from this law?',
    empty_title: 'No AI Proposal yet',
    empty_detail: 'Selecting a Draft does not generate an AI proposal.',
    create_label: '✨ Create Proposal',
    reanalyze_label: '✨ Re-analyze',
    create_disabled_reason: 'Review the legal draft before creating an AI Proposal',
    analyzing_label: 'AI is analyzing…',
    generation_failed: 'AI Proposal could not be created. Try again.',
    citation_label: 'Source citation',
    details_label: 'Details',
    approve_aria_label: 'Approve AI Proposal',
    correct_label: 'Correct',
    correct_save_label: 'Save correction',
    correct_title_label: 'Title',
    correct_statement_label: 'Statement',
    correct_notes_label: 'Notes',
    record_external_label: 'Record external תקנות reference',
    record_external_law_name_label: 'External source name',
    record_external_locator_label: 'Locator / identifier',
    record_external_save_label: 'Save reference',
    presentations_retry_label: 'Retry presentation translation',
    presentations_missing: 'The legal Proposal is intact. Presentation translation failed — retry is available.',
    extraction: {
      rules_one: 'AI understood a legal rule from this provision.',
      rules_many: 'AI understood several legal rules from this provision.',
      no_rules: 'AI did not extract a legal rule from this draft.',
      cannot_determine: 'AI could not determine the legal meaning of this draft.',
    },
    applicability: {
      determined: 'Applicability was determined.',
      unconstrained: 'The rule has no applicability conditions.',
      cannot_determine: 'Client applicability cannot yet be determined without additional facts.',
      no_extracted_rule: 'This is not a client-applicability decision; no legal rule was extracted.',
    },
    uncertainty: {
      cannot_determine: 'Information is missing to determine applicability.',
      missing_fact_definition: 'Required Fact Dictionary definitions are missing.',
      unresolved_reference: 'An unresolved legal reference remains.',
      ambiguous_interpretation: 'The interpretation is ambiguous.',
      professional_judgment_required: 'Professional judgment is required.',
      insufficient_evidence: 'Evidence is insufficient.',
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatPredicate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(formatPredicate).filter((row): row is string => Boolean(row));
    return parts.length ? parts.join('; ') : null;
  }
  if (!isPlainObject(value)) return null;
  const factKey = asString(value.fact_key);
  if (factKey) {
    const op = asString(value.op);
    const rhs = formatPredicate(value.value);
    return [factKey, op, rhs].filter(Boolean).join(' ');
  }
  if ('all' in value) {
    const inner = formatPredicate(value.all);
    return inner ? `All: ${inner}` : null;
  }
  if ('any' in value) {
    const inner = formatPredicate(value.any);
    return inner ? `Any: ${inner}` : null;
  }
  if ('not' in value) {
    const inner = formatPredicate(value.not);
    return inner ? `Not: ${inner}` : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function endpointLabel(endpoint: unknown): string {
  if (!isPlainObject(endpoint)) return '—';
  if (asString(endpoint.kind) === 'unresolved') {
    const unresolved = isPlainObject(endpoint.unresolved) ? endpoint.unresolved : {};
    return (
      [asString(unresolved.cited_law_name), asString(unresolved.locator_text), asString(unresolved.cited_title)]
        .filter(Boolean)
        .join(' — ') || 'unresolved'
    );
  }
  return asString(endpoint.key) || asString(endpoint.tax_rule_version_id) || asString(endpoint.kind) || '—';
}

function explanationFor(
  catalog: Catalog,
  extractionOutcome: string,
  ruleCount: number,
  presented: string | null,
  sourceExplanation: string,
): string {
  if (presented) return presented;
  if (sourceExplanation) return sourceExplanation;
  if (extractionOutcome === 'no_rules') return catalog.extraction.no_rules;
  if (extractionOutcome === 'cannot_determine') return catalog.extraction.cannot_determine;
  if (extractionOutcome === 'rules' || ruleCount > 0) {
    return ruleCount > 1 ? catalog.extraction.rules_many : catalog.extraction.rules_one;
  }
  return catalog.extraction.cannot_determine;
}

function applicabilityFor(
  catalog: Catalog,
  statuses: string[],
  extractionOutcome: string,
  ruleCount: number,
): string {
  if (ruleCount === 0) {
    if (extractionOutcome === 'no_rules') return catalog.applicability.no_extracted_rule;
    return catalog.applicability.cannot_determine;
  }
  if (statuses.includes('cannot_determine')) return catalog.applicability.cannot_determine;
  if (statuses.includes('unconstrained') && !statuses.includes('determined')) {
    return catalog.applicability.unconstrained;
  }
  if (statuses.includes('determined')) return catalog.applicability.determined;
  return catalog.applicability.cannot_determine;
}

function uncertaintyFor(
  catalog: Catalog,
  codes: string[],
  factsMissing: boolean,
): string | null {
  if (!codes.length && !factsMissing) return null;
  const set = new Set(codes);
  if (set.has('missing_fact_definition') || (factsMissing && (set.has('cannot_determine') || !codes.length))) {
    return catalog.uncertainty.missing_fact_definition;
  }
  const parts = [...set]
    .map((code) => catalog.uncertainty[code as keyof Catalog['uncertainty']])
    .filter((row): row is string => Boolean(row));
  return parts.length ? [...new Set(parts)].join(' ') : catalog.uncertainty.cannot_determine;
}

function warningTone(severities: string[]): 'blocking' | 'review' | null {
  if (severities.includes('blocks_rule_publication')) return 'blocking';
  if (severities.includes('blocks_activation_only') || severities.includes('review_only')) return 'review';
  return null;
}

function emptyLocaleView(locale: TaxKnowledgeProposalOwnerLocale): TaxKnowledgeProposalOwnerLocaleView {
  const catalog = CATALOG[locale];
  return {
    dir: catalog.dir,
    question: catalog.question,
    empty_title: catalog.empty_title,
    empty_detail: catalog.empty_detail,
    create_label: catalog.create_label,
    reanalyze_label: catalog.reanalyze_label,
    create_disabled_reason: catalog.create_disabled_reason,
    analyzing_label: catalog.analyzing_label,
    generation_failed: catalog.generation_failed,
    explanation: '',
    applicability: '',
    uncertainty: null,
    warning_tone: null,
    citation_label: catalog.citation_label,
    details_label: catalog.details_label,
    approve_aria_label: catalog.approve_aria_label,
    correct_label: catalog.correct_label,
    correct_save_label: catalog.correct_save_label,
    correct_title_label: catalog.correct_title_label,
    correct_statement_label: catalog.correct_statement_label,
    correct_notes_label: catalog.correct_notes_label,
    record_external_label: catalog.record_external_label,
    record_external_law_name_label: catalog.record_external_law_name_label,
    record_external_locator_label: catalog.record_external_locator_label,
    record_external_save_label: catalog.record_external_save_label,
    presentations_retry_label: catalog.presentations_retry_label,
    presentations_missing: catalog.presentations_missing,
  };
}

function emptyDetails(): TaxKnowledgeProposalOwnerViewDetails {
  return {
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
  };
}

function emptyCreateAction(): TaxKnowledgeProposalOwnerCreateAction {
  return {
    action_key: 'generate_tax_knowledge_proposal',
    visible: false,
    enabled: false,
    legal_text_draft_id: null,
    presentation: 'generate',
  };
}

function emptyApproveAction(): TaxKnowledgeProposalOwnerApproveAction {
  return {
    action_key: 'set_tax_knowledge_proposal_review_status',
    visible: false,
    enabled: false,
    tax_knowledge_proposal_id: null,
    status: 'owner_approved',
    presentation: 'hidden',
  };
}

function emptyCorrectAction(): TaxKnowledgeProposalOwnerCorrectAction {
  return {
    action_key: 'create_corrected_tax_knowledge_proposal',
    visible: false,
    enabled: false,
    source_tax_knowledge_proposal_id: null,
    rules: [],
  };
}

function emptyExternalReferenceAction(): TaxKnowledgeProposalOwnerExternalReferenceAction {
  return {
    action_key: 'record_tax_knowledge_proposal_external_reference',
    visible: false,
    enabled: false,
    tax_knowledge_proposal_id: null,
    proposal_rule_key: null,
    relationship_type: 'depends_on',
    cited_instrument_kind: 'regulation',
    disabled_reason: null,
  };
}

function emptyPresentationsAction(): TaxKnowledgeProposalOwnerPresentationsAction {
  return {
    action_key: 'ensure_tax_knowledge_proposal_owner_presentations',
    visible: false,
    enabled: false,
    tax_knowledge_proposal_id: null,
  };
}

function correctionRulesFromProposal(rulesRaw: Record<string, unknown>[]): TaxKnowledgeProposalOwnerCorrectRule[] {
  return rulesRaw
    .map((rule) => {
      const proposal_rule_key = asString(rule.proposal_rule_key);
      return proposal_rule_key
        ? {
            proposal_rule_key,
            title: asString(rule.title),
            statement: asString(rule.statement),
            notes: asString(rule.notes),
          }
        : null;
    })
    .filter((row): row is TaxKnowledgeProposalOwnerCorrectRule => Boolean(row));
}

function buildApproveAction(
  selected: { id: string; status: string } | null,
  validation: TaxKnowledgeProposalV1ValidationSummary | null,
): TaxKnowledgeProposalOwnerApproveAction {
  if (!selected) return emptyApproveAction();
  if (selected.status === 'owner_approved') {
    return {
      action_key: 'set_tax_knowledge_proposal_review_status',
      visible: true,
      enabled: false,
      tax_knowledge_proposal_id: selected.id,
      status: 'owner_approved',
      presentation: 'approved',
    };
  }
  const available =
    allowedTaxKnowledgeProposalReviewStatuses(selected.status).includes('owner_approved') &&
    validation?.owner_approval_allowed === true;
  return {
    action_key: 'set_tax_knowledge_proposal_review_status',
    visible: true,
    enabled: available,
    tax_knowledge_proposal_id: selected.id,
    status: 'owner_approved',
    presentation: available ? 'available' : 'unavailable',
  };
}

function buildCorrectAction(
  selected: { id: string } | null,
  rules: TaxKnowledgeProposalOwnerCorrectRule[],
): TaxKnowledgeProposalOwnerCorrectAction {
  if (!selected) return emptyCorrectAction();
  return {
    action_key: 'create_corrected_tax_knowledge_proposal',
    visible: rules.length > 0,
    enabled: rules.length > 0,
    source_tax_knowledge_proposal_id: selected.id,
    rules,
  };
}

function withCreateAction(
  view: TaxKnowledgeProposalOwnerViewDto,
  input: { draftId: string | null; hasProposal: boolean; generateEnabled: boolean },
): TaxKnowledgeProposalOwnerViewDto {
  return {
    ...view,
    has_proposal: input.hasProposal,
    create: {
      action_key: 'generate_tax_knowledge_proposal',
      visible: Boolean(input.draftId),
      enabled: Boolean(input.draftId) && input.generateEnabled,
      legal_text_draft_id: input.draftId,
      presentation: input.hasProposal ? 'reanalyze' : 'generate',
    },
  };
}

function emptyView(): TaxKnowledgeProposalOwnerViewDto {
  return {
    available: false,
    has_proposal: false,
    default_locale: 'he',
    locale_options: LOCALE_OPTIONS,
    source: { identifier: null, quote: null },
    create: emptyCreateAction(),
    approve: emptyApproveAction(),
    correct: emptyCorrectAction(),
    external_reference: emptyExternalReferenceAction(),
    presentations: emptyPresentationsAction(),
    by_locale: {
      he: emptyLocaleView('he'),
      ru: emptyLocaleView('ru'),
      en: emptyLocaleView('en'),
    },
    details: emptyDetails(),
  };
}

export function emptyTaxKnowledgeProposalOwnerView(): TaxKnowledgeProposalOwnerViewDto {
  return emptyView();
}

export function buildTaxKnowledgeProposalOwnerView(input: {
  selected: {
    id: string;
    revision_no: number;
    status: string;
    status_label: string;
    creation_origin: string;
    legal_text_draft_id: string;
  } | null;
  proposal_json: Record<string, unknown> | null;
  validation: TaxKnowledgeProposalV1ValidationSummary | null;
  owner_presentation_json?: unknown;
  draft?: { id: string; review_status?: string | null } | null;
  generate_enabled?: boolean;
}): TaxKnowledgeProposalOwnerViewDto {
  const draftId = input.draft?.id ?? input.selected?.legal_text_draft_id ?? null;
  const generateEnabled = input.generate_enabled === true;
  const base = withCreateAction(emptyView(), {
    draftId,
    hasProposal: false,
    generateEnabled,
  });
  if (!input.selected || !input.proposal_json) return base;

  const json = input.proposal_json;
  const validation = input.validation;
  const rulesRaw = asArray(json.rules).filter(isPlainObject);
  const factsRaw = asArray(json.facts).filter(isPlainObject);
  const legalValuesRaw = asArray(json.legal_values).filter(isPlainObject);
  const relationshipsRaw = asArray(json.relationships).filter(isPlainObject);
  const calculationsRaw = asArray(json.calculations).filter(isPlainObject);
  const uncertaintiesRaw = asArray(json.uncertainties).filter(isPlainObject);
  const evidence = isPlainObject(json.evidence) ? json.evidence : {};
  const locator = isPlainObject(evidence.legal_locator) ? evidence.legal_locator : {};
  const quotes = asArray(evidence.quotes).filter(isPlainObject);
  const originalQuote = quotes
    .map((row) => asString(row.text))
    .find((text) => text) ?? null;
  const identifier =
    asString(locator.source_display_identifier) ||
    asString(locator.normalized_machine_identifier) ||
    asString(asArray(evidence.citations).filter(isPlainObject)[0]?.locator) ||
    null;

  const applicabilityStatuses = rulesRaw.map((rule) => asString(rule.applicability_status)).filter(Boolean);
  const blocking = validation?.blocking_uncertainties ?? [];
  const uncertaintySource = blocking.length ? blocking : uncertaintiesRaw;
  const codes = uncertaintySource
    .map((row) => asString(isPlainObject(row) ? row.code : ''))
    .filter(Boolean);
  const severities = uncertaintySource
    .map((row) => asString(isPlainObject(row) ? row.severity : ''))
    .filter(Boolean);
  const factsFromProposal = factsRaw.map((fact) => {
    const key = asString(fact.fact_key);
    return key
      ? {
          label: key,
          detail: [asString(fact.role), asString(fact.dictionary_status)].filter(Boolean).join(' · ') || null,
        }
      : null;
  }).filter((row): row is TaxKnowledgeProposalOwnerViewItem => Boolean(row));
  const factsFromResolved = (validation?.resolved_fact_bindings ?? []).map((row) => ({
    label: row.fact_key,
    detail: [row.role, row.dictionary_status].filter(Boolean).join(' · ') || null,
  }));
  const facts = factsFromProposal.length ? factsFromProposal : factsFromResolved;
  const factsMissing = facts.length === 0 && codes.includes('missing_fact_definition');

  const legalValuesFromProposal = legalValuesRaw
    .map((row) => {
      const key = asString(row.value_key);
      return key ? { label: key, detail: asString(row.existing_legal_value_id) || null } : null;
    })
    .filter((row): row is TaxKnowledgeProposalOwnerViewItem => Boolean(row));
  const legalValuesFromResolved = (validation?.resolved_legal_values ?? []).map((row) => ({
    label: row.value_key,
    detail: row.legal_value_id,
  }));
  const legal_values = legalValuesFromProposal.length ? legalValuesFromProposal : legalValuesFromResolved;

  const relationships = relationshipsRaw.map((row) => ({
    label: `${endpointLabel(row.from)} → ${endpointLabel(row.to)}`,
    detail: asString(row.relationship_type) || null,
  }));
  const calculations = calculationsRaw.map((row) => ({
    label: asString(row.title) || asString(row.proposal_calc_key) || 'calculation',
    detail: asString(row.expression) || null,
  }));

  const rules = rulesRaw.map((rule) => ({
    title: asString(rule.title),
    statement: asString(rule.statement),
    applicability_status: asString(rule.applicability_status),
    applies_if: formatPredicate(rule.applies_if),
    does_not_apply_if: formatPredicate(rule.does_not_apply_if),
    notes: asString(rule.notes) || null,
  }));

  const extractionOutcome = asString(json.extraction_outcome) || null;
  const tone = warningTone(severities);
  const sourceExplanation = joinOwnerPresentationStatements(extractOwnerPresentationStatements(json));
  const presentations = parseOwnerPresentationJson(input.owner_presentation_json);

  const by_locale = Object.fromEntries(
    TAX_KNOWLEDGE_PROPOSAL_OWNER_LOCALES.map((locale) => {
      const catalog = CATALOG[locale];
      return [
        locale,
        {
          dir: catalog.dir,
          question: catalog.question,
          empty_title: catalog.empty_title,
          empty_detail: catalog.empty_detail,
          create_label: catalog.create_label,
          reanalyze_label: catalog.reanalyze_label,
          create_disabled_reason: catalog.create_disabled_reason,
          analyzing_label: catalog.analyzing_label,
          generation_failed: catalog.generation_failed,
          explanation: explanationFor(
            catalog,
            extractionOutcome ?? '',
            rules.length,
            presentations?.by_locale[locale]?.explanation ?? null,
            sourceExplanation,
          ),
          applicability: applicabilityFor(catalog, applicabilityStatuses, extractionOutcome ?? '', rules.length),
          uncertainty: uncertaintyFor(catalog, codes, factsMissing),
          warning_tone: tone,
          citation_label: catalog.citation_label,
          details_label: catalog.details_label,
          approve_aria_label: catalog.approve_aria_label,
          correct_label: catalog.correct_label,
          correct_save_label: catalog.correct_save_label,
          correct_title_label: catalog.correct_title_label,
          correct_statement_label: catalog.correct_statement_label,
          correct_notes_label: catalog.correct_notes_label,
          record_external_label: catalog.record_external_label,
          record_external_law_name_label: catalog.record_external_law_name_label,
          record_external_locator_label: catalog.record_external_locator_label,
          record_external_save_label: catalog.record_external_save_label,
          presentations_retry_label: catalog.presentations_retry_label,
          presentations_missing: catalog.presentations_missing,
        } satisfies TaxKnowledgeProposalOwnerLocaleView,
      ];
    }),
  ) as Record<TaxKnowledgeProposalOwnerLocale, TaxKnowledgeProposalOwnerLocaleView>;

  return withCreateAction({
    available: true,
    has_proposal: true,
    default_locale: 'he',
    locale_options: LOCALE_OPTIONS,
    source: {
      identifier,
      quote: originalQuote,
    },
    create: emptyCreateAction(),
    approve: buildApproveAction(input.selected, validation),
    correct: buildCorrectAction(input.selected, correctionRulesFromProposal(rulesRaw)),
    external_reference: {
      action_key: 'record_tax_knowledge_proposal_external_reference',
      visible: true,
      enabled: rules.length > 0,
      tax_knowledge_proposal_id: input.selected.id,
      proposal_rule_key: rulesRaw.map((row) => asString(row.proposal_rule_key)).find(Boolean) || null,
      relationship_type: 'depends_on',
      cited_instrument_kind: 'regulation',
      disabled_reason:
        rules.length > 0
          ? null
          : 'A legal rule must exist on the Proposal before an external תקנות reference can be recorded',
    },
    presentations: {
      action_key: 'ensure_tax_knowledge_proposal_owner_presentations',
      visible: rules.length > 0 && !presentations,
      enabled: rules.length > 0 && !presentations,
      tax_knowledge_proposal_id: input.selected.id,
    },
    by_locale,
    details: {
      status_label: input.selected.status_label,
      revision_label: `Revision ${input.selected.revision_no}`,
      extraction_outcome: extractionOutcome,
      rules,
      facts,
      legal_values,
      relationships,
      calculations,
      publication_eligible: validation?.publication_eligible === true ? 'yes' : 'no',
      owner_approval_allowed: validation?.owner_approval_allowed === true ? 'yes' : 'no',
      technical_rows: [
        { label: 'proposal_id', value: input.selected.id },
        { label: 'legal_text_draft_id', value: input.selected.legal_text_draft_id },
        { label: 'creation_origin', value: input.selected.creation_origin },
        { label: 'extraction_outcome', value: extractionOutcome || '—' },
      ],
    },
  }, { draftId, hasProposal: true, generateEnabled });
}
