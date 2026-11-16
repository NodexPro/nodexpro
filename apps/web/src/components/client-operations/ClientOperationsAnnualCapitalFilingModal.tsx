import { useRef } from 'react';
import { ClientOperationsFilingDateField } from './ClientOperationsFilingDateField';
import { formatOperationalDateLabel } from '../../lib/client-operations-filing-date-field.pure';
import type {
  ClientOperationsAnnualCapitalLinkedFile,
  ClientOperationsAnnualReportFiling,
  ClientOperationsCapitalDeclarationFiling,
  ClientOperationsRegistryRow,
} from './ClientOperationsRegistryView';

function PaperclipGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M16.5 6.5v9.2a4.5 4.5 0 1 1-9 0V6.8a3 3 0 0 1 6 0v8.2a1.5 1.5 0 0 1-3 0V7.2h-1.5v7.8a3 3 0 0 0 6 0V6.8a4.5 4.5 0 0 0-9 0v8.9a6 6 0 0 0 12 0V6.5h-1.5Z"
      />
    </svg>
  );
}

export type AnnualCapitalPendingFile = {
  kind: 'form_1301' | 'additional';
  file_name: string;
  file_base64: string;
  mime_type: string | null;
};

export type AnnualCapitalFilingModalState = {
  kind: 'annual_report' | 'capital_declaration';
  clientId: string;
  taxYear: number;
  submittedOn: string;
  confirmOtherTaxYear: boolean;
  pendingFiles: AnnualCapitalPendingFile[];
};

