import React from 'react';
import { useI18n } from '../i18n/I18nProvider';

type NoteModalProps = {
  open: boolean;
  clientName: string;
  noteType: string;
  noteText: string;
  reminderAt: string;
  onClose: () => void;
  onSave: () => void;
  onTypeChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onReminderAtChange: (value: string) => void;
  /** Optional content above the empty-state / form (e.g. existing notes list, conflict panel). */
  children?: React.ReactNode;
};

export function ClientNoteModal({
  open,
  clientName,
  noteType,
  noteText,
  reminderAt,
  onClose,
  onSave,
  onTypeChange,
  onTextChange,
  onReminderAtChange,
  children,
}: NoteModalProps) {
  const { t } = useI18n();
  if (!open) return null;
  const notesTitle = clientName
    ? t('clientOperations.notes.titleNamed').replace('{{name}}', clientName)
    : t('clientOperations.notes.title');

  const profileLabelStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    color: '#6b7280',
    lineHeight: 1.2,
  };
  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
  };

  return (
    <div
      className="nx-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="nx-modal"
        role="dialog"
        aria-modal="true"
        aria-label={notesTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-modal-header">
          <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
            <h2 className="nx-modal-title">{t('clientOperations.notes.title')}</h2>
            <span className="nx-modal-subtitle">
              {t('clientOperations.notes.clientPrefix')} {clientName}
            </span>
          </div>
          <button
            type="button"
            className="nx-modal-close"
            onClick={onClose}
            aria-label={t('clientOperations.close')}
            title={t('clientOperations.close')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5L15 15M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="nx-modal-body">
          {children}

          {/* Fallback empty state when caller wants a simple single-note modal */}
          {!children && <div className="nx-empty-note">{t('clientOperations.noNotesYet')}</div>}

          <div className="nx-divider" />

          <div className="nx-form-grid">
            <div className="nx-modal-fields-row">
              <div className="nx-field nx-field-equal" style={{ flex: 1, minWidth: 0 }}>
                <label className="nx-field-label" htmlFor="note-type" style={profileLabelStyle}>
                  {t('clientOperations.notes.type')}
                </label>
                <div className="nx-select-wrap">
                  <select
                    id="note-type"
                    className="nx-select"
                    value={noteType}
                    onChange={(e) => onTypeChange(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="call">{t('clientOperations.notes.call')}</option>
                    <option value="note_no_date">{t('clientOperations.notes.undated')}</option>
                    <option value="reminder">{t('clientOperations.notes.reminder')}</option>
                    <option value="congratulate">{t('clientOperations.notes.greeting')}</option>
                    <option value="action">{t('clientOperations.notes.action')}</option>
                  </select>
                  <span className="nx-select-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              </div>

              <div className="nx-field nx-field-equal" style={{ flex: 1, minWidth: 0 }}>
                <label className="nx-field-label" htmlFor="note-reminder" style={profileLabelStyle}>
                  {t('clientOperations.notes.datetimeOptional')}
                </label>
                <div className="nx-datetime-wrap">
                  <input
                    id="note-reminder"
                    className="nx-datetime"
                    type="datetime-local"
                    value={reminderAt}
                    onChange={(e) => onReminderAtChange(e.target.value)}
                    style={inputStyle}
                  />
                  <span className="nx-datetime-icon nx-datetime-icon-quiet" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                      <rect
                        x="3"
                        y="4"
                        width="14"
                        height="13"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M6 2.8V5.4M14 2.8V5.4M3 8.2H17"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </div>
              </div>
            </div>

            <div className="nx-field">
              <label className="nx-field-label" htmlFor="note-text" style={profileLabelStyle}>
                {t('clientOperations.notes.text')}
              </label>
              <textarea
                id="note-text"
                className="nx-textarea nx-textarea-polish"
                placeholder={t('clientOperations.notes.placeholder')}
                value={noteText}
                onChange={(e) => onTextChange(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div className="nx-modal-footer">
            <button type="button" className="nx-btn nx-btn-primary" onClick={onSave}>
              {t('clientOperations.save')}
            </button>
            <button type="button" className="nx-btn nx-btn-secondary" onClick={onClose}>
              {t('clientOperations.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

