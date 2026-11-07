import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  buildClientOperationsToolbarCapabilities,
  buildRegistryRowCellLabelKeys,
  buildRegistryRowCells,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { buildClientOperationsRegistryFiltersContract } from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';
import {
  CO_UI,
  knownSystemDisplayLabelKey,
  obligationCheckboxLabelKey,
  obligationColumnLabelKey,
  storedBusinessTypeLabelKey,
} from '../../src/domains/client-operations/client-operations-ui-labels.pure.js';

test('system registry columns expose stable label_key without changing Hebrew fallback labels', () => {
  const clientName = CLIENT_OPERATIONS_REGISTRY_COLUMNS.find((c) => c.key === 'client_name');
  const handler = CLIENT_OPERATIONS_REGISTRY_COLUMNS.find((c) => c.key === 'handler');
  const annual = CLIENT_OPERATIONS_REGISTRY_COLUMNS.find((c) => c.key === 'annual_report');
  assert.equal(clientName?.label, 'שם לקוח');
  assert.equal(clientName?.label_key, CO_UI.columns.clientName);
  assert.equal(handler?.label, 'מטפל בתיק');
  assert.equal(handler?.label_key, CO_UI.columns.handler);
  assert.equal(annual?.label, 'דוח שנתי');
  assert.equal(annual?.label_key, CO_UI.columns.annualReport);
  assert.ok(CLIENT_OPERATIONS_REGISTRY_COLUMNS.filter((c) => c.system && c.key !== 'folder').every((c) => c.label_key));
});

test('filter contract attaches label_key to system options but not handler names', () => {
  const contract = buildClientOperationsRegistryFiltersContract({
    active: {
      operational_reporting: 'all',
      material: 'all',
      payroll: 'all',
      reporting_type: 'all',
      business_type: 'all',
      handler: 'all',
    },
    handlerOptions: [{ user_id: 'u1', display_name: 'Dana Cohen' }],
  });
  const business = contract.definitions.find((d) => d.id === 'business_type');
  const handler = contract.definitions.find((d) => d.id === 'handler');
  assert.equal(business?.label_key, CO_UI.filters.businessType);
  assert.equal(business?.options.find((o) => o.id === 'osek_patur')?.label_key, CO_UI.businessType.osekPatur);
  assert.equal(handler?.options.find((o) => o.id === 'unassigned')?.label_key, CO_UI.filters.unassigned);
  assert.equal(handler?.options.find((o) => o.id === 'u1')?.label_he, 'Dana Cohen');
  assert.equal(handler?.options.find((o) => o.id === 'u1')?.label_key, undefined);
  assert.equal(contract.clear_action.label_key, CO_UI.clearFilter);
});

test('enum cell displays map to translation keys; names and dates do not', () => {
  const cells = buildRegistryRowCells({
    client_name: 'Acme Ltd',
    tax_id: '512345678',
    business_type: 'עוסק מורשה',
    payroll_flag: true,
    material_brought_flag: false,
    vat_status: 'דו-חודשי',
    vat_due_registry_display_he: '15.04.2026',
    income_tax_advance_status: 'חודשי',
    national_insurance_status: 'לא עונה להגדרות',
    national_insurance_deductions_status: 'כן',
    income_tax_deductions_status: null,
    assigned_handler_display_he: 'Dana Cohen',
    notes_cell_text_he: 'call client',
  });
  const keys = buildRegistryRowCellLabelKeys(cells);
  assert.equal(keys.business_type, CO_UI.businessType.osekMurshe);
  assert.equal(keys.payroll, CO_UI.yes);
  assert.equal(keys.material_brought, CO_UI.no);
  assert.equal(keys.vat, CO_UI.enums.biMonthly);
  assert.equal(keys.income_tax_advance, CO_UI.enums.monthly);
  assert.equal(keys.national_insurance, CO_UI.enums.notApplicable);
  assert.equal(keys.national_insurance_deductions, CO_UI.yes);
  assert.equal(keys.client_name, undefined);
  assert.equal(keys.handler, undefined);
  assert.equal(keys.notes, undefined);
  assert.equal(keys.vat_due, undefined);
  assert.equal(storedBusinessTypeLabelKey('עוסק פטור'), CO_UI.businessType.osekPatur);
  assert.equal(knownSystemDisplayLabelKey('כן'), CO_UI.yes);
});

test('obligation columns map to stable codes, not Hebrew text', () => {
  assert.equal(obligationColumnLabelKey('payroll'), CO_UI.obligations.columns.payroll);
  assert.equal(obligationColumnLabelKey('material'), CO_UI.obligations.columns.materialBrought);
  assert.equal(obligationColumnLabelKey('vat_due_day'), CO_UI.obligations.columns.vatDue);
  assert.equal(obligationColumnLabelKey('priority'), CO_UI.obligations.columns.priority);
  assert.equal(obligationCheckboxLabelKey('income_advances'), CO_UI.obligations.advances);
  assert.equal(obligationCheckboxLabelKey('vat'), CO_UI.obligations.columns.vat);
});

test('toolbar capabilities expose label_key onto existing I18n keys', () => {
  const caps = buildClientOperationsToolbarCapabilities({ can_create_custom_column: true });
  assert.equal(caps.find((c) => c.id === 'undo')?.label_key, CO_UI.toolbar.undo);
  assert.equal(caps.find((c) => c.id === 'filter')?.label_key, CO_UI.toolbar.filter);
});

test('Accounting income and expense summaries emit label_key entries instead of raw Hebrew composites', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/client-operations/client-accounting-tab.service.ts'),
    'utf8',
  );
  assert.match(src, /summary_primary_entries/);
  assert.match(src, /summaryPrimaryEntry\(/);
  assert.match(src, /ACCOUNTING_EXPENSE_LABEL_KEY\[r\.expense_type_code\]/);
  assert.match(src, /ACCOUNTING_INCOME_LABEL_KEY\[s\.source_code\]/);
  assert.match(src, /clientOperations\.accounting\.workplacesCount/);
  assert.match(src, /clientOperations\.accounting\.additionalIncome/);
  assert.doesNotMatch(src, /amountLines\.push\(`\$\{label\} ₪/);
  assert.doesNotMatch(src, /extra\.push\(`\$\{Number\(parent\.number_of_workplaces\)\} מקומות עבודה`\)/);
  assert.doesNotMatch(src, /extra\.push\('הכנסה נוספת'\)/);
});
