import { useCallback, useRef, useState } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
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

export function WorkEngineDocumentDetailsStep({
  step,
  commands,
  busy,
  onBusyChange,
  onWorkspaceAgg,
  onError,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [dragLineId, setDragLineId] = useState<string | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const draftId = step.draft_id;
  const canAdd = step.line_items.allowed_actions.includes('add_income_document_line');

  const runCommand = useCallback(
    async (commandKey: string, body: Record<string, unknown>) => {
      const command = commands[commandKey];
      if (!command) throw new Error(`Missing command: ${commandKey}`);
      onBusyChange(true);
      onError(null);
      try {
        const res = await executeIncomeCommand(command, body);
        if ('income_workspace_aggregate' in res) {
          onWorkspaceAgg(res.income_workspace_aggregate);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : 'שגיאה');
        throw e;
      } finally {
        onBusyChange(false);
      }
    },
    [commands, onBusyChange, onError, onWorkspaceAgg],
  );

  const scheduleLineUpdate = (lineId: string, patch: Record<string, unknown>) => {
    if (lineTimers.current[lineId]) clearTimeout(lineTimers.current[lineId]);
    lineTimers.current[lineId] = setTimeout(() => {
      void runCommand('update_line', { draft_id: draftId, line_id: lineId, ...patch });
    }, 400);
  };

  const handleSettingChange = (key: string, value: string) => {
    void runCommand('update_draft_settings', {
      draft_id: draftId,
      setting_key: key,
      setting_value: value,
    });
  };

  const handleNotesChange = (value: string) => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      void runCommand('update_notes', { draft_id: draftId, notes: value });
    }, 450);
  };

  const handleEmailChange = (value: string) => {
    if (emailTimer.current) clearTimeout(emailTimer.current);
    emailTimer.current = setTimeout(() => {
      void runCommand('update_delivery_contact', { draft_id: draftId, email: value || null });
    }, 450);
  };

  const handleReorder = async (targetLineId: string) => {
    if (!dragLineId || dragLineId === targetLineId) return;
    const ids = step.line_items.rows.map((r) => r.line_id);
    const from = ids.indexOf(dragLineId);
    const to = ids.indexOf(targetLineId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragLineId);
    setDragLineId(null);
    await runCommand('reorder_lines', { draft_id: draftId, ordered_line_ids: next });
  };

  return (
    <div className="nx-we-doc-details" dir="rtl">
      <header className="nx-we-doc-details__header">
        <h3 className="nx-we-doc-details__title">{step.header.title}</h3>
        {step.header.subtitle ? (
          <p className="nx-we-doc-details__subtitle">{step.header.subtitle}</p>
        ) : null}
        {step.header.document_number_preview ? (
          <p className="nx-we-doc-details__number-preview">
            מספר צפוי: <strong>{step.header.document_number_preview}</strong>
          </p>
        ) : null}
      </header>

      {step.validation_warnings.length > 0 ? (
        <ul className="nx-we-doc-details__warnings">
          {step.validation_warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      ) : null}

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
            <thead>
              <tr>
                {step.line_items.columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {step.line_items.rows.map((row) => (
                <tr
                  key={row.line_id}
                  draggable={!busy && step.line_items.allowed_actions.includes('reorder_income_document_lines')}
                  onDragStart={() => setDragLineId(row.line_id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => void handleReorder(row.line_id)}
                  className={dragLineId === row.line_id ? 'nx-we-doc-details__row--drag' : ''}
                >
                  <td className="nx-we-doc-details__cell-num">
                    <span className="nx-we-doc-details__drag" aria-hidden>
                      ⋮⋮
                    </span>
                    {row.row_number}
                  </td>
                  <td>
                    <input
                      className="nx-we-doc-details__cell-input"
                      value={row.description.value}
                      disabled={busy || !row.description.editable}
                      onChange={(e) =>
                        scheduleLineUpdate(row.line_id, { description: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--narrow"
                      value={row.quantity.value}
                      disabled={busy || !row.quantity.editable}
                      onChange={(e) => scheduleLineUpdate(row.line_id, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="nx-we-doc-details__cell-input nx-we-doc-details__cell-input--narrow"
                      value={row.unit_price.value}
                      disabled={busy || !row.unit_price.editable}
                      onChange={(e) =>
                        scheduleLineUpdate(row.line_id, { unit_price_reference: e.target.value })
                      }
                    />
                  </td>
                  <td className="nx-we-doc-details__cell-muted">{row.vat.label}</td>
                  <td className="nx-we-doc-details__cell-total">{row.line_total.display}</td>
                  <td>
                    {row.allowed_actions.includes('delete_income_document_line') ? (
                      <button
                        type="button"
                        className="nx-we-doc-details__delete"
                        disabled={busy}
                        onClick={() =>
                          void runCommand('delete_line', { draft_id: draftId, line_id: row.line_id })
                        }
                      >
                        מחק
                      </button>
                    ) : null}
                  </td>
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
            value={step.notes.value}
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
            value={step.delivery_contact.email ?? ''}
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
