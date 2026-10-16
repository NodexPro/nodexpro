/** Presentation-only dismiss control for Client Workspace nested dialogs. */
export function WorkspaceNestedDialogClose({
  onClick,
  disabled,
  labelHe = 'סגירה',
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  labelHe?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `nx-modal-close ${className}` : 'nx-modal-close'}
      aria-label={labelHe}
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </button>
  );
}
