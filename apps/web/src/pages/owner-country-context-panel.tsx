import { useState } from 'react';
import { ActionToolbar, btnCompact, btnCompactMuted, type AggregateAction } from './owner-legal-control-panel-actions';
import { ownerLegalControlStatusBadgeLabel } from './owner-legal-control-render-safety';
import type { UnknownRecord } from './owner-legal-control-types';

function safeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function OwnerCountryContextPanel({
  countries,
  packs,
  rulesets,
  countryPackActions,
  emptyRulesetCreateActions,
  busy,
  selectedCountryCode,
  localeCatalog = [],
  onOpenCommand,
  onToggleCountryPack,
  onSaveLocalization,
}: {
  countries: UnknownRecord[];
  packs: UnknownRecord[];
  rulesets: UnknownRecord[];
  countryPackActions: AggregateAction[];
  emptyRulesetCreateActions: AggregateAction[];
  busy: boolean;
  selectedCountryCode?: string;
  localeCatalog?: Array<{ code: string; label: string }>;
  onOpenCommand: (command: string, meta: AggregateAction, prefilled: UnknownRecord) => void;
  onToggleCountryPack: (row: UnknownRecord) => void;
  onSaveLocalization?: (payload: UnknownRecord) => Promise<void>;
}) {
  const scopedCode = safeText(selectedCountryCode).toUpperCase();
  const scopedPacks = scopedCode
    ? packs.filter((row) => safeText(row.country_code).toUpperCase() === scopedCode)
    : packs;
  const scopedPackIds = new Set(scopedPacks.map((row) => safeText(row.id)));
  const scopedRulesets = scopedCode
    ? rulesets.filter((row) => scopedPackIds.has(safeText(row.country_pack_id)))
    : rulesets;
  const scopedEmptyRulesetActions = scopedRulesets.length ? [] : emptyRulesetCreateActions;
  const localizationAction = countryPackActions.find((row) => String(row.action_key ?? '') === 'update_country_localization');
  const [editingCode, setEditingCode] = useState('');
  const [editDefault, setEditDefault] = useState('');
  const [editSupported, setEditSupported] = useState<string[]>([]);

  function catalogLabel(code: string): string {
    return localeCatalog.find((row) => row.code === code)?.label || code;
  }

  function supportedList(row: UnknownRecord): string[] {
    return Array.isArray(row.supported_locales)
      ? row.supported_locales.filter((item): item is string => typeof item === 'string')
      : [];
  }

  function startEdit(row: UnknownRecord): void {
    const code = safeText(row.code).toUpperCase();
    const supported = supportedList(row);
    const currentDefault = safeText(row.default_locale);
    setEditingCode(code);
    setEditDefault(currentDefault);
    setEditSupported(supported.length ? supported : currentDefault ? [currentDefault] : []);
  }

  return (
    <section className="nx-bsai-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Country workspace</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Empty country catalog shells, packs, and rulesets. Creating a country does not copy or publish law.
          </p>
        </div>
        <ActionToolbar
          actions={countryPackActions.filter((a) => {
            const key = String(a.action_key ?? '');
            return (
              key !== 'enable_country_pack' &&
              key !== 'disable_country_pack' &&
              key !== 'create_country' &&
              key !== 'update_country_localization'
            );
          })}
          disabled={busy}
          onPick={(cmd, meta, pre) => onOpenCommand(cmd, meta, pre)}
        />
      </div>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['Country', 'Name', 'Status', 'Timezone', 'Default language', 'Supported'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countries.map((row, idx) => (
                <tr key={`${String(row.code ?? '')}:${idx}`}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.code ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.name ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.default_timezone ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {safeText(row.default_locale) ? catalogLabel(safeText(row.default_locale)) : '—'}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    <div>{supportedList(row).map((code) => catalogLabel(code)).join(', ') || '—'}</div>
                    {localizationAction?.enabled !== false && onSaveLocalization ? (
                      <button
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={busy}
                        onClick={() => startEdit(row)}
                      >
                        Languages
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!countries.length ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: '#666' }}>
                    No countries in the owner aggregate.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {editingCode ? (
          <div className="nx-bsai-access-card">
            <h3 style={{ marginTop: 0 }}>Languages — {editingCode}</h3>
            <p className="nx-bsai-muted">Backend-owned country locales. Canonical fact keys stay language-neutral.</p>
            <label className="nx-bsai-field">
              Default language
              <select value={editDefault} disabled={busy} onChange={(e) => setEditDefault(e.target.value)}>
                <option value="">Select</option>
                {localeCatalog.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="nx-bsai-access-checks">
              {localeCatalog.map((row) => (
                <label key={row.code} className="nx-bsai-access-check">
                  <input
                    type="checkbox"
                    checked={editSupported.includes(row.code)}
                    disabled={busy}
                    onChange={() => {
                      setEditSupported((current) =>
                        current.includes(row.code)
                          ? current.filter((item) => item !== row.code)
                          : [...current, row.code],
                      );
                    }}
                  />
                  {row.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy || !editDefault}
                onClick={() => {
                  const supported = editSupported.includes(editDefault) ? editSupported : [editDefault, ...editSupported];
                  void onSaveLocalization?.({
                    country_code: editingCode,
                    default_locale: editDefault,
                    supported_locales: supported,
                  }).then(() => setEditingCode(''));
                }}
              >
                Save languages
              </button>
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setEditingCode('')}>
                Close
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Pack', 'Country', 'Name', 'Framework', 'Code Version', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scopedPacks.map((row, idx) => {
                const status = safeText(row.status).toLowerCase();
                const enableAction = status === 'draft' || status === 'disabled';
                const disableAction = status === 'active' || status === 'enabled';
                const buttonLabel = enableAction ? 'Enable' : disableAction ? 'Disable' : null;
                const buttonDisabled = busy || !buttonLabel;
                return (
                  <tr key={`${String(row.id ?? '')}:${idx}`}>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.pack_code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.country_code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.name ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.framework_version ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.code_version ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      {buttonLabel ? (
                        <button
                          type="button"
                          disabled={buttonDisabled}
                          style={enableAction ? btnCompact : btnCompactMuted}
                          onClick={() => onToggleCountryPack(row)}
                        >
                          {buttonLabel}
                        </button>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!scopedPacks.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: '#666' }}>
                    No country packs in the owner aggregate.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                {['Ruleset', 'Pack', 'Version', 'Effective From', 'Effective To', 'Status'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scopedRulesets.map((row, idx) => (
                <tr key={`${String(row.id ?? '')}:${idx}`}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_code ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.country_pack_id ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_version ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_from ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_to ?? 'open')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                </tr>
              ))}
              {!scopedRulesets.length ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, background: '#fafafa' }}>
                    <div style={{ color: '#666', marginBottom: 8 }}>No rulesets</div>
                    <ActionToolbar
                      variant="compact"
                      actions={scopedEmptyRulesetActions}
                      disabled={busy}
                      onPick={(cmd, meta, pre) => onOpenCommand(cmd, meta, pre)}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
