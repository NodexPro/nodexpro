import { useId } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

export function GlassFilePicker(props: {
  accept: string;
  file: File | null;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}) {
  const { accept, file, disabled, onChange } = props;
  const { t } = useI18n();
  const inputId = useId();

  return (
    <div className="nx-glass-file">
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <label htmlFor={inputId} className={`nx-glass-btn nx-glass-btn--secondary${disabled ? ' is-disabled' : ''}`}>
        {t('documents.chooseFile')}
      </label>
      <span className="nx-glass-file__name">{file ? file.name : t('documents.noFileSelected')}</span>
    </div>
  );
}
