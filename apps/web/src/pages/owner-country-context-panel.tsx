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
  onOpenCommand,
  onToggleCountryPack,
}: {
  countries: UnknownRecord[];
  packs: UnknownRecord[];
  rulesets: UnknownRecord[];
  countryPackActions: AggregateAction[];
  emptyRulesetCreateActions: AggregateAction[];
  busy: boolean;
  onOpenCommand: (command: string, meta: AggregateAction, prefilled: UnknownRecord) => void;
  onToggleCountryPack: (row: UnknownRecord) => void;
}) {
  return (
    <section className="nx-bsai-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Country context</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Countries, country packs, and rulesets required for tax knowledge.
          </p>
        </div>
        <ActionToolbar
          actions={countryPackActions.filter((a) => {
            const key = String(a.action_key ?? '');
            return key !== 'enable_country_pack' && key !== 'disable_country_pack';
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
                {['Country', 'Name', 'Status', 'Timezone'].map((h) => (
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
                </tr>
              ))}
              {!countries.length ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12, color: '#666' }}>
                    No countries in the owner aggregate.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

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
              {packs.map((row, idx) => {
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
              {!packs.length ? (
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
              {rulesets.map((row, idx) => (
                <tr key={`${String(row.id ?? '')}:${idx}`}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_code ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.country_pack_id ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_version ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_from ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_to ?? 'open')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                </tr>
              ))}
              {!rulesets.length ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, background: '#fafafa' }}>
                    <div style={{ color: '#666', marginBottom: 8 }}>No rulesets</div>
                    <ActionToolbar
                      variant="compact"
                      actions={emptyRulesetCreateActions}
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
