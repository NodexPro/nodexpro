import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import type {
  OwnerStrategyEngineAggregate,
  OwnerTaxStrategy,
  OwnerTaxStrategyAllowedAction,
  OwnerTaxStrategyCalculationPin,
  OwnerTaxStrategyCountry,
  OwnerTaxStrategyExclusiveGroup,
  OwnerTaxStrategyRulePin,
  OwnerTaxStrategySupersessionPair,
  OwnerTaxStrategyVersion,
  TaxKnowledgeAggregate,
  UnknownRecord,
} from './owner-legal-control-types';
import { emptyStrategyEngineAggregate } from './owner-legal-control-types';

const SCHEMA_NOT_APPLIED = 'strategy_engine_schema_not_applied';

const TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '8px 10px',
  color: '#6b7280',
  fontWeight: 600,
  fontSize: 12,
};

const TD_STYLE: CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
  padding: '8px 10px',
  color: '#111827',
  verticalAlign: 'top',
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseAuthoredMetadata(raw: unknown): UnknownRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as UnknownRecord;
}

function parseSupersessionPairs(raw: unknown): OwnerTaxStrategySupersessionPair[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      new_tax_strategy_version_id: asString(row.new_tax_strategy_version_id).trim(),
      old_tax_strategy_version_id: asString(row.old_tax_strategy_version_id).trim(),
    }))
    .filter((pair) => pair.new_tax_strategy_version_id !== '' && pair.old_tax_strategy_version_id !== '');
}

function parseAllowedActions(raw: unknown): OwnerTaxStrategyAllowedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => {
      const payloadRaw = asRecord(row.payload);
      const payload: Record<string, string> = {};
      if (payloadRaw) {
        for (const [key, val] of Object.entries(payloadRaw)) {
          if (typeof val === 'string') payload[key] = val;
        }
      }
      const candidates = parseSupersessionPairs(row.candidates);
      return {
        action_key: asString(row.action_key),
        enabled: row.enabled !== false,
        payload,
        ...(candidates.length ? { candidates } : {}),
      };
    });
}

function parseCountries(raw: unknown): OwnerTaxStrategyCountry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.code).trim() !== '')
    .map((row) => ({
      code: asString(row.code),
      name: asString(row.name) || asString(row.code),
      status: asString(row.status),
    }));
}

