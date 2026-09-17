/**
 * TAX-641B — executable AI adapter registry.
 * Code is the source of truth. Database adapter_type is only an identifier.
 * Adding a protocol requires a new adapter module + registry entry + tests,
 * not a Control Plane table redesign.
 */

export const AI_ADAPTER_TYPE_OPENAI_COMPATIBLE = 'openai_compatible' as const;

export const AI_ADAPTER_TYPES = [AI_ADAPTER_TYPE_OPENAI_COMPATIBLE] as const;
export type AiAdapterType = (typeof AI_ADAPTER_TYPES)[number];

export type AiAdapterRegistryEntry = {
  adapter_type: AiAdapterType;
  label: string;
  supports_custom_base_url: boolean;
  requires_structured_output: boolean;
  requires_pinned_model: boolean;
  addable: true;
};

export const AI_ADAPTER_REGISTRY: readonly AiAdapterRegistryEntry[] = [
  {
    adapter_type: AI_ADAPTER_TYPE_OPENAI_COMPATIBLE,
    label: 'OpenAI-compatible',
    supports_custom_base_url: true,
    requires_structured_output: true,
    requires_pinned_model: true,
    addable: true,
  },
];

const BY_TYPE = new Map(AI_ADAPTER_REGISTRY.map((entry) => [entry.adapter_type, entry]));

export function isRegisteredAiAdapterType(value: string): value is AiAdapterType {
  return BY_TYPE.has(value as AiAdapterType);
}

export function getAiAdapterRegistryEntry(adapterType: string): AiAdapterRegistryEntry | null {
  return BY_TYPE.get(adapterType as AiAdapterType) ?? null;
}

export function listAiAdapterRegistry(): AiAdapterRegistryEntry[] {
  return AI_ADAPTER_REGISTRY.map((entry) => ({ ...entry }));
}
