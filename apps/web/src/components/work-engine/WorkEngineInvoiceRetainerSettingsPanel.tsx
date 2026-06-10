import type {
  RecurringDocumentFrequency,
  RecurringPriceIncreaseType,
  WorkEngineInvoiceRetainerSettings,
  WorkEngineInvoiceRetainerSetupAggregate,
} from '../../income/income-workspace-types';

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
  settings: WorkEngineInvoiceRetainerSettings;
  form: RetainerFormState;
  computedSettings: WorkEngineInvoiceRetainerSettings;
  busy: boolean;
  onFormChange: (patch: Partial<RetainerFormState>) => void;
  onPause: () => void;
  onResume: () => void;
  onCancelProfile: () => void;
  allowedActions: string[];
};

export function WorkEngineInvoiceRetainerSettingsPanel({
  aggregate,
  settings,
  form,
  computedSettings,
  busy,
  onFormChange,
  onPause,
  onResume,
  onCancelProfile,
  allowedActions,
}: Props) {
  const canPause = allowedActions.includes('pause_income_recurring_document_profile') && settings.status === 'active';
  const canResume = allowedActions.includes('resume_income_recurring_document_profile') && settings.status === 'paused';
  const canCancel = allowedActions.includes('cancel_income_recurring_document_profile') && settings.status !== 'cancelled';

  return (
    <aside className="nx-we-retainer-setup__sidebar">
      <div className="nx-we-retainer-chips">
        <span className="nx-we-retainer-chip">לקוח משרד: {aggregate.client_display_name}</span>
        <span className="nx-we-retainer-chip">לקוח: {settings.end_customer_display_name}</span>
      </div>

      {aggregate.scheduler_status === 'scheduler_pending' ? (
        <div className="nx-we-retainer-scheduler-banner">{aggregate.scheduler_note}</div>
      ) : null}

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
              disabled={busy}
              onClick={() => onFormChange({ frequency: opt.key })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="nx-we-retainer-section">
        <h3 className="nx-we-retainer-section__title">יצירה מראש</h3>
        <div className="nx-we-retainer-field">
          <label htmlFor="retainer-advance-days">ימים לפני תאריך המסמך</label>
          <input
            id="retainer-advance-days"
            type="number"
            min={0}
            max={365}
            value={form.advance_days}
            disabled={busy}
            onChange={(e) => onFormChange({ advance_days: e.target.value })}
          />
        </div>
        {computedSettings.draft_creation_date_display ? (
          <div className="nx-we-retainer-computed">
            תאריך יצירת טיוטה משוער: {computedSettings.draft_creation_date_display}
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
              disabled={busy}
              onChange={(e) => onFormChange({ service_period_start: e.target.value })}
            />
          </div>
          <div className="nx-we-retainer-field">
            <label htmlFor="retainer-period-end">תאריך סיום</label>
            <input
              id="retainer-period-end"
              type="date"
              value={form.service_period_end}
              disabled={busy}
              onChange={(e) => onFormChange({ service_period_end: e.target.value })}
            />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={form.auto_advance_period}
            disabled={busy}
            onChange={(e) => onFormChange({ auto_advance_period: e.target.checked })}
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
            disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
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
        <div className="nx-we-retainer-actions-row">
          {canPause ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onPause}>
              השהה
            </button>
          ) : null}
          {canResume ? (
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onResume}>
              חידוש
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
}

export type { RetainerFormState };
