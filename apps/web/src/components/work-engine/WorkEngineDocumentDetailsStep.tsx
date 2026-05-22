import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type {
  IncomeDocumentDetailsLineRow,
  IncomeDocumentDetailsStep,
} from '../../income/income-document-details-types';
import type { IncomeWorkspaceAggregate } from '../../income/income-workspace-types';
import { executeIncomeCommand } from '../../api/income';
import { mergeIncomeWorkspaceWizardPatch } from '../../income/merge-wizard-workspace-aggregate';

type Props = {
  step: IncomeDocumentDetailsStep;
  commands: Record<string, string>;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  workspaceAgg: IncomeWorkspaceAggregate | null;
  onWorkspaceAgg: (agg: IncomeWorkspaceAggregate) => void;
  onError: (msg: string | null) => void;
};

type LineDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  currency: string;
  price_includes_vat: boolean;
  exchange_rate_override: string;
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
    currency: row.currency.value,
    price_includes_vat: row.price_includes_vat,
    exchange_rate_override: row.exchange_rate_override?.value ?? '',
  };
}

function buildCommitPatch(draft: LineDraft): Record<string, unknown> {
  const unitRaw = draft.unit_price.trim();
  const unitNum = unitRaw === '' ? null : Number(unitRaw);
  const patch: Record<string, unknown> = {
    description: draft.description,
    quantity: draft.quantity.trim() || '1',
    unit_price_reference: unitNum != null && Number.isFinite(unitNum) ? unitNum : null,
    currency: draft.currency,
    price_includes_vat: draft.price_includes_vat,
  };
  if (draft.currency !== 'ILS' && draft.exchange_rate_override.trim()) {
    patch.exchange_rate_to_ils_override = draft.exchange_rate_override.trim();
  }
  return patch;
}

