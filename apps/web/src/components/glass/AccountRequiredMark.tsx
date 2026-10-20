import './account-deep-ocean';

/**
 * Account modal required-field marker. Keep this inline next to label text;
 * never render it as a separate flex/grid row.
 */
export function AccountRequiredMark() {
  return (
    <span className="nx-account-required-mark" aria-hidden="true">
      *
    </span>
  );
}
