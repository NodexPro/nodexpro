import './account-deep-ocean';

/**
 * Account modal required-field marker. Label text stays with the parent;
 * only this asterisk is cyan. Do not use for optional fields or prose.
 */
export function AccountRequiredMark() {
  return (
    <span className="nx-account-required-mark" aria-hidden="true">
      *
    </span>
  );
}
