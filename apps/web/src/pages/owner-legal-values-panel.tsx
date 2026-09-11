import { ActionToolbar, btnCompactMuted, labelFromActionKey, type AggregateAction } from './owner-legal-control-panel-actions';
import {
  ownerLegalControlStatusBadgeLabel,
  stringifyAggregateJson,
} from './owner-legal-control-render-safety';
import type { UnknownRecord } from './owner-legal-control-types';

export function OwnerLegalValuesPanel({
  rows,
  actions,
  busy,
  onOpenCommand,
}: {
  rows: UnknownRecord[];
  actions: AggregateAction[];
  busy: boolean;
  onOpenCommand: (command: string, meta: AggregateAction, prefilled: UnknownRecord) => void;
}) {
  return (
    <section className="nx-bsai-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Legal Values</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Country Pack legal constants. Commands only.
          </p>
        </div>
        <ActionToolbar actions={actions} disabled={busy} onPick={(cmd, meta, pre) => onOpenCommand(cmd, meta, pre)} />
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Key', 'Label', 'Category', 'Module Scope', 'Current Value', 'Effective', 'Owner Note', 'Usage Hint', 'Status', 'Actions'].map(
                (h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = String(row.value_key ?? '');
              const countryCode = String(row.country_code ?? '');
              const versions = Array.isArray(row.versions) ? (row.versions as UnknownRecord[]) : [];
              const activeVersion = versions.find((v) => v.status === 'active') ?? null;
              const effective = activeVersion
                ? `${String(activeVersion.effective_from ?? '')} -> ${String(activeVersion.effective_to ?? 'open')}`
                : '—';
              const rowPrefill = { country_code: countryCode, value_key: key };
              return (
                <tr key={`${countryCode}:${key}`}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{key}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.label ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.category ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.module_scope ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{stringifyAggregateJson(row.current_active_value)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{effective}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.owner_note ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.usage_hint ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{ownerLegalControlStatusBadgeLabel(row)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {actions.map((a) => {
                        const ak = String(a.action_key ?? '');
                        if (!ak || a.enabled === false) return null;
                        return (
                          <button
                            key={`${countryCode}:${key}:${ak}`}
                            type="button"
                            disabled={busy}
                            style={btnCompactMuted}
                            onClick={() => onOpenCommand(ak, a, { ...rowPrefill, owner_note: row.owner_note ?? '' })}
                          >
                            {labelFromActionKey(ak)}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={10} style={{ padding: 12, background: '#fafafa', color: '#666' }}>
                  No legal values — use the actions in the section header above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
