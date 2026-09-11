export const BUSINESS_SETUP_AI_OWNER_SECTION_IDS = [
  'tax-knowledge',
  'legal-values',
  'fact-dictionary',
  'country-context',
  'strategy-engine',
] as const;

export type BusinessSetupAiOwnerSectionId = (typeof BUSINESS_SETUP_AI_OWNER_SECTION_IDS)[number];

export type BusinessSetupAiOwnerNavGroup = {
  group: string;
  items: ReadonlyArray<{ id: BusinessSetupAiOwnerSectionId; label: string }>;
};

/** Navigation labels only. Not legal status, priority, or command eligibility. */
export const BUSINESS_SETUP_AI_OWNER_NAV: readonly BusinessSetupAiOwnerNavGroup[] = [
  {
    group: 'TAX & LAW',
    items: [
      { id: 'tax-knowledge', label: 'Tax Knowledge' },
      { id: 'legal-values', label: 'Legal Values' },
      { id: 'fact-dictionary', label: 'Fact Dictionary' },
      { id: 'country-context', label: 'Country context' },
    ],
  },
  {
    group: 'BUSINESS SETUP AI',
    items: [{ id: 'strategy-engine', label: 'Strategy Engine' }],
  },
];

export function isBusinessSetupAiOwnerSectionId(value: string): value is BusinessSetupAiOwnerSectionId {
  return (BUSINESS_SETUP_AI_OWNER_SECTION_IDS as readonly string[]).includes(value);
}

export function businessSetupAiOwnerSectionFromHash(hash: string): BusinessSetupAiOwnerSectionId {
  const id = hash.replace(/^#/, '').trim();
  return isBusinessSetupAiOwnerSectionId(id) ? id : 'tax-knowledge';
}
