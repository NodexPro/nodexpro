export const BUSINESS_SETUP_AI_OWNER_SECTION_IDS = [
  'tax-knowledge',
  'legal-values',
  'fact-dictionary',
  'strategy-engine',
  'access-experts',
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

export function parseOwnerWorkspaceNavigation(value: unknown): readonly BusinessSetupAiOwnerNavGroup[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const groups: BusinessSetupAiOwnerNavGroup[] = [];
  for (const group of value) {
    if (!group || typeof group !== 'object') return null;
    const label = typeof (group as { group?: unknown }).group === 'string' ? (group as { group: string }).group : '';
    const itemsRaw = (group as { items?: unknown }).items;
    if (!label || !Array.isArray(itemsRaw)) return null;
    const items: Array<{ id: BusinessSetupAiOwnerSectionId; label: string }> = [];
    for (const item of itemsRaw) {
      if (!item || typeof item !== 'object') return null;
      const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '';
      const itemLabel = typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label : '';
      if (!isBusinessSetupAiOwnerSectionId(id) || !itemLabel) return null;
      items.push({ id, label: itemLabel });
    }
    groups.push({ group: label, items });
  }
  return groups;
}

export function businessSetupAiOwnerSectionFromHash(hash: string): BusinessSetupAiOwnerSectionId {
  const id = hash.replace(/^#/, '').trim();
  if (id === 'country-context') return 'tax-knowledge';
  return isBusinessSetupAiOwnerSectionId(id) ? id : 'tax-knowledge';
}
