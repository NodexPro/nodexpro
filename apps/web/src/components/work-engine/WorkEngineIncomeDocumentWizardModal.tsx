import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  IncomeAvailableDocumentType,
  IncomeWorkspaceAggregate,
  IncomeWorkspaceContextAggregate,
  SelectIncomeIssuerContextCommandResponse,
} from '../../api/income';
import {
  WorkEngineRecipientSearchField,
  type WorkEngineRecipientSearchFieldHandle,
} from './WorkEngineRecipientSearchField';
import {
  executeIncomeCommand,
  pickDraftIdAfterSave,
} from '../../api/income';
import type { WorkEngineInvoicesDocumentCreationEntrypoint } from '../../api/work-engine';
import '../../styles/nx-modal.css';

type DraftLine = {
  description: string;
  quantity: string;
  unit_price_reference: string;
  amount_reference: string;
};

type FormState = {
  document_type: string;
  document_date: string;
  lines: DraftLine[];
  due_date: string;
  payment_received_note: string;
  notes: string;
  currency: string;
  language: string;
};

const EMPTY_LINE: DraftLine = {
  description: '',
  quantity: '1',
  unit_price_reference: '',
  amount_reference: '',
};

function recipientDraftFields(
  workspaceAgg: IncomeWorkspaceAggregate | null,
): { income_customer_id: string | null; one_time_customer_snapshot_json: Record<string, unknown> | null } {
  const selected = workspaceAgg?.recipient_search?.selected ?? null;
  if (!selected) {
    return { income_customer_id: null, one_time_customer_snapshot_json: null };
  }
  if (selected.kind === 'saved') {
    return { income_customer_id: selected.income_customer_id, one_time_customer_snapshot_json: null };
  }
  return { income_customer_id: null, one_time_customer_snapshot_json: selected.snapshot };
}

function buildDraftPayload(
  form: FormState,
  workspaceAgg: IncomeWorkspaceAggregate | null,
): Record<string, unknown> {
  const lines = form.lines
    .map((l) => {
      const amount = Number(l.amount_reference);
      const qty = Number(l.quantity);
      const unit = Number(l.unit_price_reference);
      const line: Record<string, unknown> = {};
      if (l.description.trim()) line.description = l.description.trim();
      if (Number.isFinite(qty)) line.quantity = qty;
      if (Number.isFinite(unit)) line.unit_price_reference = unit;
      if (Number.isFinite(amount)) line.amount_reference = amount;
      return line;
    })
    .filter((l) => Object.keys(l).length > 0);

  const payload: Record<string, unknown> = {
    document_type: form.document_type || null,
    document_date: form.document_date.trim() || null,
    draft_lines_json: lines,
    currency: form.currency.trim() || 'ILS',
    language: form.language.trim() || 'he',
    notes: form.notes.trim() || null,
    due_date: form.due_date.trim() || null,
    payment_terms_json: null,
    payment_received_json: form.payment_received_note.trim()
      ? { note: form.payment_received_note.trim() }
      : null,
  };

  Object.assign(payload, recipientDraftFields(workspaceAgg));

  return payload;
}

type Props = {
  open: boolean;
  busy: boolean;
  entrypoint: WorkEngineInvoicesDocumentCreationEntrypoint;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onCompleted: () => void;
};

