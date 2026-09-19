const OWNER_PRESENTATION_LOCALES = ['he', 'ru', 'en'] as const;
export type TaxKnowledgeProposalOwnerPresentationLocale = (typeof OWNER_PRESENTATION_LOCALES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION = 1 as const;
export const TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PURPOSE = 'tax_knowledge_proposal_owner_presentation';
export const TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_PROMPT_VERSION = 'tax_knowledge_proposal_owner_presentation_v1';
export const TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_OUTPUT_CONTRACT = 'tax_knowledge_proposal_owner_presentation_v1';

export type TaxKnowledgeProposalOwnerPresentationLocaleBlock = {
  explanation: string;
};

export type TaxKnowledgeProposalOwnerPresentationJson = {
  schema_version: typeof TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION;
  source_locale: TaxKnowledgeProposalOwnerPresentationLocale;
  source_digest: string;
  by_locale: Record<TaxKnowledgeProposalOwnerPresentationLocale, TaxKnowledgeProposalOwnerPresentationLocaleBlock>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function extractOwnerPresentationStatements(proposalJson: Record<string, unknown> | null | undefined): string[] {
  if (!proposalJson) return [];
  const rules = Array.isArray(proposalJson.rules) ? proposalJson.rules : [];
  const statements: string[] = [];
  for (const row of rules) {
    if (!isPlainObject(row)) continue;
    const statement = asString(row.statement) || asString(row.title);
    if (statement && !statements.includes(statement)) statements.push(statement);
  }
  return statements;
}

export function joinOwnerPresentationStatements(statements: string[]): string {
  return statements.join('\n\n');
}

export function detectOwnerPresentationSourceLocale(text: string): TaxKnowledgeProposalOwnerPresentationLocale {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  return 'en';
}

export function digestOwnerPresentationSource(statements: string[]): string {
  const text = statements.join('\n');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `v1:${statements.length}:${(hash >>> 0).toString(16)}:${text.length}`;
}

export function parseOwnerPresentationJson(value: unknown): TaxKnowledgeProposalOwnerPresentationJson | null {
  if (!isPlainObject(value)) return null;
  const sourceLocale = value.source_locale;
  if (sourceLocale !== 'he' && sourceLocale !== 'ru' && sourceLocale !== 'en') return null;
  const digest = asString(value.source_digest);
  const byRaw = isPlainObject(value.by_locale) ? value.by_locale : null;
  if (!digest || !byRaw) return null;
  const by_locale = {} as Record<TaxKnowledgeProposalOwnerPresentationLocale, TaxKnowledgeProposalOwnerPresentationLocaleBlock>;
  for (const locale of OWNER_PRESENTATION_LOCALES) {
    const block = isPlainObject(byRaw[locale]) ? byRaw[locale] : null;
    const explanation = asString(block?.explanation);
    if (!explanation) return null;
    by_locale[locale] = { explanation };
  }
  return {
    schema_version: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION,
    source_locale: sourceLocale,
    source_digest: digest,
    by_locale,
  };
}

export function ownerPresentationCoversDigest(
  value: TaxKnowledgeProposalOwnerPresentationJson | null,
  digest: string,
): boolean {
  return Boolean(value && value.source_digest === digest);
}

export function buildOwnerPresentationJson(input: {
  sourceLocale: TaxKnowledgeProposalOwnerPresentationLocale;
  sourceDigest: string;
  sourceExplanation: string;
  translations: Partial<Record<TaxKnowledgeProposalOwnerPresentationLocale, string>>;
}): TaxKnowledgeProposalOwnerPresentationJson | null {
  const by_locale = {} as Record<TaxKnowledgeProposalOwnerPresentationLocale, TaxKnowledgeProposalOwnerPresentationLocaleBlock>;
  for (const locale of OWNER_PRESENTATION_LOCALES) {
    const explanation =
      locale === input.sourceLocale
        ? input.sourceExplanation
        : asString(input.translations[locale]);
    if (!explanation) return null;
    by_locale[locale] = { explanation };
  }
  return {
    schema_version: TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_SCHEMA_VERSION,
    source_locale: input.sourceLocale,
    source_digest: input.sourceDigest,
    by_locale,
  };
}

export const TAX_KNOWLEDGE_PROPOSAL_OWNER_PRESENTATION_JSON_SCHEMA = {
  name: 'tax_knowledge_proposal_owner_presentation_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['he', 'ru', 'en'],
    properties: {
      he: { type: 'string' },
      ru: { type: 'string' },
      en: { type: 'string' },
    },
  },
} as const;

export function parseOwnerPresentationTranslations(value: unknown): Partial<Record<TaxKnowledgeProposalOwnerPresentationLocale, string>> {
  if (!isPlainObject(value)) return {};
  const out: Partial<Record<TaxKnowledgeProposalOwnerPresentationLocale, string>> = {};
  for (const locale of OWNER_PRESENTATION_LOCALES) {
    const text = asString(value[locale]);
    if (text) out[locale] = text;
  }
  return out;
}
