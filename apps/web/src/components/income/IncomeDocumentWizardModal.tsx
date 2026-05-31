import { useMemo, useState } from 'react';
import type {
  IncomeAvailableDocumentType,
  IncomeCustomersTableRow,
  IncomeDocumentCreationSchema,
  IncomeDraftsTableRow,
  IncomeItemsTableRow,
  IncomeIssuerContextSummary,
  IncomeWorkspaceAggregate,
} from '../../api/income';
import '../../styles/nx-modal.css';

export type DraftLineDraft = {
  description: string;
  quantity: string;
  unit_price_reference: string;
  amount_reference: string;
};

export type IncomeWizardDraftState = {
  document_type: string;
  customer_mode: 'existing' | 'one_time';
  income_customer_id: string;
  one_time_display_name: string;
  one_time_phone: string;
  one_time_email: string;
  one_time_tax_id: string;
  lines: DraftLineDraft[];
  due_date: string;
  payment_received_note: string;
  notes: string;
  currency: string;
  language: string;
};

const EMPTY_LINE: DraftLineDraft = {
  description: '',
  quantity: '1',
  unit_price_reference: '',
  amount_reference: '',
};

function initialWizardState(
  editing: IncomeDraftsTableRow | null,
  presetType: string | null,
): IncomeWizardDraftState {
  return {
    document_type: editing?.document_type ?? presetType ?? '',
    customer_mode: editing?.income_customer_id ? 'existing' : 'one_time',
    income_customer_id: editing?.income_customer_id ?? '',
    one_time_display_name: editing?.customer_display_name ?? '',
    one_time_phone: '',
    one_time_email: '',
    one_time_tax_id: '',
    lines: [{ ...EMPTY_LINE }],
    due_date: '',
    payment_received_note: '',
    notes: '',
    currency: 'ILS',
    language: 'he',
  };
}

function buildDraftPayload(state: IncomeWizardDraftState): Record<string, unknown> {
  const lines = state.lines
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
    document_type: state.document_type || null,
    draft_lines_json: lines,
    currency: state.currency.trim() || 'ILS',
    language: state.language.trim() || 'he',
    notes: state.notes.trim() || null,
    due_date: state.due_date.trim() || null,
    payment_terms_json: null,
    payment_received_json: state.payment_received_note.trim()
      ? { note: state.payment_received_note.trim() }
      : null,
  };

  if (state.customer_mode === 'existing' && state.income_customer_id.trim()) {
    payload.income_customer_id = state.income_customer_id.trim();
    payload.one_time_customer_snapshot_json = null;
  } else if (state.customer_mode === 'one_time' && state.one_time_display_name.trim()) {
    payload.income_customer_id = null;
    payload.one_time_customer_snapshot_json = {
      display_name: state.one_time_display_name.trim(),
      phone: state.one_time_phone.trim() || null,
      email: state.one_time_email.trim() || null,
      tax_id: state.one_time_tax_id.trim() || null,
    };
  } else {
    payload.income_customer_id = null;
    payload.one_time_customer_snapshot_json = null;
  }

  return payload;
}

type Props = {
  open: boolean;
  busy: boolean;
  workspace: IncomeWorkspaceAggregate;
  issuerContext: IncomeIssuerContextSummary;
  editingDraft: IncomeDraftsTableRow | null;
  presetDocumentType: string | null;
  customers: IncomeCustomersTableRow[];
  items: IncomeItemsTableRow[];
  schema: IncomeDocumentCreationSchema;
  documentTypes: IncomeAvailableDocumentType[];
  onClose: () => void;
  onSaveDraft: (payload: Record<string, unknown>, draftId: string | null) => Promise<string | null>;
  onIssueDraft: (draftId: string) => Promise<void>;
};

