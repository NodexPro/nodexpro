import { useI18n } from '../i18n/I18nProvider';

/** Presentation-only dismiss control for Client Workspace nested dialogs. */
export function WorkspaceNestedDialogClose({
  onClick,
  disabled,
  labelHe,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  labelHe?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const label = labelHe ?? t('clientOperations.close');
  return (
    <button
      type="button"
      className={className ? `nx-modal-close ${className}` : 'nx-modal-close'}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </button>
  );
}
