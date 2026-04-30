import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { ApiError, userFacingApiMessage } from '../api/client';
import type { StringFieldMap, UnknownRecord } from './owner-legal-control-types';

export type AggregateAction = {
  action_key?: string;
  enabled?: boolean;
  payload?: unknown;
  note?: string;
  /** Optional label from aggregate (e.g. localized primary action). */
  button_label?: string;
};

export type CommandModalState = {
  command: string;
  actionMeta: AggregateAction;
  prefilled: UnknownRecord;
};

export function normalizeActions(raw: unknown): AggregateAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a) => a && typeof a === 'object') as AggregateAction[];
}

/** Display label derived from aggregate `action_key` only (no fixed action catalog). */
export function labelFromActionKey(actionKey: string): string {
  return actionKey
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function isPayloadFieldSchema(payload: unknown): payload is StringFieldMap {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Object.values(payload as UnknownRecord).every((v) => typeof v === 'string');
}

function buildPayloadFromHints(form: StringFieldMap, hints: StringFieldMap): UnknownRecord {
  const out: UnknownRecord = {};
  for (const [key, hint] of Object.entries(hints)) {
    const raw = form[key];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
      if (hint.toLowerCase().includes('optional')) continue;
      continue;
    }
    const hl = hint.toLowerCase();
    // Hints like "number|percentage|…" or "VAT|Income Tax|…" are string enums, not numeric fields.
    if (hl.includes('|')) {
      out[key] = v;
    } else if (hl.includes('number')) {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = n;
    } else if (hl.includes('boolean')) {
      out[key] = v === 'true' || v === '1' || v === 'yes';
    } else {
      out[key] = v;
    }
  }
  return out;
}

export const btnCompact: CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: 6,
  border: '1px solid #2563eb',
  background: '#fff',
  color: '#2563eb',
  cursor: 'pointer',
};

export const btnCompactMuted: CSSProperties = {
  ...btnCompact,
  border: '1px solid #9ca3af',
  color: '#374151',
};

const btnPrimary: CSSProperties = {
  padding: '8px 20px',
  minWidth: 96,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: 6,
  border: 'none',
  background: '#059669',
  color: '#fff',
  cursor: 'pointer',
};

const btnGhost: CSSProperties = {
  padding: '8px 20px',
  minWidth: 96,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
};

export function ActionToolbar({
  actions,
  onPick,
  disabled,
  variant = 'default',
}: {
  actions: AggregateAction[];
  onPick: (command: string, meta: AggregateAction, prefilled: UnknownRecord) => void;
  disabled: boolean;
  variant?: 'default' | 'compact';
}) {
  const style = variant === 'compact' ? btnCompactMuted : btnCompact;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {actions.map((a) => {
        const key = String(a.action_key ?? '');
        if (!key || a.enabled === false) return null;
        return (
          <button key={key} type="button" disabled={disabled} style={style} onClick={() => onPick(key, a, {})}>
            {a.button_label?.trim() ? a.button_label : labelFromActionKey(key)}
          </button>
        );
      })}
    </div>
  );
}

export function CommandActionModal({
  open,
  state,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: CommandModalState | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const [schemaFields, setSchemaFields] = useState({} as StringFieldMap);
  const [jsonText, setJsonText] = useState('{}');
  const [localError, setLocalError] = useState('');

  const command = state?.command ?? '';
  const actionMeta = state?.actionMeta;
  const prefilled = state?.prefilled ?? {};
  const hints = actionMeta?.payload && isPayloadFieldSchema(actionMeta.payload) ? actionMeta.payload : null;

  useEffect(() => {
    if (!open || !state) return;
    setLocalError('');
    if (state.actionMeta.payload && isPayloadFieldSchema(state.actionMeta.payload)) {
      const init: StringFieldMap = {};
      for (const k of Object.keys(state.actionMeta.payload as StringFieldMap)) {
        const pv = state.prefilled[k];
        init[k] = pv === undefined || pv === null ? '' : typeof pv === 'object' ? JSON.stringify(pv) : String(pv);
      }
      setSchemaFields(init);
    } else {
      setJsonText(Object.keys(state.prefilled).length ? JSON.stringify(state.prefilled, null, 2) : '{}');
    }
  }, [open, state]);

  async function handleSubmit(): Promise<void> {
    if (!state || !actionMeta) return;
    setLocalError('');
    let payload: UnknownRecord;
    if (hints) {
      payload = { ...prefilled, ...buildPayloadFromHints(schemaFields, hints) };
    } else {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setLocalError('Payload must be a JSON object.');
          return;
        }
        payload = { ...prefilled, ...(parsed as UnknownRecord) };
      } catch {
        setLocalError('Invalid JSON.');
        return;
      }
    }
    try {
      await onSubmit(command, payload);
    } catch (e) {
      const detail =
        e instanceof ApiError
          ? [e.message || 'Request failed', e.code ? `code: ${e.code}` : null, `HTTP ${e.status}`].filter(Boolean).join(' — ')
          : userFacingApiMessage(e);
      setLocalError(detail);
    }
  }

  if (!open || !state || !actionMeta) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', width: 560, maxWidth: '100%', borderRadius: 8, padding: 16, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>
          {actionMeta.button_label?.trim() ? actionMeta.button_label : labelFromActionKey(command)}
        </h3>
        <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
          <strong>Action (from aggregate):</strong>{' '}
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{command}</span>
        </p>
        {actionMeta.note ? <p style={{ color: '#666', fontSize: 13 }}>{actionMeta.note}</p> : null}
        {localError ? <p style={{ color: 'red', fontSize: 14 }}>{localError}</p> : null}

        {hints ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {Object.entries(hints).map(([fieldKey, hint]) => (
              <label key={fieldKey} style={{ display: 'block', fontSize: 14 }}>
                <span style={{ fontWeight: 500 }}>{fieldKey}</span>
                <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>({hint})</span>
                <input
                  type="text"
                  value={schemaFields[fieldKey] ?? ''}
                  onChange={(e) => setSchemaFields((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 6, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
              </label>
            ))}
          </div>
        ) : (
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginTop: 12 }}>
            Payload (JSON object). Row context is merged after parse.
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={14}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 8,
                padding: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                boxSizing: 'border-box',
              }}
            />
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btnGhost}>
            Cancel
          </button>
          <button type="button" disabled={busy} style={btnPrimary} onClick={() => void handleSubmit()}>
            {busy ? '...' : 'Run command'}
          </button>
        </div>
      </div>
    </div>
  );
}
