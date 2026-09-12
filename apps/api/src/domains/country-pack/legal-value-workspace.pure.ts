import {
  formatEffectiveDisplay,
  formatLegalValueDisplay,
  yearFromDate,
  type LegalBasisPickerOption,
  type LegalValueWorkspaceCard,
} from './legal-value-authority.pure.js';

type VersionInput = {
  id?: string;
  status?: string;
  effective_from?: string;
  effective_to?: string | null;
  value_payload_json?: unknown;
  authorities?: Array<{
    id?: string;
    tax_rule_version_id?: string;
    path_label?: string;
    domain_id?: string | null;
    source_id?: string | null;
  }>;
};

type LegalValueRowInput = {
  id?: string;
  country_code?: string;
  value_key?: string;
  label?: string;
  category?: string;
  module_scope?: string;
  usage_hint?: string | null;
  owner_note?: string | null;
  value_type?: string;
  status?: string;
  versions?: VersionInput[];
};

type ActorCaps = {
  kind?: string;
  canManage?: boolean;
  canActivate?: boolean;
};

function statusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'draft') return 'Draft';
  if (status === 'deprecated') return 'Superseded';
  if (status === 'disabled') return 'Disabled';
  return status || '—';
}

export function buildLegalBasisPickerOptions(input: {
  domains: Array<{
    id: string;
    title: string;
    sources: Array<{
      id: string;
      title: string;
      nodes: Array<{
        id: string;
        title: string;
        kind_label?: string;
        node_number?: string | null;
        linked_rules: Array<{ tax_rule_id: string; title: string }>;
        children?: unknown[];
      }>;
    }>;
  }>;
  rules: Array<{
    id: string;
    title: string;
    versions: Array<{ id: string; version_no?: number; status: string }>;
  }>;
}): LegalBasisPickerOption[] {
  const ruleById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const options: LegalBasisPickerOption[] = [];

  const walkNodes = (
    nodes: Array<{
      id: string;
      title: string;
      kind_label?: string;
      node_number?: string | null;
      linked_rules: Array<{ tax_rule_id: string; title: string }>;
      children?: unknown[];
    }>,
    domain: { id: string; title: string },
    source: { id: string; title: string },
  ) => {
    for (const node of nodes) {
      const nodeTitle = [node.kind_label, node.node_number, node.title].filter(Boolean).join(' ').trim() || node.title;
      for (const linked of node.linked_rules) {
        const rule = ruleById.get(linked.tax_rule_id);
        if (!rule) continue;
        for (const version of rule.versions) {
          options.push({
            tax_rule_version_id: version.id,
            tax_rule_id: rule.id,
            domain_id: domain.id,
            source_id: source.id,
            node_id: node.id,
            label: `${domain.title} → ${source.title} → ${nodeTitle} → ${rule.title} · v${version.version_no ?? '?'} (${version.status})`,
            domain_title: domain.title,
            source_title: source.title,
            node_title: nodeTitle,
            rule_title: rule.title,
            version_no: typeof version.version_no === 'number' ? version.version_no : null,
            version_status: version.status,
          });
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        walkNodes(node.children as typeof nodes, domain, source);
      }
    }
  };

  for (const domain of input.domains) {
    for (const source of domain.sources) {
      walkNodes(source.nodes ?? [], domain, source);
    }
  }
  return options;
}

export function buildLegalValueWorkspaceCards(
  rows: LegalValueRowInput[],
  countryNameByCode: Record<string, string>,
  today: string,
  actor: ActorCaps,
): LegalValueWorkspaceCard[] {
  return rows.map((row) => {
    const versions = Array.isArray(row.versions) ? row.versions : [];
    const current = versions.find((item) => {
      const from = String(item.effective_from ?? '');
      const to = item.effective_to == null ? null : String(item.effective_to);
      return item.status === 'active' && from <= today && (to == null || to >= today);
    }) ?? versions.find((item) => item.status === 'active') ?? null;
    const upcoming = versions.find((item) => {
      const from = String(item.effective_from ?? '');
      return item.status === 'active' && from > today;
    }) ?? versions.find((item) => item.status === 'draft' && String(item.effective_from ?? '') > today) ?? null;
    const draft = versions.find((item) => item.status === 'draft') ?? null;
    const valueType = String(row.value_type ?? '');
    const basis = (current?.authorities ?? draft?.authorities ?? []).map((pin) => String(pin.path_label ?? '')).filter(Boolean);
    const domainIds = new Set<string>();
    const sourceIds = new Set<string>();
    const years = new Set<string>();
    for (const version of versions) {
      const yearFrom = yearFromDate(version.effective_from);
      const yearTo = yearFromDate(version.effective_to ?? null);
      if (yearFrom) years.add(yearFrom);
      if (yearTo) years.add(yearTo);
      for (const pin of version.authorities ?? []) {
        if (pin.domain_id) domainIds.add(pin.domain_id);
        if (pin.source_id) sourceIds.add(pin.source_id);
      }
    }
    const canManage = actor.kind === 'platform_owner' || actor.canManage === true;
    const canActivate = actor.kind === 'platform_owner' || actor.canActivate === true;
    return {
      id: String(row.id ?? ''),
      country_code: String(row.country_code ?? ''),
      country_name: countryNameByCode[String(row.country_code ?? '')] ?? String(row.country_code ?? ''),
      title: String(row.label ?? ''),
      current_value_display: formatLegalValueDisplay(valueType, current?.value_payload_json),
      upcoming_value_display: upcoming
        ? formatLegalValueDisplay(valueType, upcoming.value_payload_json)
        : null,
      effective_display: current
        ? formatEffectiveDisplay(current.effective_from, current.effective_to)
        : draft
          ? formatEffectiveDisplay(draft.effective_from, draft.effective_to)
          : '—',
      legal_basis_display: basis,
      status_label: statusLabel(String(current?.status ?? row.status ?? 'draft')),
      filter_domain_ids: [...domainIds],
      filter_source_ids: [...sourceIds],
      filter_status: String(current?.status ?? row.status ?? ''),
      filter_effective_years: [...years],
      allowed_actions: [
        { action_key: 'update_legal_value_metadata', enabled: canManage, button_label: 'Edit draft' },
        { action_key: 'create_legal_value_version', enabled: canManage, button_label: 'New version' },
        {
          action_key: 'activate_legal_value_version',
          enabled: canActivate && Boolean(draft),
          button_label: 'Activate',
        },
      ],
      technical: {
        id: String(row.id ?? ''),
        value_key: String(row.value_key ?? ''),
        category: String(row.category ?? ''),
        module_scope: String(row.module_scope ?? ''),
        value_type: valueType,
        usage_hint: row.usage_hint == null ? '' : String(row.usage_hint),
        owner_note: row.owner_note == null ? '' : String(row.owner_note),
      },
      versions: versions.map((version) => ({
        id: String(version.id ?? ''),
        status: String(version.status ?? ''),
        status_label: statusLabel(String(version.status ?? '')),
        effective_from: String(version.effective_from ?? ''),
        effective_to: version.effective_to == null ? null : String(version.effective_to),
        value_display: formatLegalValueDisplay(valueType, version.value_payload_json),
        legal_basis_display: (version.authorities ?? []).map((pin) => String(pin.path_label ?? '')).filter(Boolean),
        is_current: current?.id === version.id,
        is_upcoming: upcoming?.id === version.id,
      })),
    };
  });
}
