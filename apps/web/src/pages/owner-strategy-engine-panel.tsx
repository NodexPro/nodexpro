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

export function OwnerStrategyEnginePanel({
  strategyEngine,
}: {
  strategyEngine: OwnerStrategyEngineAggregate;
}) {
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');

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
          Read-only catalog from the owner legal-control aggregate. Country follows the Tax Knowledge selection.
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
                    </tr>
                  </thead>
                  <tbody>
                    {strategyEngine.exclusive_groups.map((row) => (
                      <tr key={row.id || row.group_code}>
                        <td style={TD_STYLE}>{row.group_code || '—'}</td>
                        <td style={TD_STYLE}>{row.title || '—'}</td>
                        <td style={TD_STYLE}>{row.owner_note || '—'}</td>
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
            />
          ) : strategyEngine.strategies.length ? (
            <EmptyState title="No strategy selected" description="Select a strategy to display its versions." />
          ) : null}
        </div>
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
}: {
  strategy: OwnerTaxStrategy;
  selectedVersion: OwnerTaxStrategyVersion | null;
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  authored: StrategyAuthoredMetadataDisplay | null;
  supersedes: StrategyLineagePresentation;
  supersededBy: StrategyLineagePresentation;
}) {
  return (
    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Strategy</div>
      <StateRow label="strategy_code" value={strategy.strategy_code} />
      <StateRow label="admin_label" value={strategy.admin_label ?? ''} />
      <StateRow label="owner_note" value={strategy.owner_note ?? ''} />

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
}: {
  version: OwnerTaxStrategyVersion;
  authored: StrategyAuthoredMetadataDisplay;
  supersedes: StrategyLineagePresentation;
  supersededBy: StrategyLineagePresentation;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Version</div>
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