function parseExclusiveGroups(raw: unknown): OwnerTaxStrategyExclusiveGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      group_code: asString(row.group_code),
      title: asString(row.title),
      owner_note: asNullableString(row.owner_note),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseRulePins(raw: unknown): OwnerTaxStrategyRulePin[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_strategy_version_id: asString(row.tax_strategy_version_id),
      tax_rule_version_id: asString(row.tax_rule_version_id),
      tax_rule_id: asNullableString(row.tax_rule_id),
      rule_code: asNullableString(row.rule_code),
      rule_title: asNullableString(row.rule_title),
      version_no: asNullableNumber(row.version_no),
      status: asNullableString(row.status),
      pin_role: asString(row.pin_role),
      created_at: asString(row.created_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseCalculationPins(raw: unknown): OwnerTaxStrategyCalculationPin[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_strategy_version_id: asString(row.tax_strategy_version_id),
      calculation_definition_version_id: asString(row.calculation_definition_version_id),
      tax_calculation_definition_id: asNullableString(row.tax_calculation_definition_id),
      calculation_code: asNullableString(row.calculation_code),
      calculation_title: asNullableString(row.calculation_title),
      version_no: asNullableNumber(row.version_no),
      status: asNullableString(row.status),
      created_at: asString(row.created_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseVersion(row: UnknownRecord): OwnerTaxStrategyVersion {
  return {
    id: asString(row.id),
    tax_strategy_id: asString(row.tax_strategy_id),
    country_code: asString(row.country_code),
    version_no: typeof row.version_no === 'number' ? row.version_no : Number(row.version_no) || 0,
    status: asString(row.status),
    effective_from: asString(row.effective_from),
    effective_to: asNullableString(row.effective_to),
    title: asString(row.title),
    requires_professional_judgment: row.requires_professional_judgment === true,
    exclusive_group_id: asNullableString(row.exclusive_group_id),
    exclusive_group_code: asNullableString(row.exclusive_group_code),
    exclusive_group_title: asNullableString(row.exclusive_group_title),
    authored_metadata_json: parseAuthoredMetadata(row.authored_metadata_json),
    strategy_checksum: asString(row.strategy_checksum),
    supersedes_version_id: asNullableString(row.supersedes_version_id),
    superseded_by_version_id: asNullableString(row.superseded_by_version_id),
    activated_at: asNullableString(row.activated_at),
    retired_at: asNullableString(row.retired_at),
    retired_reason: asNullableString(row.retired_reason),
    created_at: asString(row.created_at),
    rule_pins: parseRulePins(row.rule_pins),
    calculation_pins: parseCalculationPins(row.calculation_pins),
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

function parseVersions(raw: unknown): OwnerTaxStrategyVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map(parseVersion);
}

function parseStrategies(raw: unknown): OwnerTaxStrategy[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      strategy_code: asString(row.strategy_code),
      admin_label: asNullableString(row.admin_label),
      owner_note: asNullableString(row.owner_note),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      versions: parseVersions(row.versions),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

export function parseStrategyEngineAggregate(raw: unknown): OwnerStrategyEngineAggregate {
  const rec = asRecord(raw);
  if (!rec) return emptyStrategyEngineAggregate();

  const selectedRaw = rec.selected_country_code;
  const selected =
    typeof selectedRaw === 'string' && /^[A-Za-z]{2}$/.test(selectedRaw.trim())
      ? selectedRaw.trim().toUpperCase()
      : null;

  return {
    selected_country_code: selected,
    countries: parseCountries(rec.countries),
    exclusive_groups: parseExclusiveGroups(rec.exclusive_groups),
    strategies: parseStrategies(rec.strategies),
    strategy_versions: parseVersions(rec.strategy_versions),
    allowed_actions: parseAllowedActions(rec.allowed_actions),
    warnings: Array.isArray(rec.warnings)
      ? rec.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export type StrategyLineagePresentation =
  | { kind: 'empty' }
  | { kind: 'resolved'; label: string }
  | { kind: 'unresolved'; id: string };

export type StrategyVersionLineageRef = {
  id: string;
  title: string;
  version_no: number;
};

/** Exact sibling lookup only. Does not fetch or substitute another version. */
export function strategyVersionsPresentInAggregate(
  slice: OwnerStrategyEngineAggregate,
): StrategyVersionLineageRef[] {
  const byId = new Map<string, StrategyVersionLineageRef>();
  for (const version of slice.strategy_versions) {
    if (!version.id) continue;
    byId.set(version.id, { id: version.id, title: version.title, version_no: version.version_no });
  }
  for (const strategy of slice.strategies) {
    for (const version of strategy.versions) {
      if (!version.id) continue;
      byId.set(version.id, { id: version.id, title: version.title, version_no: version.version_no });
    }
  }
  return [...byId.values()];
}

export function strategyVersionLineageLabel(
  versionId: string | null,
  versionsInAggregate: ReadonlyArray<StrategyVersionLineageRef>,
): StrategyLineagePresentation {
  if (!versionId) return { kind: 'empty' };
  const found = versionsInAggregate.find((row) => row.id === versionId);
  if (found) return { kind: 'resolved', label: `${found.title} — v${found.version_no}` };
  return { kind: 'unresolved', id: versionId };
}

export function exactPinnedVersionLabel(versionNo: number | null): string {
  if (versionNo == null || !Number.isFinite(versionNo)) return '';
  return `v${versionNo}`;
}

function authoredString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function authoredList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join(', ');
  }
  return typeof value === 'string' ? value : '';
}

export type StrategyAuthoredMetadataDisplay = {
  explanation: string;
  benefits: string;
  risks: string;
  constraints: string;
  costs_tradeoffs: string;
  category: string;
  domain: string;
  tags: string;
};

export function strategyAuthoredMetadataDisplay(raw: UnknownRecord): StrategyAuthoredMetadataDisplay {
  return {
    explanation: authoredString(raw.explanation),
    benefits: authoredList(raw.benefits),
    risks: authoredList(raw.risks),
    constraints: authoredList(raw.constraints),
    costs_tradeoffs: authoredList(raw.costs_tradeoffs),
    category: authoredString(raw.category),
    domain: authoredString(raw.domain),
    tags: authoredList(raw.tags),
  };
}

export const E3C2_SURFACED_COMMANDS = [
  'create_tax_strategy',
  'update_tax_strategy_metadata',
  'create_tax_strategy_exclusive_group',
  'update_tax_strategy_exclusive_group',
  'create_tax_strategy_version',
  'update_tax_strategy_version_draft',
  'activate_tax_strategy_version',
  'retire_tax_strategy_version',
  'close_tax_strategy_version_effective_to',
  'supersede_tax_strategy_version',
] as const;

export const E3C3_SURFACED_COMMANDS = ['pin_tax_strategy_rule', 'unpin_tax_strategy_rule'] as const;

export type StrategyEngineDialogKind =
  | (typeof E3C2_SURFACED_COMMANDS)[number]
  | (typeof E3C3_SURFACED_COMMANDS)[number]
  | null;

export type TaxKnowledgeRuleVersionPickerRow = {
  tax_rule_version_id: string;
  rule_id: string;
  rule_code: string;
  rule_title: string;
  version_no: number;
  status: string;
};

export function taxKnowledgeRuleVersionPickerRows(
  taxKnowledge: TaxKnowledgeAggregate,
): TaxKnowledgeRuleVersionPickerRow[] {
  const rows: TaxKnowledgeRuleVersionPickerRow[] = [];
  for (const rule of taxKnowledge.rules) {
    for (const version of rule.versions) {
      if (!version.id) continue;
      rows.push({
        tax_rule_version_id: version.id,
        rule_id: rule.id,
        rule_code: rule.rule_code,
        rule_title: rule.title,
        version_no: version.version_no,
        status: version.status,
      });
    }
  }
  return rows;
}

export function taxKnowledgeRuleVersionPickerLabel(row: TaxKnowledgeRuleVersionPickerRow): string {
  return `${row.rule_code} — ${row.rule_title} — v${row.version_no} (${row.status})`;
}

export function buildPinTaxStrategyRulePayload(
  taxStrategyVersionId: string,
  taxRuleVersionId: string,
  pinRole: 'required' | 'prohibited',
): UnknownRecord {
  return {
    tax_strategy_version_id: taxStrategyVersionId,
    tax_rule_version_id: taxRuleVersionId,
    pin_role: pinRole,
  };
}

export function buildUnpinTaxStrategyRulePayload(pinId: string): UnknownRecord {
  return { tax_strategy_version_rule_pin_id: pinId };
}

export type StrategyVersionWriteForm = {
  title: string;
  effective_from: string;
  effective_to: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string;
  explanation: string;
  benefits: string;
  risks: string;
  constraints: string;
  costs_tradeoffs: string;
  category: string;
  domain: string;
  tags: string;
};

export function enabledStrategyAction(
  actions: OwnerTaxStrategyAllowedAction[],
  actionKey: string,
): OwnerTaxStrategyAllowedAction | null {
  const found = actions.find((action) => action.action_key === actionKey) ?? null;
  return found && found.enabled === true ? found : null;
}

export function newlineListToStrings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function authoredListToNewline(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join('\n');
  }
  return typeof value === 'string' ? value : '';
}

export function buildStrategyAuthoredMetadataJson(form: StrategyVersionWriteForm): UnknownRecord {
  return {
    explanation: form.explanation,
    benefits: newlineListToStrings(form.benefits),
    risks: newlineListToStrings(form.risks),
    constraints: newlineListToStrings(form.constraints),
    costs_tradeoffs: newlineListToStrings(form.costs_tradeoffs),
    category: form.category,
    domain: form.domain,
    tags: newlineListToStrings(form.tags),
  };
}

export function versionFormFromAggregate(version: OwnerTaxStrategyVersion): StrategyVersionWriteForm {
  const raw = version.authored_metadata_json;
  return {
    title: version.title,
    effective_from: version.effective_from.slice(0, 10),
    effective_to: (version.effective_to ?? '').slice(0, 10),
    requires_professional_judgment: version.requires_professional_judgment === true,
    exclusive_group_id: version.exclusive_group_id ?? '',
    explanation: authoredString(raw.explanation),
    benefits: authoredListToNewline(raw.benefits),
    risks: authoredListToNewline(raw.risks),
    constraints: authoredListToNewline(raw.constraints),
    costs_tradeoffs: authoredListToNewline(raw.costs_tradeoffs),
    category: authoredString(raw.category),
    domain: authoredString(raw.domain),
    tags: authoredListToNewline(raw.tags),
  };
}

export function buildCreateTaxStrategyPayload(
  countryCode: string,
  form: { strategy_code: string; admin_label: string; owner_note: string },
): UnknownRecord {
  const payload: UnknownRecord = {
    country_code: countryCode,
    strategy_code: form.strategy_code.trim(),
  };
  if (form.admin_label.trim()) payload.admin_label = form.admin_label.trim();
  if (form.owner_note.trim()) payload.owner_note = form.owner_note.trim();
  return payload;
}

export function buildUpdateTaxStrategyMetadataPayload(
  taxStrategyId: string,
  form: { admin_label: string; owner_note: string },
): UnknownRecord {
  return {
    tax_strategy_id: taxStrategyId,
    admin_label: form.admin_label,
    owner_note: form.owner_note,
  };
}

export function buildCreateExclusiveGroupPayload(
  countryCode: string,
  form: { group_code: string; title: string; owner_note: string },
): UnknownRecord {
  const payload: UnknownRecord = {
    country_code: countryCode,
    group_code: form.group_code.trim(),
    title: form.title.trim(),
  };
  if (form.owner_note.trim()) payload.owner_note = form.owner_note.trim();
  return payload;
}

export function buildUpdateExclusiveGroupPayload(
  groupId: string,
  form: { title: string; owner_note: string },
): UnknownRecord {
  return {
    tax_strategy_exclusive_group_id: groupId,
    title: form.title,
    owner_note: form.owner_note,
  };
}

export function buildCreateTaxStrategyVersionPayload(
  taxStrategyId: string,
  form: StrategyVersionWriteForm,
): UnknownRecord {
  return {
    tax_strategy_id: taxStrategyId,
    title: form.title.trim(),
    effective_from: form.effective_from.trim(),
    effective_to: form.effective_to.trim(),
    requires_professional_judgment: form.requires_professional_judgment,
    exclusive_group_id: form.exclusive_group_id,
    authored_metadata_json: buildStrategyAuthoredMetadataJson(form),
  };
}

export function buildUpdateTaxStrategyVersionDraftPayload(
  taxStrategyVersionId: string,
  form: StrategyVersionWriteForm,
): UnknownRecord {
  return {
    tax_strategy_version_id: taxStrategyVersionId,
    title: form.title.trim(),
    effective_from: form.effective_from.trim(),
    effective_to: form.effective_to.trim(),
    requires_professional_judgment: form.requires_professional_judgment,
    exclusive_group_id: form.exclusive_group_id,
    authored_metadata_json: buildStrategyAuthoredMetadataJson(form),
  };
}

export function supersedePairsFromStrategyAction(
  action: OwnerTaxStrategyAllowedAction | null,
): OwnerTaxStrategySupersessionPair[] {
  if (!action) return [];
  if (action.candidates && action.candidates.length) return action.candidates;
  const neu = (action.payload.new_tax_strategy_version_id ?? '').trim();
  const old = (action.payload.old_tax_strategy_version_id ?? '').trim();
  if (neu && old) return [{ new_tax_strategy_version_id: neu, old_tax_strategy_version_id: old }];
  return [];
}

function actionLabel(actionKey: string): string {
  return actionKey
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const EMPTY_IDENTITY_FORM = { strategy_code: '', admin_label: '', owner_note: '' };
const EMPTY_GROUP_FORM = { group_code: '', title: '', owner_note: '' };
const EMPTY_VERSION_FORM: StrategyVersionWriteForm = {
  title: '',
  effective_from: '',
  effective_to: '',
  requires_professional_judgment: false,
  exclusive_group_id: '',
  explanation: '',
  benefits: '',
  risks: '',
  constraints: '',
  costs_tradeoffs: '',
  category: '',
  domain: '',
  tags: '',
};

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

function schemaUnavailable(warnings: string[]): boolean {
  return warnings.some(
    (warning) => warning === SCHEMA_NOT_APPLIED || /schema-not-applied|unavailable/i.test(warning),
  );
}

function ActionButton({
  actions,
  actionKey,
  busy,
  onClick,
  label,
}: {
  actions: OwnerTaxStrategyAllowedAction[];
  actionKey: (typeof E3C2_SURFACED_COMMANDS)[number] | (typeof E3C3_SURFACED_COMMANDS)[number];
  busy: boolean;
  onClick: () => void;
  label?: string;
}) {
  if (!enabledStrategyAction(actions, actionKey)) return null;
  return (
    <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClick}>
      {label ?? actionLabel(actionKey)}
    </button>
  );
}

export function OwnerStrategyEnginePanel({
  strategyEngine,
  taxKnowledge,
  busy,
  onCommand,
}: {
  strategyEngine: OwnerStrategyEngineAggregate;
  taxKnowledge: TaxKnowledgeAggregate;
  busy: boolean;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [pendingGroupId, setPendingGroupId] = useState('');
  const [dialogKind, setDialogKind] = useState(null as StrategyEngineDialogKind);
  const [formError, setFormError] = useState('');
  const [identityForm, setIdentityForm] = useState(EMPTY_IDENTITY_FORM);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);
  const [versionForm, setVersionForm] = useState(EMPTY_VERSION_FORM);
  const [retiredReason, setRetiredReason] = useState('');
  const [closeEffectiveTo, setCloseEffectiveTo] = useState('');
  const [supersedeCandidateIndex, setSupersedeCandidateIndex] = useState(-1);
  const [pendingPinId, setPendingPinId] = useState('');
  const [pinRuleVersionId, setPinRuleVersionId] = useState('');
  const [pinRole, setPinRole] = useState('');

  const selectedCountryCode = strategyEngine.selected_country_code;
  const schemaNotApplied = schemaUnavailable(strategyEngine.warnings);
  const versionsInAggregate = useMemo(
    () => strategyVersionsPresentInAggregate(strategyEngine),
    [strategyEngine],
  );

  useEffect(() => {
    const ids = new Set(strategyEngine.strategies.map((row) => row.id).filter(Boolean));
    setSelectedStrategyId((prev) => (prev && ids.has(prev) ? prev : ''));
  }, [strategyEngine]);

  const selectedStrategy = strategyEngine.strategies.find((row) => row.id && row.id === selectedStrategyId) ?? null;

  useEffect(() => {
    if (!selectedStrategy) {
      setSelectedVersionId('');
      return;
    }
    const versionIds = new Set(selectedStrategy.versions.map((row) => row.id).filter(Boolean));
    setSelectedVersionId((prev) => {
      if (prev && versionIds.has(prev)) return prev;
      return selectedStrategy.versions[0]?.id ?? '';
    });
  }, [selectedStrategy]);

  const selectedVersion =
    selectedStrategy?.versions.find((row) => row.id && row.id === selectedVersionId) ?? null;
  const authored = selectedVersion ? strategyAuthoredMetadataDisplay(selectedVersion.authored_metadata_json) : null;
  const supersedes = selectedVersion
    ? strategyVersionLineageLabel(selectedVersion.supersedes_version_id, versionsInAggregate)
    : { kind: 'empty' as const };
  const supersededBy = selectedVersion
    ? strategyVersionLineageLabel(selectedVersion.superseded_by_version_id, versionsInAggregate)
    : { kind: 'empty' as const };
  const pendingGroup =
    strategyEngine.exclusive_groups.find((row) => row.id && row.id === pendingGroupId) ?? null;
  const pendingPin = selectedVersion?.rule_pins.find((row) => row.id && row.id === pendingPinId) ?? null;
  const ruleVersionPickerRows = useMemo(
    () => taxKnowledgeRuleVersionPickerRows(taxKnowledge),
    [taxKnowledge],
  );
  const supersedeAction = enabledStrategyAction(
    selectedVersion?.allowed_actions ?? [],
    'supersede_tax_strategy_version',
  );
  const supersedePairs = supersedePairsFromStrategyAction(supersedeAction);

  useEffect(() => {
    if (!dialogKind) return;
    setFormError('');
    if (dialogKind === 'create_tax_strategy') {
      setIdentityForm(EMPTY_IDENTITY_FORM);
    }
    if (dialogKind === 'update_tax_strategy_metadata' && selectedStrategy) {
      setIdentityForm({
        strategy_code: selectedStrategy.strategy_code,
        admin_label: selectedStrategy.admin_label ?? '',
        owner_note: selectedStrategy.owner_note ?? '',
      });
    }
    if (dialogKind === 'create_tax_strategy_exclusive_group') {
      setGroupForm(EMPTY_GROUP_FORM);
    }
    if (dialogKind === 'update_tax_strategy_exclusive_group' && pendingGroup) {
      setGroupForm({
        group_code: pendingGroup.group_code,
        title: pendingGroup.title,
        owner_note: pendingGroup.owner_note ?? '',
      });
    }
    if (dialogKind === 'create_tax_strategy_version') {
      setVersionForm(EMPTY_VERSION_FORM);
    }
    if (dialogKind === 'update_tax_strategy_version_draft' && selectedVersion) {
      setVersionForm(versionFormFromAggregate(selectedVersion));
    }
    if (dialogKind === 'retire_tax_strategy_version') {
      setRetiredReason('');
    }
    if (dialogKind === 'close_tax_strategy_version_effective_to' && selectedVersion) {
      setCloseEffectiveTo((selectedVersion.effective_to ?? '').slice(0, 10));
    }
    if (dialogKind === 'supersede_tax_strategy_version') {
      const pairs = supersedePairsFromStrategyAction(
        enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'supersede_tax_strategy_version'),
      );
      setSupersedeCandidateIndex(pairs.length === 1 ? 0 : -1);
    }
    if (dialogKind === 'pin_tax_strategy_rule') {
      setPinRuleVersionId('');
      setPinRole('');
    }
  }, [dialogKind, selectedStrategy, selectedVersion, pendingGroup]);

  async function submitDialog(): Promise<void> {
    setFormError('');
    try {
      if (dialogKind === 'create_tax_strategy') {
        if (!enabledStrategyAction(strategyEngine.allowed_actions, 'create_tax_strategy')) return;
        if (!selectedCountryCode) {
          setFormError('Select a country first.');
          return;
        }
        if (!identityForm.strategy_code.trim()) {
          setFormError('strategy_code is required.');
          return;
        }
        await onCommand('create_tax_strategy', buildCreateTaxStrategyPayload(selectedCountryCode, identityForm));
      } else if (dialogKind === 'update_tax_strategy_metadata') {
        if (
          !enabledStrategyAction(selectedStrategy?.allowed_actions ?? [], 'update_tax_strategy_metadata') ||
          !selectedStrategy
        ) {
          return;
        }
        await onCommand(
          'update_tax_strategy_metadata',
          buildUpdateTaxStrategyMetadataPayload(selectedStrategy.id, identityForm),
        );
      } else if (dialogKind === 'create_tax_strategy_exclusive_group') {
        if (!enabledStrategyAction(strategyEngine.allowed_actions, 'create_tax_strategy_exclusive_group')) return;
        if (!selectedCountryCode) {
          setFormError('Select a country first.');
          return;
        }
        if (!groupForm.group_code.trim() || !groupForm.title.trim()) {
          setFormError('group_code and title are required.');
          return;
        }
        await onCommand(
          'create_tax_strategy_exclusive_group',
          buildCreateExclusiveGroupPayload(selectedCountryCode, groupForm),
        );
      } else if (dialogKind === 'update_tax_strategy_exclusive_group') {
        if (
          !pendingGroup ||
          !enabledStrategyAction(pendingGroup.allowed_actions, 'update_tax_strategy_exclusive_group')
        ) {
          return;
        }
        if (!groupForm.title.trim()) {
          setFormError('title is required.');
          return;
        }
        await onCommand(
          'update_tax_strategy_exclusive_group',
          buildUpdateExclusiveGroupPayload(pendingGroup.id, groupForm),
        );
      } else if (dialogKind === 'create_tax_strategy_version') {
        if (
          !enabledStrategyAction(selectedStrategy?.allowed_actions ?? [], 'create_tax_strategy_version') ||
          !selectedStrategy
        ) {
          return;
        }
        if (!versionForm.title.trim() || !versionForm.effective_from.trim()) {
          setFormError('title and effective_from are required.');
          return;
        }
        await onCommand(
          'create_tax_strategy_version',
          buildCreateTaxStrategyVersionPayload(selectedStrategy.id, versionForm),
        );
      } else if (dialogKind === 'update_tax_strategy_version_draft') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'update_tax_strategy_version_draft') ||
          !selectedVersion
        ) {
          return;
        }
        if (!versionForm.title.trim() || !versionForm.effective_from.trim()) {
          setFormError('title and effective_from are required.');
          return;
        }
        await onCommand(
          'update_tax_strategy_version_draft',
          buildUpdateTaxStrategyVersionDraftPayload(selectedVersion.id, versionForm),
        );
      } else if (dialogKind === 'activate_tax_strategy_version') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'activate_tax_strategy_version') ||
          !selectedVersion
        ) {
          return;
        }
        await onCommand('activate_tax_strategy_version', { tax_strategy_version_id: selectedVersion.id });
      } else if (dialogKind === 'retire_tax_strategy_version') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'retire_tax_strategy_version') ||
          !selectedVersion
        ) {
          return;
        }
        const retirePayload: UnknownRecord = { tax_strategy_version_id: selectedVersion.id };
        if (retiredReason.trim()) retirePayload.retired_reason = retiredReason.trim();
        await onCommand('retire_tax_strategy_version', retirePayload);
      } else if (dialogKind === 'close_tax_strategy_version_effective_to') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'close_tax_strategy_version_effective_to') ||
          !selectedVersion
        ) {
          return;
        }
        if (!closeEffectiveTo.trim()) {
          setFormError('effective_to is required.');
          return;
        }
        await onCommand('close_tax_strategy_version_effective_to', {
          tax_strategy_version_id: selectedVersion.id,
          effective_to: closeEffectiveTo.trim(),
        });
      } else if (dialogKind === 'supersede_tax_strategy_version') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'supersede_tax_strategy_version') ||
          !selectedVersion
        ) {
          return;
        }
        const pairs = supersedePairsFromStrategyAction(
          enabledStrategyAction(selectedVersion.allowed_actions, 'supersede_tax_strategy_version'),
        );
        const pair = pairs.length === 1 ? pairs[0] : pairs[supersedeCandidateIndex];
        if (!pair) {
          setFormError('Select a supersession pair.');
          return;
        }
        await onCommand('supersede_tax_strategy_version', {
          new_tax_strategy_version_id: pair.new_tax_strategy_version_id,
          old_tax_strategy_version_id: pair.old_tax_strategy_version_id,
        });
      } else if (dialogKind === 'pin_tax_strategy_rule') {
        if (
          !enabledStrategyAction(selectedVersion?.allowed_actions ?? [], 'pin_tax_strategy_rule') ||
          !selectedVersion
        ) {
          return;
        }
        if (!pinRuleVersionId || (pinRole !== 'required' && pinRole !== 'prohibited')) {
          setFormError('Rule version and role are required.');
          return;
        }
        await onCommand(
          'pin_tax_strategy_rule',
          buildPinTaxStrategyRulePayload(selectedVersion.id, pinRuleVersionId, pinRole),
        );
      } else if (dialogKind === 'unpin_tax_strategy_rule') {
        if (
          !pendingPin ||
          !enabledStrategyAction(pendingPin.allowed_actions, 'unpin_tax_strategy_rule')
        ) {
          return;
        }
        await onCommand('unpin_tax_strategy_rule', buildUnpinTaxStrategyRulePayload(pendingPin.id));
      } else {
        return;
      }
      setDialogKind(null);
      setPendingGroupId('');
      setPendingPinId('');
    } catch (e) {
      setFormError(e instanceof Error && e.message ? e.message : 'Command failed');
    }
  }

  return (
    <SectionCard
      style={{
        marginTop: 18,
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Strategy Engine</h2>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
          Country-scoped catalog from the owner legal-control aggregate. Commands only. Country follows the Tax
          Knowledge selection.
        </p>
      </div>

      {selectedCountryCode ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#374151' }}>
          Selected country: <strong>{selectedCountryCode}</strong>
        </p>
      ) : null}

      {strategyEngine.warnings.length ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: '#fff8e6',
            border: '1px solid #f0d090',
            color: '#92400e',
          }}
        >
          <strong>Strategy Engine warnings</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {strategyEngine.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!selectedCountryCode ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No country selected"
            description="Select a country above to load Strategy Engine groups and strategies from the owner legal-control aggregate."
          />
        </div>
      ) : null}

      {selectedCountryCode && schemaNotApplied ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="Strategy Engine schema is not applied"
            description={SCHEMA_NOT_APPLIED}
          />
        </div>
      ) : null}

      {selectedCountryCode && !schemaNotApplied ? (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <ActionButton
              actions={strategyEngine.allowed_actions}
              actionKey="create_tax_strategy"
              busy={busy}
              onClick={() => setDialogKind('create_tax_strategy')}
            />
            <ActionButton
              actions={strategyEngine.allowed_actions}
              actionKey="create_tax_strategy_exclusive_group"
              busy={busy}
              onClick={() => setDialogKind('create_tax_strategy_exclusive_group')}
            />
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Exclusive groups</h3>
            {strategyEngine.exclusive_groups.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>group_code</th>
                      <th style={TH_STYLE}>title</th>
                      <th style={TH_STYLE}>owner_note</th>
                      <th style={TH_STYLE}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyEngine.exclusive_groups.map((row) => (
                      <tr key={row.id || row.group_code}>
                        <td style={TD_STYLE}>{row.group_code || '—'}</td>
                        <td style={TD_STYLE}>{row.title || '—'}</td>
                        <td style={TD_STYLE}>{row.owner_note || '—'}</td>
                        <td style={TD_STYLE}>
                          <ActionButton
                            actions={row.allowed_actions}
                            actionKey="update_tax_strategy_exclusive_group"
                            busy={busy}
                            onClick={() => {
                              setPendingGroupId(row.id);
                              setDialogKind('update_tax_strategy_exclusive_group');
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No exclusive groups" description="No exclusive groups for this country." />
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Strategies</h3>
            {strategyEngine.strategies.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>strategy_code</th>
                      <th style={TH_STYLE}>admin_label</th>
                      <th style={TH_STYLE}>versions</th>
                      <th style={TH_STYLE}>owner_note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyEngine.strategies.map((row) => {
                      const isSelected = Boolean(row.id) && row.id === selectedStrategyId;
                      return (
                        <tr
                          key={row.id || row.strategy_code}
                          onClick={() => row.id && setSelectedStrategyId(row.id)}
                          style={{ cursor: row.id ? 'pointer' : 'default', background: isSelected ? '#eff6ff' : undefined }}
                        >
                          <td style={TD_STYLE}>{row.strategy_code || '—'}</td>
                          <td style={TD_STYLE}>{row.admin_label || '—'}</td>
                          <td style={TD_STYLE}>{String(row.versions.length)}</td>
                          <td style={TD_STYLE}>{row.owner_note || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No strategies" description="No strategies for this country." />
            )}
          </div>

          {selectedStrategy ? (
            <SelectedStrategyDisplay
              strategy={selectedStrategy}
              selectedVersion={selectedVersion}
              selectedVersionId={selectedVersionId}
              onSelectVersion={setSelectedVersionId}
              authored={authored}
              supersedes={supersedes}
              supersededBy={supersededBy}
              busy={busy}
              onOpenDialog={setDialogKind}
              onOpenUnpin={(pinId) => {
                setPendingPinId(pinId);
                setDialogKind('unpin_tax_strategy_rule');
              }}
            />
          ) : strategyEngine.strategies.length ? (
            <EmptyState title="No strategy selected" description="Select a strategy to display its versions." />
          ) : null}
        </div>
      ) : null}

      {dialogKind ? (
        <StrategyEngineCommandDialog
          dialogKind={dialogKind}
          busy={busy}
          formError={formError}
          selectedCountryCode={selectedCountryCode}
          selectedStrategy={selectedStrategy}
          selectedVersion={selectedVersion}
          pendingGroup={pendingGroup}
          pendingPin={pendingPin}
          exclusiveGroups={strategyEngine.exclusive_groups}
          ruleVersionPickerRows={ruleVersionPickerRows}
          identityForm={identityForm}
          groupForm={groupForm}
          versionForm={versionForm}
          retiredReason={retiredReason}
          closeEffectiveTo={closeEffectiveTo}
          supersedePairs={supersedePairs}
          supersedeCandidateIndex={supersedeCandidateIndex}
          versionsInAggregate={versionsInAggregate}
          pinRuleVersionId={pinRuleVersionId}
          pinRole={pinRole}
          onIdentityForm={setIdentityForm}
          onGroupForm={setGroupForm}
          onVersionForm={setVersionForm}
          onRetiredReason={setRetiredReason}
          onCloseEffectiveTo={setCloseEffectiveTo}
          onSupersedeCandidateIndex={setSupersedeCandidateIndex}
          onPinRuleVersionId={setPinRuleVersionId}
          onPinRole={setPinRole}
          onClose={() => {
            if (!busy) {
              setDialogKind(null);
              setPendingGroupId('');
              setPendingPinId('');
            }
          }}
          onSubmit={() => void submitDialog()}
        />
      ) : null}
    </SectionCard>
  );
}

function lineageMainValue(row: StrategyLineagePresentation): string {
  if (row.kind === 'resolved') return row.label;
  return '';
}

function SelectedStrategyDisplay({
  strategy,
  selectedVersion,
  selectedVersionId,
  onSelectVersion,
  authored,
  supersedes,
  supersededBy,
  busy,
  onOpenDialog,
  onOpenUnpin,
}: {
  strategy: OwnerTaxStrategy;
  selectedVersion: OwnerTaxStrategyVersion | null;
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  authored: StrategyAuthoredMetadataDisplay | null;
  supersedes: StrategyLineagePresentation;
  supersededBy: StrategyLineagePresentation;
  busy: boolean;
  onOpenDialog: (kind: StrategyEngineDialogKind) => void;
  onOpenUnpin: (pinId: string) => void;
}) {
  return (
    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Strategy</div>
      <StateRow label="strategy_code" value={strategy.strategy_code} />
      <StateRow label="admin_label" value={strategy.admin_label ?? ''} />
      <StateRow label="owner_note" value={strategy.owner_note ?? ''} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <ActionButton
          actions={strategy.allowed_actions}
          actionKey="update_tax_strategy_metadata"
          busy={busy}
          onClick={() => onOpenDialog('update_tax_strategy_metadata')}
        />
        <ActionButton
          actions={strategy.allowed_actions}
          actionKey="create_tax_strategy_version"
          busy={busy}
          onClick={() => onOpenDialog('create_tax_strategy_version')}
        />
      </div>

      <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Versions</h3>
      {strategy.versions.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={TH_STYLE}>title</th>
                <th style={TH_STYLE}>version</th>
                <th style={TH_STYLE}>status</th>
                <th style={TH_STYLE}>effective_from</th>
                <th style={TH_STYLE}>effective_to</th>
              </tr>
            </thead>
            <tbody>
              {strategy.versions.map((row) => {
                const isSelected = Boolean(row.id) && row.id === selectedVersionId;
                return (
                  <tr
                    key={row.id || `${row.version_no}-${row.title}`}
                    onClick={() => row.id && onSelectVersion(row.id)}
                    style={{ cursor: row.id ? 'pointer' : 'default', background: isSelected ? '#eff6ff' : undefined }}
                  >
                    <td style={TD_STYLE}>{row.title || '—'}</td>
                    <td style={TD_STYLE}>{exactPinnedVersionLabel(row.version_no) || '—'}</td>
                    <td style={TD_STYLE}>{row.status || '—'}</td>
                    <td style={TD_STYLE}>{row.effective_from || '—'}</td>
                    <td style={TD_STYLE}>{row.effective_to || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No versions" description="No strategy versions for this identity." />
      )}

      {selectedVersion && authored ? (
        <SelectedVersionDisplay
          version={selectedVersion}
          authored={authored}
          supersedes={supersedes}
          supersededBy={supersededBy}
          busy={busy}
          onOpenDialog={onOpenDialog}
          onOpenUnpin={onOpenUnpin}
        />
      ) : null}
    </div>
  );
}

function SelectedVersionDisplay({
  version,
  authored,
  supersedes,
  supersededBy,
  busy,
  onOpenDialog,
  onOpenUnpin,
}: {
  version: OwnerTaxStrategyVersion;
  authored: StrategyAuthoredMetadataDisplay;
  supersedes: StrategyLineagePresentation;
  supersededBy: StrategyLineagePresentation;
  busy: boolean;
  onOpenDialog: (kind: StrategyEngineDialogKind) => void;
  onOpenUnpin: (pinId: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Version</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <ActionButton
          actions={version.allowed_actions}
          actionKey="update_tax_strategy_version_draft"
          busy={busy}
          onClick={() => onOpenDialog('update_tax_strategy_version_draft')}
        />
        <ActionButton
          actions={version.allowed_actions}
          actionKey="activate_tax_strategy_version"
          busy={busy}
          onClick={() => onOpenDialog('activate_tax_strategy_version')}
        />
        <ActionButton
          actions={version.allowed_actions}
          actionKey="retire_tax_strategy_version"
          busy={busy}
          onClick={() => onOpenDialog('retire_tax_strategy_version')}
        />
        <ActionButton
          actions={version.allowed_actions}
          actionKey="close_tax_strategy_version_effective_to"
          busy={busy}
          onClick={() => onOpenDialog('close_tax_strategy_version_effective_to')}
        />
        <ActionButton
          actions={version.allowed_actions}
          actionKey="supersede_tax_strategy_version"
          busy={busy}
          onClick={() => onOpenDialog('supersede_tax_strategy_version')}
        />
        <ActionButton
          actions={version.allowed_actions}
          actionKey="pin_tax_strategy_rule"
          busy={busy}
          label="Pin rule"
          onClick={() => onOpenDialog('pin_tax_strategy_rule')}
        />
      </div>
      <StateRow label="title" value={version.title} />
      <StateRow label="version" value={exactPinnedVersionLabel(version.version_no)} />
      <StateRow label="status" value={version.status} />
      <StateRow label="effective_from" value={version.effective_from} />
      <StateRow label="effective_to" value={version.effective_to ?? ''} />
      <StateRow
        label="requires_professional_judgment"
        value={version.requires_professional_judgment ? 'true' : 'false'}
      />
      <StateRow label="exclusive_group_title" value={version.exclusive_group_title ?? ''} />
      <StateRow label="exclusive_group_code" value={version.exclusive_group_code ?? ''} />

      <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Authored metadata</h3>
      <StateRow label="explanation" value={authored.explanation} />
      <StateRow label="benefits" value={authored.benefits} />
      <StateRow label="risks" value={authored.risks} />
      <StateRow label="constraints" value={authored.constraints} />
      <StateRow label="costs_tradeoffs" value={authored.costs_tradeoffs} />
      <StateRow label="category" value={authored.category} />
      <StateRow label="domain" value={authored.domain} />
      <StateRow label="tags" value={authored.tags} />

      <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Rule pins</h3>
      {version.rule_pins.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={TH_STYLE}>rule_title</th>
                <th style={TH_STYLE}>rule_code</th>
                <th style={TH_STYLE}>version</th>
                <th style={TH_STYLE}>pin_role</th>
                <th style={TH_STYLE}>status</th>
                <th style={TH_STYLE}></th>
              </tr>
            </thead>
            <tbody>
              {version.rule_pins.map((pin) => (
                <tr key={pin.id || pin.tax_rule_version_id}>
                  <td style={TD_STYLE}>{pin.rule_title || '—'}</td>
                  <td style={TD_STYLE}>{pin.rule_code || '—'}</td>
                  <td style={TD_STYLE}>{exactPinnedVersionLabel(pin.version_no) || '—'}</td>
                  <td style={TD_STYLE}>{pin.pin_role || '—'}</td>
                  <td style={TD_STYLE}>{pin.status || '—'}</td>
                  <td style={TD_STYLE}>
                    <ActionButton
                      actions={pin.allowed_actions}
                      actionKey="unpin_tax_strategy_rule"
                      busy={busy}
                      label="Unpin"
                      onClick={() => pin.id && onOpenUnpin(pin.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No rule pins" description="No rule pins on this strategy version." />
      )}

      <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Calculation pins</h3>
      {version.calculation_pins.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={TH_STYLE}>calculation title</th>
                <th style={TH_STYLE}>calculation code</th>
                <th style={TH_STYLE}>version</th>
                <th style={TH_STYLE}>status</th>
              </tr>
            </thead>
            <tbody>
              {version.calculation_pins.map((pin) => (
                <tr key={pin.id || pin.calculation_definition_version_id}>
                  <td style={TD_STYLE}>{pin.calculation_title || '—'}</td>
                  <td style={TD_STYLE}>{pin.calculation_code || '—'}</td>
                  <td style={TD_STYLE}>{exactPinnedVersionLabel(pin.version_no) || '—'}</td>
                  <td style={TD_STYLE}>{pin.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No calculation pins" description="No calculation pins on this strategy version." />
      )}

      <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Lineage</h3>
      <StateRow label="supersedes" value={lineageMainValue(supersedes)} />
      <StateRow label="superseded by" value={lineageMainValue(supersededBy)} />

      <details style={{ marginTop: 16, border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, background: '#fff' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#6b7280' }}>
          Technical details
        </summary>
        <div style={{ marginTop: 8 }}>
          <StateRow label="strategy_checksum" value={version.strategy_checksum} />
          <StateRow label="activated_at" value={version.activated_at ?? ''} />
          <StateRow label="retired_at" value={version.retired_at ?? ''} />
          <StateRow label="retired_reason" value={version.retired_reason ?? ''} />
          <StateRow label="created_at" value={version.created_at} />
          {supersedes.kind === 'unresolved' ? (
            <StateRow label="supersedes_version_id" value={supersedes.id} />
          ) : null}
          {supersededBy.kind === 'unresolved' ? (
            <StateRow label="superseded_by_version_id" value={supersededBy.id} />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function groupRuleVersionPickerRows(
  rows: TaxKnowledgeRuleVersionPickerRow[],
): Array<{
  rule_id: string;
  rule_code: string;
  rule_title: string;
  versions: TaxKnowledgeRuleVersionPickerRow[];
}> {
  const groups: Array<{
    rule_id: string;
    rule_code: string;
    rule_title: string;
    versions: TaxKnowledgeRuleVersionPickerRow[];
  }> = [];
  const indexByRule = new Map<string, number>();
  for (const row of rows) {
    const key = row.rule_id || row.rule_code;
    let index = indexByRule.get(key);
    if (index == null) {
      index = groups.length;
      indexByRule.set(key, index);
      groups.push({
        rule_id: key,
        rule_code: row.rule_code,
        rule_title: row.rule_title,
        versions: [],
      });
    }
    groups[index].versions.push(row);
  }
  return groups;
}

function candidateVersionLabel(
  versionId: string,
  versionsInAggregate: ReadonlyArray<StrategyVersionLineageRef>,
): string {
  const resolved = strategyVersionLineageLabel(versionId, versionsInAggregate);
  return resolved.kind === 'resolved' ? resolved.label : versionId;
}

function StrategyVersionHumanFields({
  form,
  exclusiveGroups,
  onChange,
}: {
  form: StrategyVersionWriteForm;
  exclusiveGroups: OwnerTaxStrategyExclusiveGroup[];
  onChange: (next: StrategyVersionWriteForm) => void;
}) {
  return (
    <div className="nx-form-grid">
      <label className="nx-field">
        <span className="nx-field-label">title</span>
        <input className="nx-input" value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">effective_from</span>
        <input
          className="nx-input"
          type="date"
          value={form.effective_from}
          onChange={(e) => onChange({ ...form, effective_from: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">effective_to</span>
        <input
          className="nx-input"
          type="date"
          value={form.effective_to}
          onChange={(e) => onChange({ ...form, effective_to: e.target.value })}
        />
      </label>
      <label className="nx-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={form.requires_professional_judgment}
          onChange={(e) => onChange({ ...form, requires_professional_judgment: e.target.checked })}
        />
        <span className="nx-field-label" style={{ margin: 0 }}>
          requires_professional_judgment
        </span>
      </label>
      <label className="nx-field">
        <span className="nx-field-label">exclusive_group_id</span>
        <select
          className="nx-select"
          value={form.exclusive_group_id}
          onChange={(e) => onChange({ ...form, exclusive_group_id: e.target.value })}
        >
          <option value="">None</option>
          {exclusiveGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.title || group.group_code}
              {group.group_code ? ` (${group.group_code})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="nx-field">
        <span className="nx-field-label">explanation</span>
        <textarea
          className="nx-textarea"
          rows={3}
          value={form.explanation}
          onChange={(e) => onChange({ ...form, explanation: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">benefits (one per line)</span>
        <textarea
          className="nx-textarea"
          rows={3}
          value={form.benefits}
          onChange={(e) => onChange({ ...form, benefits: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">risks (one per line)</span>
        <textarea
          className="nx-textarea"
          rows={3}
          value={form.risks}
          onChange={(e) => onChange({ ...form, risks: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">constraints (one per line)</span>
        <textarea
          className="nx-textarea"
          rows={3}
          value={form.constraints}
          onChange={(e) => onChange({ ...form, constraints: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">costs_tradeoffs (one per line)</span>
        <textarea
          className="nx-textarea"
          rows={3}
          value={form.costs_tradeoffs}
          onChange={(e) => onChange({ ...form, costs_tradeoffs: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">category</span>
        <input
          className="nx-input"
          value={form.category}
          onChange={(e) => onChange({ ...form, category: e.target.value })}
        />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">domain</span>
        <input className="nx-input" value={form.domain} onChange={(e) => onChange({ ...form, domain: e.target.value })} />
      </label>
      <label className="nx-field">
        <span className="nx-field-label">tags (one per line)</span>
        <textarea
          className="nx-textarea"
          rows={2}
          value={form.tags}
          onChange={(e) => onChange({ ...form, tags: e.target.value })}
        />
      </label>
    </div>
  );
}

function StrategyEngineCommandDialog({
  dialogKind,
  busy,
  formError,
  selectedCountryCode,
  selectedStrategy,
  selectedVersion,
  pendingGroup,
  pendingPin,
  exclusiveGroups,
  ruleVersionPickerRows,
  identityForm,
  groupForm,
  versionForm,
  retiredReason,
  closeEffectiveTo,
  supersedePairs,
  supersedeCandidateIndex,
  versionsInAggregate,
  pinRuleVersionId,
  pinRole,
  onIdentityForm,
  onGroupForm,
  onVersionForm,
  onRetiredReason,
  onCloseEffectiveTo,
  onSupersedeCandidateIndex,
  onPinRuleVersionId,
  onPinRole,
  onClose,
  onSubmit,
}: {
  dialogKind: NonNullable<StrategyEngineDialogKind>;
  busy: boolean;
  formError: string;
  selectedCountryCode: string | null;
  selectedStrategy: OwnerTaxStrategy | null;
  selectedVersion: OwnerTaxStrategyVersion | null;
  pendingGroup: OwnerTaxStrategyExclusiveGroup | null;
  pendingPin: OwnerTaxStrategyRulePin | null;
  exclusiveGroups: OwnerTaxStrategyExclusiveGroup[];
  ruleVersionPickerRows: TaxKnowledgeRuleVersionPickerRow[];
  identityForm: { strategy_code: string; admin_label: string; owner_note: string };
  groupForm: { group_code: string; title: string; owner_note: string };
  versionForm: StrategyVersionWriteForm;
  retiredReason: string;
  closeEffectiveTo: string;
  supersedePairs: OwnerTaxStrategySupersessionPair[];
  supersedeCandidateIndex: number;
  versionsInAggregate: StrategyVersionLineageRef[];
  pinRuleVersionId: string;
  pinRole: string;
  onIdentityForm: (next: { strategy_code: string; admin_label: string; owner_note: string }) => void;
  onGroupForm: (next: { group_code: string; title: string; owner_note: string }) => void;
  onVersionForm: (next: StrategyVersionWriteForm) => void;
  onRetiredReason: (next: string) => void;
  onCloseEffectiveTo: (next: string) => void;
  onSupersedeCandidateIndex: (next: number) => void;
  onPinRuleVersionId: (next: string) => void;
  onPinRole: (next: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const confirmKind =
    dialogKind === 'activate_tax_strategy_version' ||
    dialogKind === 'retire_tax_strategy_version' ||
    dialogKind === 'supersede_tax_strategy_version' ||
    dialogKind === 'unpin_tax_strategy_rule';
  const pickerGroups = groupRuleVersionPickerRows(ruleVersionPickerRows);
  return (
    <div
      className="nx-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="nx-modal nx-accounting-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={actionLabel(dialogKind)}
        style={{
          direction: 'ltr',
          maxWidth:
            dialogKind === 'create_tax_strategy_version' || dialogKind === 'update_tax_strategy_version_draft'
              ? 640
              : 560,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-modal-header">
          <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked" style={{ alignItems: 'flex-start' }}>
            <h2 className="nx-modal-title" style={{ fontSize: 18 }}>
              {actionLabel(dialogKind)}
            </h2>
            <span className="nx-modal-subtitle">
              {dialogKind}
              {dialogKind.startsWith('create_')
                ? ` · country ${selectedCountryCode || '—'}`
                : selectedStrategy && dialogKind.includes('strategy') && !dialogKind.includes('version')
                  ? ` · ${selectedStrategy.strategy_code}`
                  : selectedVersion
                    ? ` · ${selectedVersion.title} — v${selectedVersion.version_no}`
                    : pendingGroup
                      ? ` · ${pendingGroup.group_code}`
                      : ''}
            </span>
          </div>
          <button type="button" className="nx-modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        <div className="nx-modal-body" style={{ flex: '0 1 auto' }}>
          {formError ? <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 0 }}>{formError}</p> : null}
          {dialogKind === 'create_tax_strategy' || dialogKind === 'update_tax_strategy_metadata' ? (
            <div className="nx-form-grid">
              {dialogKind === 'create_tax_strategy' ? (
                <label className="nx-field">
                  <span className="nx-field-label">strategy_code</span>
                  <input
                    className="nx-input"
                    value={identityForm.strategy_code}
                    onChange={(e) => onIdentityForm({ ...identityForm, strategy_code: e.target.value })}
                  />
                </label>
              ) : null}
              <label className="nx-field">
                <span className="nx-field-label">admin_label</span>
                <input
                  className="nx-input"
                  value={identityForm.admin_label}
                  onChange={(e) => onIdentityForm({ ...identityForm, admin_label: e.target.value })}
                />
              </label>
              <label className="nx-field">
                <span className="nx-field-label">owner_note</span>
                <textarea
                  className="nx-textarea"
                  rows={3}
                  value={identityForm.owner_note}
                  onChange={(e) => onIdentityForm({ ...identityForm, owner_note: e.target.value })}
                />
              </label>
            </div>
          ) : null}
          {dialogKind === 'create_tax_strategy_exclusive_group' ||
          dialogKind === 'update_tax_strategy_exclusive_group' ? (
            <div className="nx-form-grid">
              {dialogKind === 'create_tax_strategy_exclusive_group' ? (
                <label className="nx-field">
                  <span className="nx-field-label">group_code</span>
                  <input
                    className="nx-input"
                    value={groupForm.group_code}
                    onChange={(e) => onGroupForm({ ...groupForm, group_code: e.target.value })}
                  />
                </label>
              ) : null}
              <label className="nx-field">
                <span className="nx-field-label">title</span>
                <input
                  className="nx-input"
                  value={groupForm.title}
                  onChange={(e) => onGroupForm({ ...groupForm, title: e.target.value })}
                />
              </label>
              <label className="nx-field">
                <span className="nx-field-label">owner_note</span>
                <textarea
                  className="nx-textarea"
                  rows={3}
                  value={groupForm.owner_note}
                  onChange={(e) => onGroupForm({ ...groupForm, owner_note: e.target.value })}
                />
              </label>
            </div>
          ) : null}
          {dialogKind === 'create_tax_strategy_version' || dialogKind === 'update_tax_strategy_version_draft' ? (
            <StrategyVersionHumanFields form={versionForm} exclusiveGroups={exclusiveGroups} onChange={onVersionForm} />
          ) : null}
          {dialogKind === 'activate_tax_strategy_version' && selectedVersion ? (
            <p style={{ fontSize: 14, margin: 0 }}>
              {selectedVersion.title} — v{selectedVersion.version_no}
            </p>
          ) : null}
          {dialogKind === 'retire_tax_strategy_version' ? (
            <div className="nx-form-grid">
              <label className="nx-field">
                <span className="nx-field-label">retired_reason</span>
                <textarea
                  className="nx-textarea"
                  rows={3}
                  value={retiredReason}
                  onChange={(e) => onRetiredReason(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          {dialogKind === 'close_tax_strategy_version_effective_to' ? (
            <div className="nx-form-grid">
              <label className="nx-field">
                <span className="nx-field-label">effective_to</span>
                <input
                  className="nx-input"
                  type="date"
                  value={closeEffectiveTo}
                  onChange={(e) => onCloseEffectiveTo(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          {dialogKind === 'supersede_tax_strategy_version' ? (
            supersedePairs.length === 1 ? (
              <p style={{ fontSize: 14, margin: 0 }}>
                {candidateVersionLabel(supersedePairs[0].old_tax_strategy_version_id, versionsInAggregate)}
                {' → '}
                {candidateVersionLabel(supersedePairs[0].new_tax_strategy_version_id, versionsInAggregate)}
              </p>
            ) : supersedePairs.length > 1 ? (
              <div className="nx-form-grid">
                <label className="nx-field">
                  <span className="nx-field-label">candidate</span>
                  <select
                    className="nx-select"
                    value={supersedeCandidateIndex < 0 ? '' : String(supersedeCandidateIndex)}
                    onChange={(e) => onSupersedeCandidateIndex(e.target.value === '' ? -1 : Number(e.target.value))}
                  >
                    <option value="">Select pair</option>
                    {supersedePairs.map((pair, index) => (
                      <option
                        key={`${pair.old_tax_strategy_version_id}-${pair.new_tax_strategy_version_id}`}
                        value={String(index)}
                      >
                        {candidateVersionLabel(pair.old_tax_strategy_version_id, versionsInAggregate)}
                        {' → '}
                        {candidateVersionLabel(pair.new_tax_strategy_version_id, versionsInAggregate)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p style={{ fontSize: 14, margin: 0 }}>No backend supersession pair is available.</p>
            )
          ) : null}
          {dialogKind === 'pin_tax_strategy_rule' ? (
            ruleVersionPickerRows.length ? (
              <div className="nx-form-grid">
                <label className="nx-field">
                  <span className="nx-field-label">Rule version</span>
                  <select
                    className="nx-select"
                    value={pinRuleVersionId}
                    onChange={(e) => onPinRuleVersionId(e.target.value)}
                  >
                    <option value="">Select rule version</option>
                    {pickerGroups.map((group) => (
                      <optgroup key={group.rule_id || group.rule_code} label={`${group.rule_code} — ${group.rule_title}`}>
                        {group.versions.map((row) => (
                          <option key={row.tax_rule_version_id} value={row.tax_rule_version_id}>
                            {taxKnowledgeRuleVersionPickerLabel(row)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="nx-field">
                  <span className="nx-field-label">Role</span>
                  <select className="nx-select" value={pinRole} onChange={(e) => onPinRole(e.target.value)}>
                    <option value="">Select role</option>
                    <option value="required">Required</option>
                    <option value="prohibited">Prohibited</option>
                  </select>
                </label>
              </div>
            ) : (
              <EmptyState
                title="No tax rule versions"
                description="No tax rule versions are available for this country."
              />
            )
          ) : null}
          {dialogKind === 'unpin_tax_strategy_rule' && pendingPin ? (
            <p style={{ fontSize: 14, margin: 0 }}>
              {pendingPin.rule_title || pendingPin.rule_code || 'Rule pin'}
              {pendingPin.rule_code ? ` · ${pendingPin.rule_code}` : ''}
              {exactPinnedVersionLabel(pendingPin.version_no) ? ` · ${exactPinnedVersionLabel(pendingPin.version_no)}` : ''}
              {pendingPin.pin_role ? ` · ${pendingPin.pin_role}` : ''}
            </p>
          ) : null}
        </div>
        <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center' }}>
          <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={onSubmit}>
            {busy ? '…' : confirmKind ? 'Confirm' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
