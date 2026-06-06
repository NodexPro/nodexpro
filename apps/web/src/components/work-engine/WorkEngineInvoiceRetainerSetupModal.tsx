import { useEffect, useMemo, useState } from 'react';
import type {
  RecurringDocumentFrequency,
  RecurringPriceIncreaseType,
  WorkEngineInvoiceRetainerProfileForm,
  WorkEngineInvoiceRetainerSetupAggregate,
} from '../../income/income-workspace-types';
import { executeWorkEngineInvoiceRetainerCommand } from '../../api/work-engine';

type Props = {
  open: boolean;
  aggregate: WorkEngineInvoiceRetainerSetupAggregate | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSaved: (aggregate: WorkEngineInvoiceRetainerSetupAggregate, invoicesTabAggregate?: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};

type FormState = {
  document_type: string;
  frequency: RecurringDocumentFrequency;
  next_document_date: string;
  advance_days: string;
  service_period_start: string;
  service_period_end: string;
  auto_advance_period: boolean;
  line_description_template: string;
  quantity: string;
  unit_price_before_vat_reference: string;
  currency: string;
  discount_percent_reference: string;
  discount_amount_reference: string;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | '';
  price_increase_value: string;
  status: string;
};

function profileToForm(profile: WorkEngineInvoiceRetainerProfileForm): FormState {
  return {
    document_type: profile.document_type,
    frequency: profile.frequency,
    next_document_date: profile.next_document_date,
    advance_days: String(profile.advance_days),
    service_period_start: profile.service_period_start,
    service_period_end: profile.service_period_end,
    auto_advance_period: profile.auto_advance_period,
    line_description_template: profile.line_description_template,
    quantity: String(profile.quantity),
    unit_price_before_vat_reference: String(profile.unit_price_before_vat_reference),
    currency: profile.currency,
    discount_percent_reference:
      profile.discount_percent_reference != null ? String(profile.discount_percent_reference) : '',
    discount_amount_reference:
      profile.discount_amount_reference != null ? String(profile.discount_amount_reference) : '',
    price_increase_enabled: profile.price_increase_enabled,
    price_increase_type: profile.price_increase_type ?? '',
    price_increase_value: profile.price_increase_value != null ? String(profile.price_increase_value) : '',
    status: profile.status,
  };
}

function buildCommandPayload(
  representedClientId: string,
  profileId: string | null,
  endCustomerId: string,
  form: FormState,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    represented_client_id: representedClientId,
    end_customer_id: endCustomerId,
    document_type: form.document_type,
    frequency: form.frequency,
    next_document_date: form.next_document_date,
    advance_days: Number(form.advance_days),
    service_period_start: form.service_period_start,
    service_period_end: form.service_period_end,
    auto_advance_period: form.auto_advance_period,
    line_description_template: form.line_description_template.trim(),
    quantity: Number(form.quantity),
    unit_price_before_vat_reference: Number(form.unit_price_before_vat_reference),
    currency: form.currency.trim() || 'ILS',
    price_increase_enabled: form.price_increase_enabled,
  };
  if (profileId) payload.profile_id = profileId;
  if (form.discount_percent_reference.trim()) {
    payload.discount_percent_reference = Number(form.discount_percent_reference);
  }
  if (form.discount_amount_reference.trim()) {
    payload.discount_amount_reference = Number(form.discount_amount_reference);
  }
  if (form.price_increase_enabled) {
    payload.price_increase_type = form.price_increase_type;
    payload.price_increase_value = Number(form.price_increase_value);
  }
  return payload;
}

