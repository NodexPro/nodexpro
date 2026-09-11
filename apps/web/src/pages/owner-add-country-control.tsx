import { useMemo, useState } from 'react';
import { btnGhost, btnPrimary, type AggregateAction } from './owner-legal-control-panel-actions';
import { ownerIsoRegionPickerOptions } from './owner-iso-country-options';
import type { UnknownRecord } from './owner-legal-control-types';

export function OwnerAddCountryControl({
  action,
  existingCountryCodes,
  busy,
  localeCatalog = [],
  onSubmit,
}: {
  action: AggregateAction | null;
  existingCountryCodes: readonly string[];
  busy: boolean;
  localeCatalog?: Array<{ code: string; label: string }>;
  onSubmit: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [defaultLocale, setDefaultLocale] = useState('');
  const [supportedLocales, setSupportedLocales] = useState<string[]>([]);
  const [localError, setLocalError] = useState('');

  const isoOptions = useMemo(() => ownerIsoRegionPickerOptions(existingCountryCodes), [existingCountryCodes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return isoOptions.slice(0, 80);
    return isoOptions
      .filter((row) => row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q))
      .slice(0, 80);
  }, [isoOptions, query]);

  const commandKey = action?.action_key?.trim() || '';
  if (!action || !commandKey || action.enabled === false) return null;
  const buttonLabel = action.button_label?.trim() || 'Add Country';
  const displayLabel = buttonLabel.startsWith('+') ? buttonLabel : `+ ${buttonLabel}`;

  async function handleSubmit(): Promise<void> {
    setLocalError('');
    const nextCode = code.trim().toUpperCase();
    const nextName = name.trim();
    if (!/^[A-Z]{2}$/.test(nextCode) || !nextName) {
      setLocalError('ISO country code and display name are required.');
      return;
    }
    const payload: UnknownRecord = { code: nextCode, name: nextName };
    if (timezone.trim()) payload.default_timezone = timezone.trim();
    if (defaultLocale) {
      payload.default_locale = defaultLocale;
      payload.supported_locales = supportedLocales.includes(defaultLocale)
        ? supportedLocales
        : [defaultLocale, ...supportedLocales];
    }
    try {
      await onSubmit(commandKey, payload);
      setOpen(false);
      setQuery('');
      setCode('');
      setName('');
      setTimezone('');
      setDefaultLocale('');
      setSupportedLocales([]);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Request failed');
    }
  }

  return (
    <>
      <button
        type="button"
        className="nx-btn nx-btn-taxes-compact"
        disabled={busy}
        data-action-key={commandKey}
        onClick={() => setOpen(true)}
      >
        {displayLabel}
      </button>
      {open ? (
        <div className="nx-bsai-add-country-backdrop" onClick={() => setOpen(false)}>
          <div className="nx-bsai-add-country-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Add Country</h3>
            <p className="nx-bsai-muted">
              Creates an empty country catalog row. Does not copy or publish laws, legal values, strategies, or
              facts.
            </p>
            {action.note ? <p className="nx-bsai-muted">{action.note}</p> : null}
            {localError ? <p className="nx-bsai-error">{localError}</p> : null}
            <label className="nx-bsai-field">
              Search ISO countries
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Israel, IL, United States…"
              />
            </label>
            <label className="nx-bsai-field">
              Country
              <select
                value={code}
                onChange={(e) => {
                  const next = e.target.value;
                  setCode(next);
                  const match = isoOptions.find((row) => row.code === next);
                  if (match) setName(match.name);
                }}
              >
                <option value="">Select ISO country</option>
                {filtered.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.code} — {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="nx-bsai-field">
              Display name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="nx-bsai-field">
              Default timezone (optional)
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="IANA timezone, if known"
              />
            </label>
            {localeCatalog.length ? (
              <>
                <label className="nx-bsai-field">
                  Default language
                  <select value={defaultLocale} onChange={(e) => setDefaultLocale(e.target.value)} disabled={busy}>
                    <option value="">Optional — configure later</option>
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
                        checked={supportedLocales.includes(row.code)}
                        disabled={busy}
                        onChange={() => {
                          setSupportedLocales((current) =>
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
              </>
            ) : null}
            <p className="nx-bsai-muted">
              Country catalog status uses the backend default. An ISO row is not legally ready until packs, sources,
              and values are authored for that country.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" style={btnPrimary} disabled={busy} onClick={() => void handleSubmit()}>
                {busy ? '...' : 'Run create_country'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
