import type { IncomeDocumentBrandingSettingsEntrypoint } from '../../income/income-document-branding-types';

type Props = {
  entrypoint: IncomeDocumentBrandingSettingsEntrypoint | null;
  disabled?: boolean;
  onClick: () => void;
};

/** Issuer-level branding entry — icon only; labels from backend entrypoint. */
export function IncomeDocumentBrandingGearButton({ entrypoint, disabled, onClick }: Props) {
  if (!entrypoint?.visible) return null;

  return (
    <button
      type="button"
      className="nx-income-branding-gear-icon"
      disabled={Boolean(disabled) || !entrypoint.allowed_actions.length}
      onClick={onClick}
      aria-label={entrypoint.modal_title}
      title={entrypoint.modal_title}
    >
      <span aria-hidden>⚙️</span>
    </button>
  );
}