export function WorkEngineIncomeDocumentWizardModal({
  open,
  busy,
  entrypoint,
  onClose,
  onBusyChange,
  onCompleted,
}: Props) {
  const wizard = entrypoint.wizard;
  const [stepIndex, setStepIndex] = useState(0);
  const [issuerChoice, setIssuerChoice] = useState<'self' | 'office_client' | null>(null);
  const [officeClientId, setOfficeClientId] = useState('');
  const [, setContextAgg] = useState<IncomeWorkspaceContextAggregate | null>(null);
  const [workspaceAgg, setWorkspaceAgg] = useState<IncomeWorkspaceAggregate | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recipientFieldRef = useRef<WorkEngineRecipientSearchFieldHandle>(null);
  const [form, setForm] = useState<FormState>(() => ({
    document_type: '',
    document_date: new Date().toISOString().slice(0, 10),
    lines: [{ ...EMPTY_LINE }],
    due_date: '',
    payment_received_note: '',
    notes: '',
    currency: 'ILS',
    language: 'he',
  }));

  const documentTypes: IncomeAvailableDocumentType[] =
    workspaceAgg?.available_document_types ?? [];

  const visibleSteps = useMemo(() => {
    return wizard.steps.filter((s) => {
      if (s.when === 'office_representative') return issuerChoice === 'office_client';
      return true;
    });
  }, [wizard.steps, issuerChoice]);

  const activeStepKey = visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)]?.key ?? '';
  const isLastStep = stepIndex >= visibleSteps.length - 1;

  const selectedDocType = documentTypes.find((d) => d.key === form.document_type) ?? null;
  const selectedOfficeClient =
    wizard.office_client_issuer_options.find((o) => o.represented_client_id === officeClientId) ??
    null;

  const runSelectIssuer = useCallback(async () => {
    const cmds = wizard.income_commands;
    if (issuerChoice === 'self') {
      const opt = wizard.issuer_choice.options.find((o) => o.key === 'self');
      if (!opt?.issuer_business_id) throw new Error('Missing self issuer');
      const res = (await executeIncomeCommand(cmds.select_issuer, {
        acting_mode: 'self',
        issuer_business_id: opt.issuer_business_id,
        represented_client_id: null,
      })) as SelectIncomeIssuerContextCommandResponse;
      setContextAgg(res.income_workspace_context_aggregate);
      setWorkspaceAgg(res.income_workspace_aggregate);
      return;
    }
    if (!selectedOfficeClient) throw new Error('Select office client');
    const res = (await executeIncomeCommand(cmds.select_issuer, {
      acting_mode: 'office_representative',
      issuer_business_id: selectedOfficeClient.issuer_business_id,
      represented_client_id: selectedOfficeClient.represented_client_id,
    })) as SelectIncomeIssuerContextCommandResponse;
    setContextAgg(res.income_workspace_context_aggregate);
    setWorkspaceAgg(res.income_workspace_aggregate);
  }, [issuerChoice, selectedOfficeClient, wizard]);

  const handleNext = async () => {
    setError(null);
    if (activeStepKey === 'issuer_choice') {
      if (!issuerChoice) {
        setError('בחר מנפיק');
        return;
      }
      if (issuerChoice === 'office_client') {
        setStepIndex((i) => i + 1);
        return;
      }
      onBusyChange(true);
      try {
        await runSelectIssuer();
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'office_client') {
      if (!officeClientId) {
        setError('בחר לקוח מהמשרד');
        return;
      }
      onBusyChange(true);
      try {
        await runSelectIssuer();
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'recipient') {
      onBusyChange(true);
      try {
        const refreshed = await recipientFieldRef.current?.commitPendingCreate();
        const truth = refreshed ?? workspaceAgg;
        if (refreshed) {
          setWorkspaceAgg(refreshed);
        }
        if (!truth?.recipient_search?.selected) {
          setError('בחר מקבל למסמך');
          return;
        }
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'preview_issue') return;
    setStepIndex((i) => i + 1);
  };

  const handleBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const handleSaveAndIssue = async () => {
    setError(null);
    onBusyChange(true);
    try {
      const cmds = wizard.income_commands;
      let ws = workspaceAgg;
      if (!ws?.recipient_search?.selected) {
        throw new Error('מקבל המסמך לא נבחר');
      }

      const payload = buildDraftPayload(form, ws);
      const previousIds = new Set(ws?.drafts_table_model.rows.map((r) => r.draft_id) ?? []);
      let draftId = savedDraftId;
      if (draftId) {
        await executeIncomeCommand(cmds.update_draft, { draft_id: draftId, ...payload });
      } else {
        const res = await executeIncomeCommand(cmds.create_draft, payload);
        const agg = 'income_workspace_aggregate' in res ? res.income_workspace_aggregate : ws;
        if (agg) {
          ws = agg;
          setWorkspaceAgg(agg);
          draftId = pickDraftIdAfterSave(agg, previousIds);
          if (draftId) setSavedDraftId(draftId);
        }
      }
      if (!draftId) throw new Error('טיוטה לא נשמרה');
      await executeIncomeCommand(cmds.issue_document, {
        draft_id: draftId,
        document_date: form.document_date.trim() || null,
      });
      onCompleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהפקה');
    } finally {
      onBusyChange(false);
    }
  };

  if (!open) return null;

  const renderBody = () => {
    if (activeStepKey === 'issuer_choice') {
      return (
        <div className="nx-we-wizard-issuer-grid" dir="rtl">
          {wizard.issuer_choice.options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`nx-we-wizard-issuer-btn ${issuerChoice === opt.key ? 'nx-we-wizard-issuer-btn--selected' : ''}`}
              disabled={!opt.enabled || busy}
              title={opt.disabled_reason ?? undefined}
              onClick={() => setIssuerChoice(opt.key as 'self' | 'office_client')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }
    if (activeStepKey === 'office_client') {
      return (
        <div className="nx-income-field">
          <label>{wizard.issuer_choice.title}</label>
          <select
            value={officeClientId}
            disabled={busy}
            onChange={(e) => setOfficeClientId(e.target.value)}
          >
            <option value="">בחר לקוח</option>
            {wizard.office_client_issuer_options.map((c) => (
              <option key={c.represented_client_id} value={c.represented_client_id} disabled={!c.enabled}>
                {c.label}
                {c.tax_id ? ` · ${c.tax_id}` : ''}
              </option>
            ))}
          </select>
          {selectedOfficeClient ? (
            <div className="nx-we-wizard-prefill" style={{ marginTop: 12, fontSize: 13 }}>
              <div>{selectedOfficeClient.display_name}</div>
              {selectedOfficeClient.business_type_label ? (
                <div>{selectedOfficeClient.business_type_label}</div>
              ) : null}
              {selectedOfficeClient.tax_id ? (
                <div>
                  {wizard.office_client_display_labels.tax_id_label}: {selectedOfficeClient.tax_id}
                </div>
              ) : null}
              {selectedOfficeClient.phone ? (
                <div>
                  {wizard.office_client_display_labels.phone_label}: {selectedOfficeClient.phone}
                </div>
              ) : null}
              {selectedOfficeClient.email ? (
                <div>
                  {wizard.office_client_display_labels.email_label}: {selectedOfficeClient.email}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    if (activeStepKey === 'document_type') {
      return (
        <div className="nx-income-doc-type-list">
          {documentTypes.map((dt) => (
            <button
              key={dt.key}
              type="button"
              className={`nx-income-doc-type-btn ${form.document_type === dt.key ? 'nx-income-doc-type-btn--selected' : ''}`}
              disabled={!dt.enabled || busy}
              title={dt.disabled_reason ?? dt.legal_hint ?? undefined}
              onClick={() => setForm((f) => ({ ...f, document_type: dt.key }))}
            >
              <strong>{dt.label}</strong>
              {dt.disabled_reason ? (
                <span style={{ fontSize: 12, color: '#6b7280' }}>{dt.disabled_reason}</span>
              ) : null}
            </button>
          ))}
        </div>
      );
    }
    if (activeStepKey === 'recipient') {
      return (
        <WorkEngineRecipientSearchField
          ref={recipientFieldRef}
          wizard={wizard}
          workspaceAgg={workspaceAgg}
          busy={busy}
          onWorkspaceAgg={setWorkspaceAgg}
          onError={setError}
        />
      );
    }
    if (activeStepKey === 'document_details') {
      const details = wizard.document_details_step;
      return (
        <>
          <div className="nx-income-field">
            <label>{details.document_date_label}</label>
            <input
              type="date"
              value={form.document_date}
              required={details.document_date_required}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, document_date: e.target.value }))}
            />
          </div>
          {form.lines.map((line, idx) => (
            <div key={idx} className="nx-income-line-row">
              <div className="nx-income-field">
                <label>תיאור</label>
                <input
                  value={line.description}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((f) => {
                      const lines = [...f.lines];
                      lines[idx] = { ...lines[idx], description: e.target.value };
                      return { ...f, lines };
                    })
                  }
                />
              </div>
              <div className="nx-income-field">
                <label>כמות</label>
                <input
                  value={line.quantity}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((f) => {
                      const lines = [...f.lines];
                      lines[idx] = { ...lines[idx], quantity: e.target.value };
                      return { ...f, lines };
                    })
                  }
                />
              </div>
              <div className="nx-income-field">
                <label>סכום</label>
                <input
                  value={line.amount_reference}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((f) => {
                      const lines = [...f.lines];
                      lines[idx] = { ...lines[idx], amount_reference: e.target.value };
                      return { ...f, lines };
                    })
                  }
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))}
          >
            + שורה
          </button>
          {selectedDocType?.requires_due_date ? (
            <div className="nx-income-field">
              <label>תאריך לתשלום</label>
              <input
                type="date"
                value={form.due_date}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </div>
          ) : null}
          {selectedDocType?.requires_payment_received ? (
            <div className="nx-income-field">
              <label>פרטי תשלום</label>
              <input
                value={form.payment_received_note}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, payment_received_note: e.target.value }))}
              />
            </div>
          ) : null}
          <div className="nx-income-field">
            <label>{details.notes_label}</label>
            <textarea
              value={form.notes}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </>
      );
    }
    if (activeStepKey === 'preview_issue') {
      return (
        <div style={{ fontSize: 14 }} dir="rtl">
          <p>
            <strong>סוג:</strong> {selectedDocType?.label ?? form.document_type}
          </p>
          <p>
            <strong>תאריך:</strong> {form.document_date}
          </p>
          <p>
            <strong>מקבל:</strong> {workspaceAgg?.recipient_search?.selected?.display_line ?? '—'}
          </p>
          <p style={{ color: '#6b7280', fontSize: 12 }}>
            מספר מסמך ואימות תאריך ייקבעו בהפקה בשרת בלבד.
          </p>
        </div>
      );
    }
    return null;
  };

  const stepTitle =
    visibleSteps[stepIndex]?.label ?? wizard.issuer_choice.title;

  return (
    <div className="nx-modal-overlay" role="dialog" aria-modal="true">
      <div className="nx-modal nx-accounting-editor-modal nx-we-income-wizard-modal" dir="rtl">
        <div className="nx-modal-header">
          <h2>{stepTitle}</h2>
          <button type="button" className="nx-modal-close" onClick={onClose} disabled={busy}>
            סגירה
          </button>
        </div>
        <div className="nx-modal-body">{error ? <div className="nx-we-banner-error">{error}</div> : null}{renderBody()}</div>
        <div className="nx-modal-footer nx-tax-nested-modal-footer">
          {stepIndex > 0 ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={handleBack}>
              הקודם
            </button>
          ) : null}
          {!isLastStep ? (
            <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={() => void handleNext()}>
              הבא
            </button>
          ) : (
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={busy || !form.document_type}
              onClick={() => void handleSaveAndIssue()}
            >
              הפק מסמך
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