function openPendingPreview(file: AnnualCapitalPendingFile): void {
  const binary = atob(file.file_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: file.mime_type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
}

export function ClientOperationsAnnualCapitalFilingModal(props: {
  state: AnnualCapitalFilingModalState;
  liveRow: ClientOperationsRegistryRow;
  lang: string;
  t: (key: string) => string;
  canSubmit: boolean;
  pending: boolean;
  feedback: { tone: 'ok' | 'err'; text: string } | null;
  onClose: () => void;
  onSubmit: () => void;
  onStateChange: (patch: Partial<AnnualCapitalFilingModalState>) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePendingFile: (index: number) => void;
  onOpenLinkedFile: (file: ClientOperationsAnnualCapitalLinkedFile) => void;
}) {
  const {
    state,
    liveRow,
    lang,
    t,
    canSubmit,
    pending,
    feedback,
    onClose,
    onSubmit,
    onStateChange,
    onAddFiles,
    onRemovePendingFile,
    onOpenLinkedFile,
  } = props;
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const isAnnual = state.kind === 'annual_report';
  const annualFiling = liveRow.annual_report_cell?.filing;
  const capitalFiling = liveRow.capital_declaration_cell?.filing;
  const filing: ClientOperationsAnnualReportFiling | ClientOperationsCapitalDeclarationFiling | undefined = isAnnual
    ? annualFiling
    : capitalFiling;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  if (!filing) return null;
  const otherYear = isAnnual && annualFiling ? state.taxYear !== annualFiling.tab_tax_year : false;
  const existingFiles = filing.modal.files;
  const targetDate = isAnnual
    ? liveRow.annual_report_cell?.operational_target_date ?? null
    : capitalFiling?.modal.operational_target_date ?? null;
  const dueDateLabel = isAnnual
    ? t('clientOperations.registry.reporting.annualCapital.dueDate')
    : t(capitalFiling?.modal.due_date_label_key ?? 'clientOperations.registry.reporting.annualCapital.dueDate');

  return (
    <div className="nx-clients-overlay nx-co-ni-overlay">
      <div
        className="nx-glass-card nx-clients-modal nx-co-ops-modal nx-co-ni-modal nx-co-filing-modal nx-co-annual-capital-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-co-annual-capital-title"
        dir={dir}
        data-testid="client-operations-annual-capital-modal"
      >
        <div className="nx-clients-modal__head">
          <h3 id="nx-co-annual-capital-title">{t(filing.modal.title_key)}</h3>
          <button
            type="button"
            className="nx-co-annual-capital-modal__clip"
            disabled={!canSubmit}
            aria-label={t('clientOperations.annual.attachFile')}
            data-testid="client-operations-annual-capital-paperclip"
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipGlyph />
          </button>
          <button
            type="button"
            onClick={() => !pending && onClose()}
            className="nx-clients-modal__close"
            aria-label={t(filing.modal.cancel_key)}
            disabled={pending}
          >
            ×
          </button>
        </div>
        <form
          className="nx-clients-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          noValidate
        >
          <div className="nx-clients-form__body nx-co-ni-modal__body nx-co-annual-capital-modal__body">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              disabled={!canSubmit}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (files.length) onAddFiles(files);
              }}
            />
            <div className="nx-co-annual-capital-modal__layout">
              <section className="nx-co-annual-capital-modal__identity">
                <div className="nx-co-annual-capital-modal__fact">
                  <span>{t(filing.modal.client_label_key)}</span>
                  <strong>{liveRow.client_name ?? liveRow.client_id}</strong>
                </div>
                <div className="nx-co-annual-capital-modal__fact">
                  <span>{dueDateLabel}</span>
                  <strong>{formatOperationalDateLabel(targetDate, lang)}</strong>
                </div>
                {isAnnual && annualFiling ? (
                  <label className="nx-co-annual-capital-modal__fact">
                    <span>{t(annualFiling.modal.tax_year_label_key)}</span>
                    <select
                      className="nx-co-annual-capital-select"
                      value={state.taxYear}
                      disabled={!canSubmit}
                      onChange={(event) => {
                        const nextYear = Number(event.currentTarget.value);
                        const option = annualFiling.modal.tax_year_options.find((row) => row.tax_year === nextYear);
                        onStateChange({
                          taxYear: nextYear,
                          submittedOn: option?.submitted_on ?? state.submittedOn,
                          confirmOtherTaxYear: nextYear === annualFiling.tab_tax_year ? false : state.confirmOtherTaxYear,
                        });
                      }}
                    >
                      {annualFiling.modal.tax_year_options.map((option) => (
                        <option key={option.tax_year} value={option.tax_year}>
                          {option.tax_year}
                          {option.is_tab_year ? ` — ${t('clientOperations.registry.reporting.annualCapital.tabYear')}` : ''}
                          {option.already_filed ? ` — ${t('clientOperations.annual.filedStatus')}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </section>
              <section className="nx-co-annual-capital-modal__date">
                <ClientOperationsFilingDateField
                  id="nx-co-annual-capital-filed-on"
                  label={t(filing.modal.filed_on_label_key)}
                  value={state.submittedOn}
                  lang={lang}
                  dir={dir}
                  disabled={!canSubmit}
                  required
                  onChange={(iso) => onStateChange({ submittedOn: iso })}
                />
              </section>
            </div>
            {otherYear ? (
              <label className="nx-co-annual-capital-confirm">
                <input
                  type="checkbox"
                  checked={state.confirmOtherTaxYear}
                  disabled={!canSubmit}
                  onChange={(event) => onStateChange({ confirmOtherTaxYear: event.target.checked })}
                />
                <span>{t('clientOperations.registry.reporting.annualCapital.confirmOtherYear')}</span>
              </label>
            ) : null}
            {existingFiles.length || state.pendingFiles.length ? (
              <ul className="nx-co-annual-capital-modal__files" data-testid="client-operations-annual-capital-files">
                {existingFiles.map((file) => (
                  <li key={file.file_asset_id}>
                    <span>{file.file_name || t(file.source_kind_label_key)}</span>
                    {file.can_open ? (
                      <button
                        type="button"
                        className="nx-co-annual-capital-file-link"
                        onClick={() => onOpenLinkedFile(file)}
                      >
                        {t('clientOperations.registry.reporting.annualCapital.previewFile')}
                      </button>
                    ) : null}
                  </li>
                ))}
                {state.pendingFiles.map((file, index) => (
                  <li key={`pending-${file.file_name}-${index}`}>
                    <span>{file.file_name}</span>
                    <button type="button" className="nx-co-annual-capital-file-link" onClick={() => openPendingPreview(file)}>
                      {t('clientOperations.registry.reporting.annualCapital.previewFile')}
                    </button>
                    {canSubmit ? (
                      <button
                        type="button"
                        className="nx-co-annual-capital-file-link"
                        onClick={() => onRemovePendingFile(index)}
                      >
                        {t('clientOperations.annual.removeFile')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {pending || feedback ? (
              <div
                className={`nx-co-filing-modal__result is-${pending ? 'pending' : feedback?.tone}`}
                role={feedback?.tone === 'err' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <span className="nx-co-filing-modal__result-icon" aria-hidden="true">
                  {pending ? '…' : feedback?.tone === 'ok' ? '✓' : '!'}
                </span>
                <span>
                  {pending ? t('clientOperations.registry.reporting.filing.saving') : feedback?.text}
                </span>
              </div>
            ) : null}
          </div>
          <div className="nx-clients-form__footer nx-co-ni-modal__footer">
            <button
              type="submit"
              className="nx-glass-btn nx-glass-btn--purple"
              disabled={!canSubmit || !state.submittedOn || (otherYear && !state.confirmOtherTaxYear)}
            >
              {t(filing.modal.confirm_key)}
            </button>
            <button type="button" className="nx-glass-btn nx-glass-btn--secondary" disabled={pending} onClick={onClose}>
              {t(filing.modal.cancel_key)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
