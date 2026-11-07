/**
 * Client Operations UI-string inventory.
 * This is not a translation catalog: it records permanent system chrome found
 * in screens/components/aggregates, then maps each item to a localization key
 * or marks it unconnected / unverified.
 */
import {
  ACCOUNTING_BLOCK_LABEL_KEY,
  ACCOUNTING_DOC_DELIVERY_LABEL_KEY,
  ACCOUNTING_EXPENSE_DELIVERY_LABEL_KEY,
  ACCOUNTING_EXPENSE_LABEL_KEY,
  ACCOUNTING_FIELD_LABEL_KEY,
  ACCOUNTING_INCOME_LABEL_KEY,
  ACCOUNTING_ORDER_LABEL_KEY,
  ACCOUNTING_UPLOADED_BY_LABEL_KEY,
  CO_UI,
  FEE_COLUMN_LABEL_KEY,
  FEE_CURRENCY_LABEL_KEY,
  FEE_VAT_MODE_LABEL_KEY,
} from '../client-operations/client-operations-ui-labels.pure.js';
import {
  clientOperationsSurfaceForKey,
  type HardcodedSurface,
} from './platform-localization-audit.pure.js';

export type UiStringSource =
  | 'jsx'
  | 'aggregate'
  | 'enum'
  | 'modal'
  | 'toast'
  | 'validation'
  | 'empty_state'
  | 'navigation';

export type UiStringVerification = 'verified_connected' | 'verified_hardcoded' | 'unverified';

export type ClientOperationsUiString = {
  id: string;
  tab: string;
  component: string;
  location: string;
  source: UiStringSource;
  localization_key: string | null;
  displayed_text: string;
  verification: UiStringVerification;
  requires_code_fix: boolean;
  reason: string;
  target_locales: string[];
};

function collectLabelKeys(value: unknown): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('clientOperations.') || value.startsWith('nav.clientOperations')) return [value];
    return [];
  }
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectLabelKeys);
}

const CONNECTED_LABEL_KEYS = [
  ...collectLabelKeys(CO_UI),
  ...collectLabelKeys(FEE_CURRENCY_LABEL_KEY),
  ...collectLabelKeys(FEE_VAT_MODE_LABEL_KEY),
  ...collectLabelKeys(FEE_COLUMN_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_BLOCK_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_FIELD_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_EXPENSE_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_INCOME_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_DOC_DELIVERY_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_EXPENSE_DELIVERY_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_UPLOADED_BY_LABEL_KEY),
  ...collectLabelKeys(ACCOUNTING_ORDER_LABEL_KEY),
];

function connectedItem(key: string): ClientOperationsUiString {
  const surface = clientOperationsSurfaceForKey(key);
  return {
    id: `connected:${key}`,
    tab: surface.tab,
    component: 'aggregate-or-jsx',
    location: surface.location,
    source: 'aggregate',
    localization_key: key,
    displayed_text: key,
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Permanent system label is connected to a localization key.',
    target_locales: ['en', 'he'],
  };
}

/** Extra chrome inspected in JSX / aggregates, including newly wired keys. */
export const CLIENT_OPERATIONS_EXTRA_UI_STRINGS: ClientOperationsUiString[] = [
  {
    id: 'jsx:reminder-toast.active',
    tab: 'Registry',
    component: 'ReminderToast',
    location: 'Toast heading',
    source: 'toast',
    localization_key: 'clientOperations.reminders.active',
    displayed_text: 'Active reminder',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Toast chrome is wired to i18n.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'jsx:reminder-toast.client',
    tab: 'Registry',
    component: 'ReminderToast',
    location: 'Client prefix',
    source: 'toast',
    localization_key: 'clientOperations.reminders.clientPrefix',
    displayed_text: 'Client:',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Toast chrome is wired to i18n. Client name remains user data.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'jsx:reminder-toast.close',
    tab: 'Registry',
    component: 'ReminderToast',
    location: 'Close control',
    source: 'toast',
    localization_key: 'clientOperations.close',
    displayed_text: 'Close',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Toast close control is wired to i18n.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:fees.currency.rub',
    tab: 'Fees',
    component: 'ClientFeesTab',
    location: 'Currency dropdown',
    source: 'enum',
    localization_key: 'clientOperations.fees.currencies.rub',
    displayed_text: 'Ruble',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'RUB option now has label_key.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:fees.currency.aed',
    tab: 'Fees',
    component: 'ClientFeesTab',
    location: 'Currency dropdown',
    source: 'enum',
    localization_key: 'clientOperations.fees.currencies.aed',
    displayed_text: 'Dirham',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'AED option now has label_key.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:fees.renewal.expired',
    tab: 'Fees',
    component: 'ClientFeesTab',
    location: 'Renewal banner',
    source: 'aggregate',
    localization_key: 'clientOperations.fees.renewal.expiredDays',
    displayed_text: 'Agreement expired {{days}} days ago',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Renewal banner uses text_key + interpolation.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:fees.renewal.expires',
    tab: 'Fees',
    component: 'ClientFeesTab',
    location: 'Renewal banner',
    source: 'aggregate',
    localization_key: 'clientOperations.fees.renewal.expiresInDays',
    displayed_text: 'Agreement expires in {{days}} days',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Renewal banner uses text_key + interpolation.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:fees.renewal.active',
    tab: 'Fees',
    component: 'ClientFeesTab',
    location: 'Renewal banner',
    source: 'aggregate',
    localization_key: 'clientOperations.fees.renewal.activeUntil',
    displayed_text: 'Agreement is active; ends {{date}}',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Renewal banner uses text_key + interpolation.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:accounting.vehicle-details',
    tab: 'Accounting settings',
    component: 'ClientAccountingSettingsTab',
    location: 'Vehicle grid column header',
    source: 'aggregate',
    localization_key: 'clientOperations.accounting.headings.vehicleDetails',
    displayed_text: 'Vehicle details',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Vehicle grid headers have column_header_keys.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'aggregate:accounting.tax-deductions',
    tab: 'Accounting settings',
    component: 'ClientAccountingSettingsTab',
    location: 'Vehicle grid column header',
    source: 'aggregate',
    localization_key: 'clientOperations.accounting.headings.taxDeductions',
    displayed_text: 'Tax and deductions',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason: 'Vehicle grid headers have column_header_keys.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'accounting-income-summary-rows',
    tab: 'Accounting settings',
    component: 'ClientAccountingSettingsTab',
    location: 'Income card additional-income rows',
    source: 'aggregate',
    localization_key: 'clientOperations.accounting.workplacesCount',
    displayed_text: '{{n}} workplaces / Additional income / named source rows',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason:
      'Income summary rows are backend-owned summary_primary_entries with label_key/fill_key. Amounts, workplace names, tax IDs, and source details stay user data.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'accounting-expense-summary-rows',
    tab: 'Accounting settings',
    component: 'ClientAccountingSettingsTab',
    location: 'Expenses card monthly-amount rows',
    source: 'aggregate',
    localization_key: 'clientOperations.accounting.namedAmount',
    displayed_text: '{{label}} {{amount}}',
    verification: 'verified_connected',
    requires_code_fix: false,
    reason:
      'Expense amount lines use expense label_key plus namedAmount. The ₪ amount is display-only and is not translated.',
    target_locales: ['en', 'he'],
  },
];

