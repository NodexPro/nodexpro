import {
  OWNER_COUNTRY_LEGAL_CAPABILITIES,
  isOwnerCountryLegalCapability,
  type OwnerCountryLegalCapability,
} from './owner-country-legal-access.types.js';

export function normalizeOwnerLegalEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeOwnerLegalCountryCode(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function uniqueCountryCodes(values: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const code = normalizeOwnerLegalCountryCode(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** View is required to use the workspace; activate is never implied. */
export function normalizeGrantedCapabilities(values: unknown): OwnerCountryLegalCapability[] {
  const seen = new Set<OwnerCountryLegalCapability>();
  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const code = value.trim();
      if (!isOwnerCountryLegalCapability(code) || seen.has(code)) continue;
      seen.add(code);
    }
  }
  if (seen.size && !seen.has('legal_knowledge.view')) seen.add('legal_knowledge.view');
  return OWNER_COUNTRY_LEGAL_CAPABILITIES.filter((code) => seen.has(code));
}

export function capabilityRequiredForOwnerCommand(command: string): OwnerCountryLegalCapability | 'platform_owner_only' | null {
  if (command === 'request_country_legal_access') return null;
  if (
    command.startsWith('invite_country_legal') ||
    command.startsWith('approve_country_legal') ||
    command.startsWith('reject_country_legal') ||
    command.startsWith('grant_country_legal') ||
    command.startsWith('update_country_legal') ||
    command.startsWith('suspend_country_legal') ||
    command.startsWith('revoke_country_legal')
  ) {
    return 'platform_owner_only';
  }

  if (
    command === 'create_country' ||
    command === 'update_country_localization' ||
    command === 'create_country_pack' ||
    command === 'enable_country_pack' ||
    command === 'disable_country_pack' ||
    command === 'create_ruleset' ||
    command === 'update_ruleset_metadata' ||
    command === 'activate_ruleset' ||
    command === 'deactivate_ruleset' ||
    command === 'assign_country_pack_to_organization' ||
    command === 'change_active_ruleset_for_organization' ||
    command === 'update_organization_country_settings' ||
    command === 'update_module_scope' ||
    command === 'update_module_price' ||
    command === 'update_package_price' ||
    command === 'create_module_plan' ||
    command === 'evaluate_tax_rules' ||
    command === 'calculate_tax' ||
    command.startsWith('save_email') ||
    command.startsWith('save_platform') ||
    command.startsWith('save_request_template') ||
    command.startsWith('archive_request_template') ||
    command.startsWith('extend_org_module') ||
    command.startsWith('activate_org_module') ||
    command.includes('pricing_adjustment') ||
    command.includes('operational_reminder') ||
    command.startsWith('create_owner_invoice') ||
    command.startsWith('publish_owner_invoice') ||
    command.startsWith('update_owner_invoice')
  ) {
    return 'platform_owner_only';
  }

  if (
    command.startsWith('activate_') ||
    command === 'deactivate_legal_value_version' ||
    command === 'supersede_tax_rule_version' ||
    command === 'supersede_tax_strategy_version'
  ) {
    return 'legal_knowledge.activate';
  }

  if (
    command === 'create_tax_domain' ||
    command === 'update_tax_domain_metadata' ||
    command === 'create_tax_legal_node_kind' ||
    command === 'create_tax_legal_node' ||
    command === 'update_tax_legal_node_metadata' ||
    command.startsWith('create_tax_source') ||
    command.startsWith('update_tax_source') ||
    command === 'retire_tax_source'
  ) {
    return 'legal_sources.manage';
  }

  if (
    command.startsWith('create_legal_value') ||
    command.startsWith('update_legal_value') ||
    command === 'update_owner_note' ||
    command === 'update_usage_hint'
  ) {
    return 'legal_values.manage';
  }

  if (command.includes('tax_fact')) {
    return 'fact_dictionary.manage';
  }

  if (command === 'create_tax_rule' || command === 'create_tax_rule_version' || command === 'create_tax_strategy' || command === 'create_tax_strategy_version' || command === 'create_tax_strategy_exclusive_group') {
    return 'legal_knowledge.draft_create';
  }

  if (
    command.includes('accept_tax_rule_unresolved') ||
    command.includes('discard_tax_rule_unresolved') ||
    command.includes('resolve_tax_rule_unresolved')
  ) {
    return 'legal_knowledge.review';
  }

  if (
    command.startsWith('update_tax_rule') ||
    command.startsWith('pin_tax_rule') ||
    command.startsWith('unpin_tax_rule') ||
    command.startsWith('bind_tax_rule') ||
    command.startsWith('unbind_tax_rule') ||
    command === 'link_tax_rule_legal_node' ||
    command === 'unlink_tax_rule_legal_node' ||
    command.includes('tax_rule_relationship') ||
    command.includes('unresolved_legal_reference') ||
    command === 'retire_tax_rule_version' ||
    command === 'close_tax_rule_version_effective_to' ||
    command.startsWith('update_tax_strategy') ||
    command.startsWith('pin_tax_strategy') ||
    command.startsWith('unpin_tax_strategy') ||
    command === 'retire_tax_strategy_version' ||
    command === 'close_tax_strategy_version_effective_to' ||
    command === 'deactivate_ruleset'
  ) {
    return 'legal_knowledge.draft_edit';
  }

  return 'platform_owner_only';
}

export function evaluateOwnerLegalCommandAccess(
  actor: { kind: 'none' | 'platform_owner' | 'country_legal_maintainer'; capabilitiesByCountry: Record<string, string[]> },
  command: string,
  countryCode: string | null,
): { ok: true } | { ok: false; code: string } {
  const required = capabilityRequiredForOwnerCommand(command);
  if (required === null) return { ok: true };
  if (actor.kind === 'none') return { ok: false, code: 'OWNER_LEGAL_ACCESS_REQUIRED' };
  if (required === 'platform_owner_only') {
    return actor.kind === 'platform_owner' ? { ok: true } : { ok: false, code: 'PLATFORM_OWNER_REQUIRED' };
  }
  if (actor.kind === 'platform_owner') return { ok: true };
  if (!countryCode) return { ok: false, code: 'OWNER_LEGAL_COUNTRY_REQUIRED' };
  const caps = actor.capabilitiesByCountry[countryCode] ?? [];
  if (!caps.includes(required)) {
    return {
      ok: false,
      code: required === 'legal_knowledge.activate' ? 'OWNER_LEGAL_ACTIVATE_REQUIRED' : 'OWNER_LEGAL_CAPABILITY_REQUIRED',
    };
  }
  return { ok: true };
}

export function buildOwnerWorkspaceNavigation(kind: 'platform_owner' | 'country_legal_maintainer') {
  const taxAndLaw = {
    group: 'TAX & LAW',
    items: [
      { id: 'tax-knowledge', label: 'Legal Library' },
      { id: 'legal-values', label: 'Legal Values' },
      { id: 'fact-dictionary', label: 'Fact Dictionary' },
    ],
  };
  const businessSetup = {
    group: 'BUSINESS SETUP AI',
    items: [{ id: 'strategy-engine', label: 'Strategies' }],
  };
  if (kind !== 'platform_owner') return [taxAndLaw, businessSetup];
  return [
    taxAndLaw,
    businessSetup,
    {
      group: 'ADMINISTRATION',
      items: [{ id: 'access-experts', label: 'Access & Experts' }],
    },
  ];
}

export function actionEnabledForCapabilities(
  actionKey: string,
  capabilities: readonly string[],
): boolean {
  const required = capabilityRequiredForOwnerCommand(actionKey);
  if (required === null) return true;
  if (required === 'platform_owner_only') return false;
  return capabilities.includes(required);
}

export function maskActionsForCapabilities<T extends { action_key?: unknown; enabled?: unknown }>(
  actions: T[],
  capabilities: readonly string[],
  platformOwner: boolean,
): T[] {
  if (platformOwner) return actions;
  return actions.map((action) => {
    const key = typeof action.action_key === 'string' ? action.action_key : '';
    if (!key) return { ...action, enabled: false };
    return { ...action, enabled: action.enabled !== false && actionEnabledForCapabilities(key, capabilities) };
  });
}

export function auditPayloadHasSecret(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  const blob = JSON.stringify(payload).toLowerCase();
  return /password|token|secret|api_key|authorization/.test(blob);
}
