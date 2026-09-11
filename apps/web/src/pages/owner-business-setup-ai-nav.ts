export const BUSINESS_SETUP_AI_OWNER_SECTION_IDS = [
  'tax-knowledge',
  'legal-values',
  'fact-dictionary',
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
      { id: 'tax-knowledge', label: 'Laws & Sources' },
      { id: 'legal-values', label: 'Legal Values' },
      { id: 'fact-dictionary', label: 'Client Facts' },
    ],
  },
  {
    group: 'BUSINESS SETUP AI',
    items: [{ id: 'strategy-engine', label: 'Strategies' }],
  },
];

export function isBusinessSetupAiOwnerSectionId(value: string): value is BusinessSetupAiOwnerSectionId {
  return (BUSINESS_SETUP_AI_OWNER_SECTION_IDS as readonly string[]).includes(value);
}

export function businessSetupAiOwnerSectionFromHash(hash: string): BusinessSetupAiOwnerSectionId {
  const id = hash.replace(/^#/, '').trim();
  if (id === 'country-context') return 'tax-knowledge';
  return isBusinessSetupAiOwnerSectionId(id) ? id : 'tax-knowledge';
}