function LineRowEditor({
  row,
  saving,
  onCommit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  row: IncomeDocumentDetailsLineRow;
  saving: boolean;
  onCommit: (lineId: string, patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onDragStart: (lineId: string) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (lineId: string) => void;
}) {
  const [draft, setDraft] = useState<LineDraft>(() => lineDraftFromRow(row));
  const lineIdRef = useRef(row.id);
  const wasSavingRef = useRef(false);

  useEffect(() => {
    if (row.id !== lineIdRef.current) {
      lineIdRef.current = row.id;
      setDraft(lineDraftFromRow(row));
      wasSavingRef.current = false;
      return;
    }
    if (wasSavingRef.current && !saving) {
      setDraft(lineDraftFromRow(row));
    }
    wasSavingRef.current = saving;
  }, [
    row.id,
    saving,
    row.description.value,
    row.quantity.value,
    row.unit_price.value,
    row.currency.value,
    row.price_includes_vat,
    row.exchange_rate_override?.value,
    row.line_total_display,
  ]);

  const disabled = saving || !row.description.editable;
  const showFx = draft.currency !== 'ILS';

  const commitDraft = () => {
    onCommit(row.id, buildCommitPatch(draft));
  };

  return (
    <>
      <td className="nx-we-doc-details__td--drag">
        {row.can_drag ? (
          <button
            type="button"
            className="nx-we-doc-details__drag"
            draggable
            disabled={disabled}
            title="גרור לשינוי סדר"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              onDragStart(row.id);
            }}
            onDragOver={onDragOver}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(row.id);
            }}
          >
            ⋮⋮
          </button>
        ) : (
          <span className="nx-we-doc-details__drag-placeholder" aria-hidden />
        )}
      </td>
      <td className="nx-we-doc-details__td--row_number">
        <span className="nx-we-doc-details__row-num">{row.row_number}</span>
      </td>
      <td className="nx-we-doc-details__td--description">
        <input
          className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--description"
          value={draft.description}
          placeholder={row.description.placeholder}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
        {showFx ? (
          <div className="nx-we-doc-details__fx-row">
            <span className="nx-we-doc-details__fx-label">
              שער יציג להיום: {row.exchange_rate_default}
            </span>
            <label className="nx-we-doc-details__fx-override">
              <span>שער מותאם</span>
              <input
                type="text"
                inputMode="decimal"
                className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--fx"
                value={draft.exchange_rate_override}
                disabled={disabled || !row.exchange_rate_editable}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    exchange_rate_override: sanitizeUnitPriceInput(e.target.value),
                  }))
                }
              />
            </label>
          </div>
        ) : null}
      </td>
      <td className="nx-we-doc-details__td--quantity">
        <input
          className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--quantity"
          type="text"
          inputMode="decimal"
          value={draft.quantity}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
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
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          onChange={(e) =>
            setDraft((d) => ({ ...d, unit_price: sanitizeUnitPriceInput(e.target.value) }))
          }
        />
      </td>
      <td className="nx-we-doc-details__td--currency">
        <select
          className="nx-we-doc-details__cell-select nx-we-doc-details__cell-select--currency"
          value={draft.currency}
          disabled={disabled || !row.currency.editable}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              currency: e.target.value,
              exchange_rate_override: e.target.value === 'ILS' ? '' : d.exchange_rate_override,
            }))
          }
        >
          {row.currency.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <td className="nx-we-doc-details__td--vat">
        <select
          className="nx-we-doc-details__cell-select nx-we-doc-details__cell-select--vat-mode"
          value={draft.price_includes_vat ? 'true' : 'false'}
          disabled={disabled || row.vat_rate_code === 'exempt'}
          title="כולל מע״מ / לפני מע״מ"
          onChange={(e) =>
            setDraft((d) => ({ ...d, price_includes_vat: e.target.value === 'true' }))
          }
        >
          {row.price_mode_options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <td className="nx-we-doc-details__td--confirm">
        {row.allowed_actions.includes('update_income_document_line') ? (
          <button
            type="button"
            className="nx-we-doc-details__confirm"
            disabled={disabled}
            title="שמור שורה"
            onClick={() => commitDraft()}
          >
            {saving ? '…' : '✓'}
          </button>
        ) : null}
      </td>
      <td className="nx-we-doc-details__td--line_total">
        <span className="nx-we-doc-details__cell-total">{row.line_total_display}</span>
      </td>
      <td className="nx-we-doc-details__td--delete">
        {row.allowed_actions.includes('delete_income_document_line') ? (
          <button
            type="button"
            className="nx-we-doc-details__delete"
            disabled={disabled}
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
  workspaceAgg,
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
  const [addingLine, setAddingLine] = useState(false);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const dragLineIdRef = useRef<string | null>(null);
  const commandsInFlight = useRef(0);

  const applyAggregate = useCallback(
    (res: unknown) => {
      if (!res || typeof res !== 'object' || !('income_workspace_aggregate' in res)) return;
      const payload = res as {
        income_workspace_aggregate: IncomeWorkspaceAggregate;
        meta?: { workspace_aggregate_mode?: 'full' | 'wizard_patch' };
      };
      const next = payload.income_workspace_aggregate;
      if (payload.meta?.workspace_aggregate_mode === 'wizard_patch') {
        onWorkspaceAgg(mergeIncomeWorkspaceWizardPatch(workspaceAgg, next));
        return;
      }
      onWorkspaceAgg(next);
    },
    [onWorkspaceAgg, workspaceAgg],
  );

  const runCommand = useCallback(
    async (commandKey: string, body: Record<string, unknown>, opts?: { lockUi?: boolean }) => {
      const command = commands[commandKey];
      if (!command) throw new Error(`Missing command: ${commandKey}`);
      const lockUi = opts?.lockUi !== false;
      commandsInFlight.current += 1;
      if (lockUi) onBusyChange(true);
      onError(null);
      try {
        const res = await executeIncomeCommand(command, body);
        applyAggregate(res);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'שגיאה');
        throw e;
      } finally {
        commandsInFlight.current = Math.max(0, commandsInFlight.current - 1);
        if (lockUi) onBusyChange(false);
      }
    },
    [applyAggregate, commands, onBusyChange, onError],
  );

  const commitLine = useCallback(
    async (lineId: string, patch: Record<string, unknown>) => {
      setSavingLineId(lineId);
      try {
        await runCommand('update_line', { draft_id: draftId, line_id: lineId, ...patch }, { lockUi: false });
      } finally {
        setSavingLineId((current) => (current === lineId ? null : current));
      }
    },
    [draftId, runCommand],
  );

  const handleReorder = useCallback(
    (targetLineId: string) => {
      const fromId = dragLineIdRef.current;
      dragLineIdRef.current = null;
      if (!fromId || fromId === targetLineId) return;
      const ids = step.line_items.rows.map((r) => r.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(targetLineId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...ids];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, fromId);
      void runCommand(
        'reorder_lines',
        { draft_id: draftId, ordered_line_ids: next },
        { lockUi: false },
      );
    },
    [draftId, runCommand, step.line_items.rows],
  );

  const handleAddLine = async () => {
    if (addingLine) return;
    setAddingLine(true);
    try {
      await runCommand('add_line', { draft_id: draftId }, { lockUi: false });
    } finally {
      setAddingLine(false);
    }
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
              disabled={busy || addingLine}
              onClick={() => void handleAddLine()}
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
              <col className="nx-we-doc-details__col nx-we-doc-details__col--drag" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--row_number" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--description" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--quantity" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--unit_price" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--currency" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--vat" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--confirm" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--line_total" />
              <col className="nx-we-doc-details__col nx-we-doc-details__col--delete" />
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
                <tr key={row.id} className={savingLineId === row.id ? 'nx-we-doc-details__row--saving' : ''}>
                  <LineRowEditor
                    row={row}
                    saving={savingLineId === row.id}
                    onCommit={(lineId, patch) => void commitLine(lineId, patch)}
                    onDelete={() =>
                      void runCommand(
                        'delete_line',
                        { draft_id: draftId, line_id: row.id },
                        { lockUi: false },
                      )
                    }
                    onDragStart={(lineId) => {
                      dragLineIdRef.current = lineId;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleReorder}
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
