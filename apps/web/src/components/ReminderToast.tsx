import { useI18n } from '../i18n/I18nProvider';

export type ReminderToastProps = {
  open: boolean;
  clientName: string;
  title: string;
  description?: string;
  reminderTypeLabel?: string;
  reminderDateLabel?: string;
  onOpen: () => void;
  onDismiss: () => void;
  onClose: () => void;
};

export function ReminderToast({
  open,
  clientName,
  title,
  description,
  reminderTypeLabel,
  reminderDateLabel,
  onOpen: _onOpen,
  onDismiss: _onDismiss,
  onClose,
}: ReminderToastProps) {
  const { t } = useI18n();
  if (!open) return null;

  const showTypePill = !!reminderTypeLabel && reminderTypeLabel !== title;
  const closeLabel = t('clientOperations.close');

  return (
    <div className="nx-reminder-toast" role="status" aria-live="polite">
      <div className="nx-reminder-toast-inner">
        <div className="nx-reminder-toast-top">
          <div className="nx-reminder-toast-meta">
            <div className="nx-reminder-toast-label">{t('clientOperations.reminders.active')}</div>
            <div className="nx-reminder-toast-client">
              {t('clientOperations.reminders.clientPrefix')} {clientName}
            </div>
          </div>

          <button
            type="button"
            className="nx-reminder-toast-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5L15 15M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <h3 className="nx-reminder-toast-title">{title}</h3>

        {description ? (
          <div className="nx-reminder-toast-description">{description}</div>
        ) : null}

        <div className="nx-reminder-toast-info">
          {showTypePill ? (
            <span className="nx-reminder-pill">{reminderTypeLabel}</span>
          ) : null}

          {reminderDateLabel ? (
            <span className="nx-reminder-pill nx-reminder-pill-primary">{reminderDateLabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
