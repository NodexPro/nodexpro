import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IncomeDocumentDetailsLineRow,
  IncomeDocumentDetailsSelectField,
  IncomeDocumentDetailsStep,
} from '../../income/income-document-details-types';
import type { IncomeWorkspaceAggregate } from '../../income/income-workspace-types';
import { executeIncomeCommand } from '../../api/income';

type Props = {
  step: IncomeDocumentDetailsStep;
  commands: Record<string, string>;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onWorkspaceAgg: (agg: IncomeWorkspaceAggregate) => void;
  onError: (msg: string | null) => void;
};

type LineDraft = {
  description: string;
  quantity: string;
  unit_price: string;
};

function sanitizeQuantityInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

function sanitizeUnitPriceInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

function lineDraftFromRow(row: IncomeDocumentDetailsLineRow): LineDraft {
  return {
    description: row.description.value,
    quantity: row.quantity.value,
    unit_price: row.unit_price.value,
  };
}

function draftsEqual(a: LineDraft, b: LineDraft): boolean {
  return (
    a.description === b.description && a.quantity === b.quantity && a.unit_price === b.unit_price
  );
}

function DocumentSelectField({
  field,
  disabled,
  className,
  onChange,
}: {
  field: IncomeDocumentDetailsSelectField;
  disabled: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className={className}
      value={field.value}
      disabled={disabled || !field.editable}
      title={field.disabled_reason ?? undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {field.options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function LineRowEditor({
  row,
  docFields,
  busy,
  onCommit,
  onDocumentFieldChange,
  onDelete,
}: {
  row: IncomeDocumentDetailsLineRow;
  docFields: IncomeDocumentDetailsStep['line_items']['document_fields'];
  busy: boolean;
  onCommit: (lineId: string, patch: Record<string, unknown>) => void;
  onDocumentFieldChange: (key: 'currency' | 'vat_mode', value: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<LineDraft>(() => lineDraftFromRow(row));
  const focusedRef = useRef<string | null>(null);
  const lineIdRef = useRef(row.line_id);

  useEffect(() => {
    if (row.line_id !== lineIdRef.current) {
      lineIdRef.current = row.line_id;
      setDraft(lineDraftFromRow(row));
      focusedRef.current = null;
      return;
    }
    if (!focusedRef.current) {
      const serverDraft = lineDraftFromRow(row);
      setDraft((current) => (draftsEqual(current, serverDraft) ? current : serverDraft));
    }
  }, [row.line_id, row.description.value, row.quantity.value, row.unit_price.value]);

  const commitIfChanged = (patch: Record<string, unknown>, server: LineDraft) => {
    const next = { ...draft, ...patch };
    if (draftsEqual(next, server)) return;
    onCommit(row.line_id, patch);
  };

  const serverDraft = lineDraftFromRow(row);

  return (
    <>
      <td className="nx-we-doc-details__td--description">
        <input
          className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--description"
          value={draft.description}
          placeholder={row.description.placeholder}
          disabled={busy || !row.description.editable}
          onFocus={() => {
            focusedRef.current = 'description';
          }}
          onBlur={() => {
            focusedRef.current = null;
            commitIfChanged({ description: draft.description }, serverDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </td>
      <td className="nx-we-doc-details__td--quantity">
        <input
          className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--quantity"
          type="text"
          inputMode="decimal"
          value={draft.quantity}
          disabled={busy || !row.quantity.editable}
          onFocus={() => {
            focusedRef.current = 'quantity';
          }}
          onBlur={() => {
            focusedRef.current = null;
            const q = draft.quantity.trim() || '1';
            setDraft((d) => ({ ...d, quantity: q }));
            commitIfChanged({ quantity: q }, serverDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) =>
            setDraft((d) => ({ ...d, quantity: sanitizeQuantityInput(e.target.value) }))
          }
        />
      </td>
      <td className="nx-we-doc-details__td--unit_price">
        <input
          className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--unit-price"
          type="text"
          inputMode="decimal"
          value={draft.unit_price}
          disabled={busy || !row.unit_price.editable}
          onFocus={() => {
            focusedRef.current = 'unit_price';
          }}
          onBlur={() => {
            focusedRef.current = null;
            commitIfChanged(
              { unit_price_reference: draft.unit_price.trim() || null },
              serverDraft,
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) =>
            setDraft((d) => ({ ...d, unit_price: sanitizeUnitPriceInput(e.target.value) }))
          }
        />
      </td>
      <td className="nx-we-doc-details__td--currency">
        <DocumentSelectField
          field={docFields.currency}
          disabled={busy}
          className="nx-we-doc-details__cell-select"
          onChange={(v) => onDocumentFieldChange('currency', v)}
        />
      </td>
      <td className="nx-we-doc-details__td--vat">
        <DocumentSelectField
          field={docFields.vat_mode}
          disabled={busy}
          className="nx-we-doc-details__cell-select"
          onChange={(v) => onDocumentFieldChange('vat_mode', v)}
        />
      </td>
      <td className="nx-we-doc-details__td--line_total">
        <span className="nx-we-doc-details__cell-total">{row.line_total.display}</span>
      </td>
      <td className="nx-we-doc-details__td--actions">
        {row.allowed_actions.includes('delete_income_document_line') ? (
          <button
            type="button"
            className="nx-we-doc-details__delete"
            disabled={busy}
            title="מחק שורה"
            onClick={onDelete}
          >
            מחק
          </button>
        ) : null}
      </td>
    </>
  );
}

export function WorkEngineDocumentDetailsStep({
  step,
  commands,
  busy,
  onBusyChange,
  onWorkspaceAgg,
  onError,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesDraft = useRef(step.notes.value);
  const emailDraft = useRef(step.delivery_contact.email ?? '');

  const draftId = step.draft_id;
  const canAdd = step.line_items.allowed_actions.includes('add_income_document_line');
  const docFields = step.line_items.document_fields;

  const applyAggregate = useCallback(
    (res: unknown) => {
      if (res && typeof res === 'object' && 'income_workspace_aggregate' in res) {
        onWorkspaceAgg((res as { income_workspace_aggregate: IncomeWorkspaceAggregate }).income_workspace_aggregate);
      }
    },
    [onWorkspaceAgg],
  );

  const runCommand = useCallback(
    async (commandKey: string, body: Record<string, unknown>, opts?: { lockUi?: boolean }) => {
      const command = commands[commandKey];
      if (!command) throw new Error(`Missing command: ${commandKey}`);
      const lockUi = opts?.lockUi !== false;
      if (lockUi) onBusyChange(true);
      onError(null);
      try {
        const res = await executeIncomeCommand(command, body);
        applyAggregate(res);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'שגיאה');
        throw e;
      } finally {
        if (lockUi) onBusyChange(false);
      }
    },
    [applyAggregate, commands, onBusyChange, onError],
  );

  const commitLine = useCallback(
    (lineId: string, patch: Record<string, unknown>) => {
      void runCommand('update_line', { draft_id: draftId, line_id: lineId, ...patch }, { lockUi: false });
    },
    [draftId, runCommand],
  );

  const handleDocumentFieldChange = (key: 'currency' | 'vat_mode', value: string) => {
    void runCommand('update_draft_settings', {
      draft_id: draftId,
      setting_key: key,
      setting_value: value,
    });
  };

  const handleSettingChange = (key: string, value: string) => {
    void runCommand('update_draft_settings', {
      draft_id: draftId,
      setting_key: key,
      setting_value: value,
    });
  };

  const handleNotesChange = (value: string) => {
    notesDraft.current = value;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      void runCommand('update_notes', { draft_id: draftId, notes: notesDraft.current }, { lockUi: false });
    }, 500);
  };

  const handleEmailChange = (value: string) => {
    emailDraft.current = value;
    if (emailTimer.current) clearTimeout(emailTimer.current);
    emailTimer.current = setTimeout(() => {
      void runCommand(
        'update_delivery_contact',
        { draft_id: draftId, email: emailDraft.current || null },
        { lockUi: false },
      );
    }, 500);
  };

  const settingsWarnings = step.validation_warnings.filter((w) =>
    ['customer_required', 'due_date_recommended', 'payment_received_recommended'].includes(w.code),
  );

  return (
    <div className="nx-we-doc-details" dir="rtl">
      <header className="nx-we-doc-details__header">
        <h3 className="nx-we-doc-details__title">{step.header.title}</h3>
        {step.header.subtitle ? (
          <p className="nx-we-doc-details__subtitle">{step.header.subtitle}</p>
        ) : null}
      </header>

      <section className="nx-we-doc-details__settings">
        <button
          type="button"
          className="nx-we-doc-details__settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
          disabled={busy}
        >
          הגדרות מסמך {settingsOpen ? '▾' : '◂'}
        </button>
        {settingsOpen ? (
          <div className="nx-we-doc-details__settings-grid">
            {step.settings_schema
              .filter((f) => f.visible)
              .map((field) => (
                <label key={field.key} className="nx-we-doc-details__field">
                  <span>{field.label}</span>
                  {field.input_type === 'select' ? (
                    <select
                      value={field.value ?? ''}
                      disabled={busy || field.disabled}
                      title={field.disabled_reason ?? undefined}
                      onChange={(e) => handleSettingChange(field.key, e.target.value)}
                    >
                      {(field.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.input_type === 'date' ? (
                    <input
                      type="date"
                      value={field.value ?? ''}
                      required={field.required}
                      disabled={busy || field.disabled}
                      onChange={(e) => handleSettingChange(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={field.value ?? ''}
                      disabled={busy || field.disabled}
                      onChange={(e) => handleSettingChange(field.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
          </div>
        ) : null}
        {settingsWarnings.length > 0 ? (
          <ul className="nx-we-doc-details__field-errors">
            {settingsWarnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="nx-we-doc-details__lines">
        <div className="nx-we-doc-details__lines-head">
          <h4>שורות מסמך</h4>
          {canAdd ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={busy}
              onClick={() => void runCommand('add_line', { draft_id: draftId })}
            >
              {step.line_items.add_row_label}
            </button>
          ) : null}
        </div>

        {step.line_items.empty_state.visible ? (
          <p className="nx-we-doc-details__empty">{step.line_items.empty_state.message}</p>
        ) : null}

        <div className="nx-we-doc-details__table-wrap">
          <table className="nx-we-doc-details__table">
            <colgroup>
              <col className="nx-we-doc-details__col nx-we-doc-details__col--description" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--quantity" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--unit_price" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--currency" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--vat" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--line_total" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--actions" />
            </colgroup>
            <thead>
              <tr>
                {step.line_items.columns.map((col) => (
                  <th key={col.key} className={`nx-we-doc-details__th--${col.key}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {step.line_items.rows.map((row) => (
                <tr key={row.line_id}>
                  <LineRowEditor
                    row={row}
                    docFields={docFields}
                    busy={busy}
                    onCommit={commitLine}
                    onDocumentFieldChange={handleDocumentFieldChange}
                    onDelete={() =>
                      void runCommand('delete_line', { draft_id: draftId, line_id: row.line_id })
                    }
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="nx-we-doc-details__totals">
          <div className="nx-we-doc-details__total-row">
            <span>{step.line_items.totals.subtotal.label}</span>
            <strong>{step.line_items.totals.subtotal.display}</strong>
          </div>
          {step.line_items.totals.vat ? (
            <div className="nx-we-doc-details__total-row">
              <span>{step.line_items.totals.vat.label}</span>
              <strong>{step.line_items.totals.vat.display}</strong>
            </div>
          ) : null}
          <div className="nx-we-doc-details__total-row nx-we-doc-details__total-row--grand">
            <span>{step.line_items.totals.grand_total.label}</span>
            <strong>{step.line_items.totals.grand_total.display}</strong>
          </div>
        </footer>
      </section>

      <section className="nx-we-doc-details__notes">
        <label>
          <span>{step.notes.label}</span>
          <textarea
            className="nx-we-doc-details__notes-input"
            defaultValue={step.notes.value}
            key={`notes-${step.draft_id}-${step.notes.value}`}
            disabled={busy || !step.notes.editable}
            rows={3}
            onChange={(e) => handleNotesChange(e.target.value)}
          />
        </label>
      </section>

      <section className="nx-we-doc-details__delivery">
        <label>
          <span>{step.delivery_contact.label}</span>
          <input
            type="email"
            className="nx-we-doc-details__email"
            defaultValue={step.delivery_contact.email ?? ''}
            key={`email-${step.draft_id}-${step.delivery_contact.email ?? ''}`}
            disabled={busy || !step.delivery_contact.editable}
            onChange={(e) => handleEmailChange(e.target.value)}
          />
          {step.delivery_contact.hint ? (
            <small className="nx-we-doc-details__hint">{step.delivery_contact.hint}</small>
          ) : null}
        </label>
      </section>
    </div>
  );
}