/**
 * Former hardcoded income/expense composites. Sources now emit label_key / fill_key;
 * amounts and user meta stay untranslated. Kept as inventory extras so counts stay honest.
 */
export const CLIENT_OPERATIONS_REMAINING_HARDCODED: ClientOperationsUiString[] = [];

export const CLIENT_OPERATIONS_UNVERIFIED_UI_STRINGS: ClientOperationsUiString[] = [
  {
    id: 'unverified:legacy-accounting-tab',
    tab: 'Accounting settings',
    component: 'ClientAccountingTab',
    location: 'Legacy tab (not mounted)',
    source: 'jsx',
    localization_key: null,
    displayed_text: '',
    verification: 'unverified',
    requires_code_fix: false,
    reason:
      'Legacy ClientAccountingTab is fully hardcoded Hebrew but is not mounted; live Accounting settings uses ClientAccountingSettingsTab.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'unverified:docflow-empty-error',
    tab: 'Client details / DocFlow empty and error states',
    component: 'ClientDocflowTab',
    location: 'Empty, error, and attachment states',
    source: 'empty_state',
    localization_key: null,
    displayed_text: '',
    verification: 'unverified',
    requires_code_fix: false,
    reason:
      'Office DocFlow threads and attachments need an authenticated client case; keys are wired, live messages were not exercised here.',
    target_locales: ['en', 'he'],
  },
  {
    id: 'unverified:office-session-modals',
    tab: 'All Client Operations',
    component: 'Client Operations office screens',
    location: 'Live office tabs, nested modals, and dropdowns',
    source: 'modal',
    localization_key: null,
    displayed_text: '',
    verification: 'unverified',
    requires_code_fix: false,
    reason:
      'No authenticated office session in this environment. Source inventory and component harnesses were used; live office screens were not clicked.',
    target_locales: ['en', 'he'],
  },
];

const extraKeys = new Set(
  CLIENT_OPERATIONS_EXTRA_UI_STRINGS.map((row) => row.localization_key).filter((key): key is string => Boolean(key)),
);

export const CLIENT_OPERATIONS_UI_INVENTORY: ClientOperationsUiString[] = [
  ...CONNECTED_LABEL_KEYS.filter((key) => !extraKeys.has(key)).map(connectedItem),
  ...CLIENT_OPERATIONS_EXTRA_UI_STRINGS,
  ...CLIENT_OPERATIONS_REMAINING_HARDCODED,
  ...CLIENT_OPERATIONS_UNVERIFIED_UI_STRINGS,
];

export function hardcodedSurfacesFromInventory(
  items: ClientOperationsUiString[] = CLIENT_OPERATIONS_UI_INVENTORY,
): HardcodedSurface[] {
  return items
    .filter((item) => item.verification === 'verified_hardcoded')
    .map((item) => ({
      id: item.id,
      tab: item.tab,
      location: item.location,
      displayed_text: item.displayed_text,
      localization_key: item.localization_key,
      requires_code_fix: item.requires_code_fix,
      reason: item.reason,
      target_locales: item.target_locales,
      usage_locations: [{ tab: item.tab, location: `${item.component} · ${item.location}` }],
    }));
}

export function summarizeUiInventory(items: ClientOperationsUiString[] = CLIENT_OPERATIONS_UI_INVENTORY): {
  ui_strings_inventoried: number;
  ui_strings_verified: number;
  ui_strings_unverified: number;
  connected_count: number;
  hardcoded_count: number;
} {
  const inventoried = items.length;
  const unverified = items.filter((item) => item.verification === 'unverified').length;
  const verified = inventoried - unverified;
  return {
    ui_strings_inventoried: inventoried,
    ui_strings_verified: verified,
    ui_strings_unverified: unverified,
    connected_count: items.filter((item) => item.verification === 'verified_connected').length,
    hardcoded_count: items.filter((item) => item.verification === 'verified_hardcoded').length,
  };
}
