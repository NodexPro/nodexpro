import type { IncomeWorkspaceContextAggregate } from '../../api/income';

type Props = {
  context: IncomeWorkspaceContextAggregate;
  busy: boolean;
  onSelectOption: (option: {
    acting_mode: string;
    issuer_business_id: string;
    represented_client_id: string | null;
  }) => void;
};

export function IncomeIssuerContextSwitcher({ context, busy, onSelectOption }: Props) {
  const canSwitch = context.allowed_actions.includes('select_issuer_context');

  return (
    <div className="nx-income-issuer-bar" aria-label="הקשר מנפיק">
      <span className="nx-income-issuer-bar__label">מנפיק פעיל:</span>
      <strong>{context.issuer_label}</strong>
      {context.represented_client_label ? (
        <span style={{ fontSize: 13, color: '#6b7280' }}> · {context.represented_client_label}</span>
      ) : null}
      {canSwitch ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginInlineStart: 'auto' }}>
          {context.issuer_options.map((opt) => {
            const active =
              context.active_issuer_business_id === opt.issuer_business_id &&
              context.acting_mode === opt.acting_mode &&
              (context.represented_client_id ?? null) === (opt.represented_client_id ?? null);
            const modeAllowed = context.allowed_acting_modes.find((m) => m.mode === opt.acting_mode);
            const enabled = modeAllowed?.enabled !== false;
            return (
              <button
                key={`${opt.acting_mode}-${opt.issuer_business_id}`}
                type="button"
                className={`nx-income-issuer-chip ${active ? 'nx-income-issuer-chip--active' : ''}`}
                disabled={busy || !enabled || active}
                title={modeAllowed?.reason ?? undefined}
                onClick={() =>
                  onSelectOption({
                    acting_mode: opt.acting_mode,
                    issuer_business_id: opt.issuer_business_id,
                    represented_client_id: opt.represented_client_id,
                  })
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