export function IncomeDocumentWizardModal({
  open,
  busy,
  workspace,
  issuerContext,
  editingDraft,
  presetDocumentType,
  customers,
  items,
  schema,
  documentTypes,
  onClose,
  onSaveDraft,
  onIssueDraft,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(editingDraft?.draft_id ?? null);
  const [form, setForm] = useState(() => initialWizardState(editingDraft, presetDocumentType));

  const steps = schema.steps;

  const selectedDocType = useMemo(
    () => documentTypes.find((d) => d.key === form.document_type) ?? null,
    [documentTypes, form.document_type],
  );

  const visibleSteps = useMemo(() => {
    return steps.filter((s) => {
      if (s.key !== 'payment') return true;
      if (!selectedDocType) return true;
      return selectedDocType.requires_payment_received || selectedDocType.requires_due_date;
    });
  }, [steps, selectedDocType]);

  const activeStepKey = visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)]?.key ?? '';
  const isLastStep = stepIndex >= visibleSteps.length - 1;

  const canCreate = schema.allowed_actions.includes('create_income_document_draft');
  const canUpdate = schema.allowed_actions.includes('update_income_document_draft');
  const canIssue = workspace.allowed_actions.includes('issue_income_document');

  if (!open) return null;

  const addLineFromItem = (item: IncomeItemsTableRow) => {
    setForm((f) => ({
      ...f,
      lines: [
        ...f.lines,
        {
          description: item.name,
          quantity: '1',
          unit_price_reference:
            item.default_unit_price_reference != null ? String(item.default_unit_price_reference) : '',
          amount_reference:
            item.default_unit_price_reference != null ? String(item.default_unit_price_reference) : '',
        },
      ],
    }));
  };

  const renderStepBody = () => {
    if (activeStepKey === 'issuer') {
      return (
        <div className="nx-income-field">
          <label>הקשר מנפיק</label>
          <p className="nx-body-text" style={{ margin: 0 }}>
            {issuerContext.issuer_label}
            {issuerContext.represented_client_label ? ` · ${issuerContext.represented_client_label}` : ''}
          </p>
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
              {dt.legal_hint ? <span className="nx-helper-text">{dt.legal_hint}</span> : null}
            </button>
          ))}
        </div>
      );
    }

    if (activeStepKey === 'customer') {
      return (
        <>
          <div className="nx-income-field">
            <label>סוג לקוח</label>
            <select
              value={form.customer_mode}
              disabled={busy}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  customer_mode: e.target.value as 'existing' | 'one_time',
                }))
              }
            >
              <option value="existing">לקוח קיים</option>
              <option value="one_time">לקוח חד-פעמי</option>
            </select>
          </div>
          {form.customer_mode === 'existing' ? (
            <div className="nx-income-field">
              <label>לקוח</label>
              <select
                value={form.income_customer_id}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, income_customer_id: e.target.value }))}
              >
                <option value="">בחר לקוח</option>
                {customers.map((c) => (
                  <option key={c.customer_id} value={c.customer_id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="nx-income-field">
                <label>שם תצוגה</label>
                <input
                  value={form.one_time_display_name}
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, one_time_display_name: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>טלפון</label>
                <input
                  value={form.one_time_phone}
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, one_time_phone: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>אימייל</label>
                <input
                  value={form.one_time_email}
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, one_time_email: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>מספר זיהוי</label>
                <input
                  value={form.one_time_tax_id}
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, one_time_tax_id: e.target.value }))}
                />
              </div>
            </>
          )}
        </>
      );
    }

    if (activeStepKey === 'lines') {
      return (
        <>
          {items.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {items.slice(0, 12).map((item) => (
                <button
                  key={item.item_id}
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => addLineFromItem(item)}
                >
                  + {item.name}
                </button>
              ))}
            </div>
          ) : null}
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
            שורה נוספת
          </button>
        </>
      );
    }

    if (activeStepKey === 'payment') {
      return (
        <>
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
              <label>פרטי תשלום שהתקבל</label>
              <textarea
                rows={3}
                value={form.payment_received_note}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, payment_received_note: e.target.value }))}
              />
            </div>
          ) : null}
        </>
      );
    }

    const payload = buildDraftPayload(form);
    return (
      <div className="nx-income-wizard-preview">
        <p className="nx-helper-text" style={{ margin: 0 }}>
          תצוגה מקדימה — הנתונים יישלחו לשרת כפי שהוזנו.
        </p>
        <pre className="nx-income-wizard-preview__code">{JSON.stringify(payload, null, 2)}</pre>
        {savedDraftId ? <p className="nx-body-text" style={{ margin: 0 }}>מזהה טיוטה: {savedDraftId}</p> : null}
      </div>
    );
  };

  const handleSaveDraft = async () => {
    const payload = buildDraftPayload(form);
    const draftId = savedDraftId ?? editingDraft?.draft_id ?? null;
    const nextId = await onSaveDraft(payload, draftId);
    if (nextId) setSavedDraftId(nextId);
  };

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui" role="dialog" aria-modal="true" aria-labelledby="income-wizard-title">
      <div className="nx-income-wizard nx-accounting-editor-modal">
        <div className="nx-income-wizard__head">
          <h2 id="income-wizard-title" className="nx-modal-title">
            {editingDraft ? 'עריכת טיוטת מסמך' : '+ מסמך'}
          </h2>
          <div className="nx-income-wizard__steps">
            {visibleSteps.map((s, i) => (
              <span
                key={s.key}
                className={`nx-income-wizard__step-pill ${
                  i === stepIndex ? 'nx-income-wizard__step-pill--active' : i < stepIndex ? 'nx-income-wizard__step-pill--done' : ''
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <div className="nx-income-wizard__body">{renderStepBody()}</div>
        <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            הקודם
          </button>
          {!isLastStep ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-primary"
              disabled={busy}
              onClick={() => setStepIndex((i) => Math.min(visibleSteps.length - 1, i + 1))}
            >
              הבא
            </button>
          ) : null}
          {(canCreate || canUpdate) && isLastStep ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-primary"
              disabled={busy}
              onClick={() => void handleSaveDraft()}
            >
              שמירת טיוטה
            </button>
          ) : null}
          {canIssue && isLastStep && savedDraftId ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-primary"
              disabled={busy}
              onClick={() => void onIssueDraft(savedDraftId)}
            >
              הפקת מסמך
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
