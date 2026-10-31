const REGISTRY_COMMAND_ERROR_KEYS: Record<string, string> = {
  CLIENT_OPERATIONS_PAYROLL_NOT_APPLICABLE: 'clientOperations.registry.errors.payrollNotApplicable',
  CLIENT_OPERATIONS_MATERIAL_NOT_APPLICABLE: 'clientOperations.registry.errors.materialNotApplicable',
  CLIENT_OPERATIONS_INCOME_TAX_ADVANCE_NOT_APPLICABLE:
    'clientOperations.registry.errors.incomeTaxAdvanceNotApplicable',
  CLIENT_OPERATIONS_NI_DEDUCTIONS_NOT_APPLICABLE: 'clientOperations.registry.errors.niDeductionsNotApplicable',
  CLIENT_OPERATIONS_INCOME_TAX_DEDUCTIONS_NOT_DUE: 'clientOperations.registry.errors.incomeTaxDeductionsNotDue',
};

const LEGACY_MESSAGE_KEYS: Record<string, string> = {
  'Payroll material is not applicable for this period':
    'clientOperations.registry.errors.payrollNotApplicable',
  'Material brought is not applicable for this period':
    'clientOperations.registry.errors.materialNotApplicable',
  'Income tax advance material is not applicable for this period':
    'clientOperations.registry.errors.incomeTaxAdvanceNotApplicable',
  'NI deductions are not applicable for this period':
    'clientOperations.registry.errors.niDeductionsNotApplicable',
  'Income-tax deductions are not due for this period':
    'clientOperations.registry.errors.incomeTaxDeductionsNotDue',
};

export function resolveClientOperationsRegistryCommandErrorKey(input: {
  code?: string | null;
  message?: string | null;
}): string | null {
  const code = String(input.code ?? '').trim();
  if (code && REGISTRY_COMMAND_ERROR_KEYS[code]) return REGISTRY_COMMAND_ERROR_KEYS[code];
  const message = String(input.message ?? '').trim();
  if (message && LEGACY_MESSAGE_KEYS[message]) return LEGACY_MESSAGE_KEYS[message];
  return null;
}

export function localizeClientOperationsRegistryCommandError(
  input: { code?: string | null; message?: string | null },
  t: (key: string) => string,
  fallback: string,
): string {
  const key = resolveClientOperationsRegistryCommandErrorKey(input);
  if (!key) return fallback;
  const localized = t(key);
  return localized === key ? fallback : localized;
}