export function WorkEngineInvoiceRetainerSetupModal({
  open,
  aggregate,
  busy,
  onBusyChange,
  onClose,
  onSaved,
  onError,
}: Props) {
  const profile = aggregate?.profile ?? null;
  const [form, setForm] = useState<FormState | null>(null);
  const [computedProfile, setComputedProfile] = useState<WorkEngineInvoiceRetainerProfileForm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !profile) {
      setForm(null);
      setComputedProfile(null);
      return;
    }
    setForm(profileToForm(profile));
    setComputedProfile(profile);
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open, submitting]);

  const allowed = aggregate?.allowed_actions ?? [];
  const isCreate = !profile?.profile_id;
  const canSave = isCreate
    ? allowed.includes('create_income_recurring_document_profile')
    : allowed.includes('update_income_recurring_document_profile');
  const canPause = allowed.includes('pause_income_recurring_document_profile') && profile?.status === 'active';
  const canResume = allowed.includes('resume_income_recurring_document_profile') && profile?.status === 'paused';
  const canCancel = allowed.includes('cancel_income_recurring_document_profile') && profile?.status !== 'cancelled';

  const documentTypeOptions = useMemo(
    () => (aggregate?.document_type_options ?? []).filter((o) => o.enabled),
    [aggregate?.document_type_options],
  );

  const runCommand = async (command: string, extra: Record<string, unknown> = {}) => {
    if (!aggregate || !profile || !form) return;
    setSubmitting(true);
    onBusyChange?.(true);
    try {
      const payload = {
        ...buildCommandPayload(
          aggregate.represented_client_id,
          profile.profile_id,
          profile.end_customer_id,
          form,
        ),
        ...extra,
      };
      const res = await executeWorkEngineInvoiceRetainerCommand(command, payload);
      setComputedProfile(res.work_engine_invoice_retainer_setup_aggregate.profile);
      if (res.work_engine_invoice_retainer_setup_aggregate.profile) {
        setForm(profileToForm(res.work_engine_invoice_retainer_setup_aggregate.profile));
      }
      onSaved(
        res.work_engine_invoice_retainer_setup_aggregate,
        res.work_engine_invoices_tab_aggregate,
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  if (!open || !aggregate || !profile || !form) return null;

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  return (
    <div
      className="nx-we-retainer-overlay nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-setup-title"
      onClick={() => {
        if (!busy && !submitting) onClose();
      }}
    >
      <div
        className="nx-we-retainer-modal nx-we-retainer-modal--setup"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-we-retainer-modal__head">
          <div className="nx-we-retainer-modal__head-text">
            <h2 id="we-retainer-setup-title" className="nx-we-retainer-modal__title">
              ריטיינר חשבוניות
            </h2>
            <p className="nx-we-retainer-modal__subtitle">הגדרת מסמך חוזר ללקוח</p>
          </div>
          <button
            type="button"
            className="nx-we-retainer-modal__close"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="nx-we-retainer-modal__body">
          <div className="nx-we-retainer-chips">
            <span className="nx-we-retainer-chip">לקוח משרד: {aggregate.client_display_name}</span>
            <span className="nx-we-retainer-chip">לקוח: {profile.end_customer_display_name}</span>
          </div>

          {aggregate.scheduler_status === 'scheduler_pending' ? (
            <div className="nx-we-retainer-scheduler-banner">{aggregate.scheduler_note}</div>
          ) : null}

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">סוג מסמך</h3>
            <div className="nx-we-retainer-options" role="listbox" aria-label="סוג מסמך">
              {documentTypeOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`nx-we-retainer-option${
                    form.document_type === opt.key ? ' nx-we-retainer-option--selected' : ''
                  }`}
                  disabled={busy || submitting}
                  onClick={() => updateForm('document_type', opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">תדירות</h3>
            <div className="nx-we-retainer-options" role="listbox" aria-label="תדירות">
              {(aggregate.frequency_options ?? []).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`nx-we-retainer-option${
                    form.frequency === opt.key ? ' nx-we-retainer-option--selected' : ''
                  }`}
                  disabled={busy || submitting}
                  onClick={() => updateForm('frequency', opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">תאריך הפקה</h3>
            <div className="nx-we-retainer-field-grid">
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-next-date">תאריך מסמך הבא</label>
                <input
                  id="retainer-next-date"
                  type="date"
                  value={form.next_document_date}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('next_document_date', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-advance-days">יצירה מראש (ימים)</label>
                <input
                  id="retainer-advance-days"
                  type="number"
                  min={0}
                  max={365}
                  value={form.advance_days}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('advance_days', e.target.value)}
                />
              </div>
            </div>
            {computedProfile ? (
              <div className="nx-we-retainer-computed">
                תאריך יצירת טיוטה משוער (לאחר שמירה): {computedProfile.draft_creation_date_display}
              </div>
            ) : null}
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">פרטי שירות / שורה במסמך</h3>
            <div className="nx-we-retainer-field-grid">
              <div className="nx-we-retainer-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="retainer-line-desc">תיאור</label>
                <textarea
                  id="retainer-line-desc"
                  value={form.line_description_template}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('line_description_template', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-qty">כמות</label>
                <input
                  id="retainer-qty"
                  type="number"
                  min={0}
                  step="any"
                  value={form.quantity}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('quantity', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-unit-price">מחיר יחידה לפני מע״מ</label>
                <input
                  id="retainer-unit-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.unit_price_before_vat_reference}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('unit_price_before_vat_reference', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-currency">מטבע</label>
                <input
                  id="retainer-currency"
                  value={form.currency}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('currency', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-discount-pct">הנחה (%)</label>
                <input
                  id="retainer-discount-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={form.discount_percent_reference}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('discount_percent_reference', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-discount-amt">הנחה (סכום)</label>
                <input
                  id="retainer-discount-amt"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.discount_amount_reference}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('discount_amount_reference', e.target.value)}
                />
              </div>
            </div>
            <p className="nx-we-retainer-note" style={{ marginTop: 10 }}>
              {computedProfile?.unit_price_before_vat_display
                ? `מחיר נוכחי: ${computedProfile.unit_price_before_vat_display}`
                : null}
            </p>
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">תקופת שירות</h3>
            <div className="nx-we-retainer-field-grid">
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-period-start">תאריך התחלה</label>
                <input
                  id="retainer-period-start"
                  type="date"
                  value={form.service_period_start}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('service_period_start', e.target.value)}
                />
              </div>
              <div className="nx-we-retainer-field">
                <label htmlFor="retainer-period-end">תאריך סיום</label>
                <input
                  id="retainer-period-end"
                  type="date"
                  value={form.service_period_end}
                  disabled={busy || submitting}
                  onChange={(e) => updateForm('service_period_end', e.target.value)}
                />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={form.auto_advance_period}
                disabled={busy || submitting}
                onChange={(e) => updateForm('auto_advance_period', e.target.checked)}
              />
              <span>התקדמות אוטומטית של תקופת השירות במחזור הבא</span>
            </label>
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">העלאת מחיר אוטומטית</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={form.price_increase_enabled}
                disabled={busy || submitting}
                onChange={(e) => updateForm('price_increase_enabled', e.target.checked)}
              />
              <span>הגדלת מחיר בכל מחזור</span>
            </label>
            {form.price_increase_enabled ? (
              <div className="nx-we-retainer-field-grid">
                <div className="nx-we-retainer-field">
                  <label htmlFor="retainer-increase-type">סוג העלאה</label>
                  <select
                    id="retainer-increase-type"
                    value={form.price_increase_type}
                    disabled={busy || submitting}
                    onChange={(e) =>
                      updateForm('price_increase_type', e.target.value as RecurringPriceIncreaseType | '')
                    }
                  >
                    <option value="">—</option>
                    <option value="percent">אחוזים</option>
                    <option value="amount">סכום קבוע</option>
                  </select>
                </div>
                <div className="nx-we-retainer-field">
                  <label htmlFor="retainer-increase-value">ערך</label>
                  <input
                    id="retainer-increase-value"
                    type="number"
                    min={0}
                    step="any"
                    value={form.price_increase_value}
                    disabled={busy || submitting}
                    onChange={(e) => updateForm('price_increase_value', e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            {computedProfile?.next_cycle_unit_price_before_vat_display ? (
              <div className="nx-we-retainer-computed">
                מחיר יחידה במחזור הבא (לאחר שמירה): {computedProfile.next_cycle_unit_price_before_vat_display}
              </div>
            ) : null}
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">מע״מ</h3>
            <p className="nx-we-retainer-note">{computedProfile?.vat_note ?? profile.vat_note}</p>
          </section>

          <section className="nx-we-retainer-section">
            <h3 className="nx-we-retainer-section__title">סטטוס</h3>
            <span className="nx-we-retainer-status" data-status={computedProfile?.status ?? profile.status}>
              {computedProfile?.status_label ?? profile.status_label}
            </span>
            <div className="nx-we-retainer-actions-row">
              {canPause ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || submitting}
                  onClick={() => void runCommand('pause_income_recurring_document_profile')}
                >
                  השהה
                </button>
              ) : null}
              {canResume ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || submitting}
                  onClick={() => void runCommand('resume_income_recurring_document_profile')}
                >
                  חידוש
                </button>
              ) : null}
              {canCancel ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || submitting}
                  onClick={() => void runCommand('cancel_income_recurring_document_profile')}
                >
                  ביטול ריטיינר
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <div className="nx-we-retainer-modal__footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || submitting}
            onClick={onClose}
          >
            ביטול
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy || submitting || !canSave}
            onClick={() =>
              void runCommand(
                isCreate
                  ? 'create_income_recurring_document_profile'
                  : 'update_income_recurring_document_profile',
              )
            }
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}
