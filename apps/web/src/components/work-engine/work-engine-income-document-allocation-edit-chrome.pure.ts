import type { IncomeDocumentAllocationNumberField } from '../../income/income-document-details-types';

/** Stable document row marker in canonical preview/PDF HTML — not an application control. */
export const INCOME_DOCUMENT_ALLOCATION_ROW_SELECTOR = '.nx-doc__meta-row--allocation';

export type IncomeDocumentAllocationEditChrome = {
  render: boolean;
  disabled: boolean;
  tooltip: string;
};

/** Render-only mapping from backend allocation_number_field descriptor. */
export function resolveIncomeDocumentAllocationEditChrome(params: {
  field: IncomeDocumentAllocationNumberField | null | undefined;
  has_on_save_handler: boolean;
  busy?: boolean;
}): IncomeDocumentAllocationEditChrome {
  const field = params.field;
  if (!field?.visible || !params.has_on_save_handler) {
    return { render: false, disabled: true, tooltip: '' };
  }
  if (field.editable && !params.busy) {
    return {
      render: true,
      disabled: false,
      tooltip: field.tooltip ?? field.label,
    };
  }
  return {
    render: true,
    disabled: true,
    tooltip: field.disabled_reason ?? field.tooltip ?? field.label,
  };
}
