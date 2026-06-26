import { memo } from 'react';
import type {
  RecurringDocumentFrequency,
  RecurringPriceIncreaseType,
  WorkEngineInvoiceRetainerSettings,
  WorkEngineInvoiceRetainerSetupAggregate,
} from '../../income/income-workspace-types';

type RetainerDocumentType = 'quote' | 'deal_invoice' | 'tax_invoice';

type RetainerFormState = {
  frequency: RecurringDocumentFrequency;
  advance_days: string;
  service_period_start: string;
  service_period_end: string;
  auto_advance_period: boolean;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | '';
  price_increase_value: string;
};

export function retainerSettingsToForm(settings: WorkEngineInvoiceRetainerSettings): RetainerFormState {
  return {
    frequency: settings.frequency,
    advance_days: String(settings.advance_days),
    service_period_start: settings.service_period_start,
    service_period_end: settings.service_period_end,
    auto_advance_period: settings.auto_advance_period,
    price_increase_enabled: settings.price_increase_enabled,
    price_increase_type: settings.price_increase_type ?? '',
    price_increase_value: settings.price_increase_value != null ? String(settings.price_increase_value) : '',
  };
}

type Props = {
  aggregate: WorkEngineInvoiceRetainerSetupAggregate;
  identity: WorkEngineInvoiceRetainerSetupAggregate['identity'];
  form: RetainerFormState;
  computedSettings: WorkEngineInvoiceRetainerSettings;
  selectedDocumentType: RetainerDocumentType;
  paymentTermsDisplay: string | null;
  busy: boolean;
  readOnly?: boolean;
  onFormChange: (patch: Partial<RetainerFormState>) => void;
  onDocumentTypeChange: (documentType: RetainerDocumentType) => void;
  onPause: () => void;
  onResume: () => void;
  onCancelProfile: () => void;
  allowedActions: string[];
};

export const WorkEngineInvoiceRetainerSettingsPanel = memo(function WorkEngineInvoiceRetainerSettingsPanel({
  aggregate,
  identity,
  form,
  computedSettings,
  selectedDocumentType,
  paymentTermsDisplay,
  busy,
  readOnly = false,
  onFormChange,
  onDocumentTypeChange,
  onPause,
  onResume,
  onCancelProfile,
  allowedActions,
}: Props) {
  const interactionLocked = busy || readOnly;
  const canPause =
    !readOnly && allowedActions.includes('pause_income_recurring_document_profile') && computedSettings.status === 'active';
  const canResume =
    !readOnly && allowedActions.includes('resume_income_recurring_document_profile') && computedSettings.status === 'paused';
  const canCancel =
    !readOnly &&
    allowedActions.includes('cancel_income_recurring_document_profile') &&
    computedSettings.status !== 'cancelled';

  return (
    <aside className="nx-we-retainer-setup__sidebar nx-we-retainer-scroll">
      {identity ? (
        <div className="nx-we-retainer-identity">
          <div className="nx-we-retainer-identity__row">{identity.office_client_label}</div>
          <div className="nx-we-retainer-identity__recipient">
            <div className="nx-we-retainer-identity__label">לקוח מקבל המסמך:</div>
            <div className="nx-we-retainer-identity__name">{computedSettings.end_customer_display_name}</div>
            {paymentTermsDisplay ? (
              <div className="nx-we-retainer-identity__payment-terms">
                תנאי תשלום: {paymentTermsDisplay}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {aggregate.scheduler_status === 'scheduler_pending' || aggregate.scheduler_status === 'failed' ? (
        <div
          className={`nx-we-retainer-scheduler-banner${
            aggregate.scheduler_status === 'failed' ? ' nx-we-retainer-scheduler-banner--failed' : ''
          }`}
        >
          {aggregate.scheduler_note}
        </div>
      ) : null}

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">סוג מסמך</h3>
        <div className="nx-we-retainer-options" role="listbox" aria-label="סוג מסמך">
          {(aggregate.document_type_options ?? []).map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`nx-we-retainer-option${
                selectedDocumentType === opt.key ? ' nx-we-retainer-option--selected' : ''
              }`}
              disabled={interactionLocked || !opt.enabled}
              title={opt.disabled_reason ?? undefined}
              onClick={() => onDocumentTypeChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="nx-we-retainer-section__help">{computedSettings.document_type_change_note}</p>
      </section>

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">תדירות</h3>
        <div className="nx-we-retainer-field">
          <label htmlFor="retainer-frequency">תדירות</label>
          <select
            id="retainer-frequency"
            value={form.frequency}
            disabled={interactionLocked}
            onChange={(e) => onFormChange({ frequency: e.target.value as RecurringDocumentFrequency })}
          >
            {(aggregate.frequency_options ?? []).map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">יצירה מראש</h3>
        <p className="nx-we-retainer-section__help">{computedSettings.advance_creation_help_text}</p>
        <div className="nx-we-retainer-field">
          <label htmlFor="retainer-advance-days">ימים לפני</label>
          <input
            id="retainer-advance-days"
            type="number"
            min={0}
            max={365}
            value={form.advance_days}
            disabled={interactionLocked}
            onChange={(e) => onFormChange({ advance_days: e.target.value })}
          />
        </div>
        {computedSettings.draft_creation_date_display ? (
          <div className="nx-we-retainer-computed">
            <span className="nx-we-retainer-computed__label">{computedSettings.draft_creation_date_label}:</span>{' '}
            {computedSettings.draft_creation_date_display}
          </div>
        ) : null}
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
              disabled={interactionLocked}
              onChange={(e) => onFormChange({ service_period_start: e.target.value })}
            />
          </div>
          <div className="nx-we-retainer-field">
            <label htmlFor="retainer-period-end">תאריך סיום</label>
            <input
              id="retainer-period-end"
              type="date"
              value={form.service_period_end}
              disabled={interactionLocked}
              onChange={(e) => onFormChange({ service_period_end: e.target.value })}
            />
          </div>
        </div>
        <label className="nx-we-retainer-checkbox">
          <input
            type="checkbox"
            checked={form.auto_advance_period}
            disabled={interactionLocked}
            onChange={(e) => onFormChange({ auto_advance_period: e.target.checked })}
          />
          <span>התקדמות אוטומטית של תקופת השירות במחזור הבא</span>
        </label>
      </section>

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">העלאת מחיר</h3>
        <label className="nx-we-retainer-checkbox">
          <input
            type="checkbox"
            checked={form.price_increase_enabled}
            disabled={interactionLocked}
            onChange={(e) => onFormChange({ price_increase_enabled: e.target.checked })}
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
                disabled={interactionLocked}
                onChange={(e) =>
                  onFormChange({ price_increase_type: e.target.value as RecurringPriceIncreaseType | '' })
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
                disabled={interactionLocked}
                onChange={(e) => onFormChange({ price_increase_value: e.target.value })}
              />
            </div>
          </div>
        ) : null}
        {computedSettings.next_cycle_unit_price_before_vat_display ? (
          <div className="nx-we-retainer-computed">
            מחיר יחידה במחזור הבא (לאחר שמירה): {computedSettings.next_cycle_unit_price_before_vat_display}
          </div>
        ) : null}
      </section>

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">סטטוס</h3>
        <span className="nx-we-retainer-status" data-status={computedSettings.status}>
          {computedSettings.status_label}
        </span>
        <p className="nx-we-retainer-status__description">{computedSettings.status_description}</p>
        <div className="nx-we-retainer-actions-row">
          {canPause ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onPause}>
              השהה ריטיינר
            </button>
          ) : null}
          {canResume ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onResume}>
              חידוש ריטיינר
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onCancelProfile}>
              ביטול ריטיינר
            </button>
          ) : null}
        </div>
      </section>
    </aside>
  );
});

export type { RetainerFormState };
