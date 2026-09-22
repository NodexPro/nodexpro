import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyRegistryQueryToRows,
  buildClientOperationsToolbarCapabilities,
  buildRegistryRowCells,
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  formatIncomeTaxAdvanceRegistryFrequencyDisplayHe,
  isSystemRegistryColumnKey,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(
  join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const presentationSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-presentation.pure.ts'),
  'utf8',
);

const REQUIRED_LABELS = [
  'שם לקוח',
  'ח.פ',
  'סוג עסק',
  'שכר',
  'חומר',
  'מע״מ',
  'יום יעד דיווח מע״מ',
  'מה״כ',
  'ביטוח לאומי',
  'ב״ל ניכויים',
  'מ״ה ניכויים',
  'מטפל בתיק',
  'הערות',
];

test('1 — existing backend-defined system columns remain', () => {
  for (const label of REQUIRED_LABELS) {
    assert.ok(
      CLIENT_OPERATIONS_REGISTRY_COLUMNS.some((c) => c.label === label),
      `missing column label ${label}`,
    );
  }
  assert.ok(CLIENT_OPERATIONS_REGISTRY_COLUMNS.some((c) => c.key === 'folder' && c.cell_kind === 'folder'));
  assert.ok(CLIENT_OPERATIONS_REGISTRY_COLUMNS.every((c) => c.system === true));
});

test('1b — default visible registry columns hide cleanup fields; material + annual/capital operational date cols present', () => {
  const byKey = new Map(CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => [c.key, c]));
  assert.equal(byKey.get('tax_id')?.visible, false);
  assert.equal(byKey.get('business_type')?.visible, false);
  assert.equal(byKey.get('vat_due')?.visible, false);
  assert.equal(byKey.get('material_brought')?.label, 'חומר');
  assert.equal(byKey.get('material_brought')?.cell_kind, 'checkbox');
  assert.equal(byKey.get('material_brought')?.editable, true);
  assert.equal(byKey.get('annual_report')?.cell_kind, 'operational_date');
  assert.equal(byKey.get('capital_declaration')?.cell_kind, 'operational_date');
  assert.equal(byKey.get('income_tax_advance')?.label, 'מה״כ');
  assert.equal(byKey.get('national_insurance_deductions')?.label, 'ב״ל ניכויים');
  assert.equal(byKey.get('income_tax_deductions')?.label, 'מ״ה ניכויים');
  const keys = CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => c.key);
  assert.ok(keys.indexOf('income_tax_deductions') < keys.indexOf('annual_report'));
  assert.ok(keys.indexOf('annual_report') < keys.indexOf('capital_declaration'));
  assert.ok(keys.indexOf('material_brought') < keys.indexOf('vat'));
  assert.ok(keys.indexOf('vat') < keys.indexOf('annual_report'));
});

test('2 — folder action remains emoji button openClientModal', () => {
  assert.match(viewSource, /openClientModal\(r\)/);
  assert.match(viewSource, /📁/);
  assert.match(viewSource, /aria-label=\{`Open client case/);
  assert.doesNotMatch(viewSource, /navigate\(.*client-operations\/clients/);
});

test('3 — no Add Client action on Client Operations spreadsheet screen', () => {
  assert.doesNotMatch(pageSource, /הוסף לקוח/);
  assert.doesNotMatch(viewSource, /הוסף לקוח/);
  assert.doesNotMatch(pageSource, /Add Client/i);
  assert.match(pageSource, /variant="spreadsheet"/);
});

test('4 — custom columns are backend-owned capability truth', () => {
  const caps = buildClientOperationsToolbarCapabilities({ can_create_custom_column: true });
  const add = caps.find((c) => c.id === 'add_column');
  assert.ok(add);
  assert.equal(add!.available, true);
  assert.equal(add!.reason_he, null);
  assert.match(presentationSource, /add_column/);
  assert.doesNotMatch(presentationSource, /localStorage/);
});

test('5 — no frontend-only custom column registry', () => {
  assert.doesNotMatch(viewSource, /localStorage.*column/i);
  assert.doesNotMatch(pageSource, /customColumns\s*=\s*\[/);
  assert.match(pageSource, /toolbar_capabilities/);
  assert.match(pageSource, /columns/);
  assert.match(serviceSource, /CLIENT_OPERATIONS_REGISTRY_COLUMNS/);
});

test('6 — sorting/filtering owned by backend query helpers', () => {
  const rows = [
    {
      client_id: '1',
      client_name: 'Beta',
      cells: { client_name: 'Beta', tax_id: '1' },
    },
    {
      client_id: '2',
      client_name: 'Alpha',
      cells: { client_name: 'Alpha', tax_id: '2' },
    },
  ];
  const sorted = applyRegistryQueryToRows(rows, { sort_by: 'client_name', sort_dir: 'asc' });
  assert.equal(sorted[0]!.client_name, 'Alpha');
  assert.equal(sorted[1]!.client_name, 'Beta');
  const filtered = applyRegistryQueryToRows(rows, { q: 'alp' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.client_id, '2');
  assert.match(serviceSource, /applyRegistryQueryToRows/);
  assert.doesNotMatch(pageSource, /rows\.sort\(/);
  assert.doesNotMatch(pageSource, /rows\.filter\(/);
});

test('7 — tenant isolation remains org-scoped on registry read', () => {
  assert.match(serviceSource, /\.eq\('organization_id', orgId\)/);
  assert.match(serviceSource, /assertOrg\(ctx\)/);
});

test('8 — add_column follows backend capability', () => {
  const add = buildClientOperationsToolbarCapabilities({
    can_create_custom_column: false,
    can_create_reason_he: 'מגבלה',
  }).find((c) => c.id === 'add_column');
  assert.equal(add?.available, false);
  assert.equal(add?.reason_he, 'מגבלה');
  assert.match(serviceSource, /loadActiveClientOperationsRegistryCustomColumns/);
  assert.match(viewSource, /canCreateColumn/);
});

test('9 — canonical system keys cannot be treated as non-system', () => {
  assert.equal(isSystemRegistryColumnKey('vat'), true);
  assert.equal(isSystemRegistryColumnKey('payroll'), true);
  assert.equal(isSystemRegistryColumnKey('custom_office_field'), false);
  assert.ok(CLIENT_OPERATIONS_REGISTRY_COLUMNS.every((c) => isSystemRegistryColumnKey(c.key)));
});

test('10 — folder behavior unchanged; spreadsheet title not skeleton', () => {
  assert.match(viewSource, /variant === 'spreadsheet'/);
  assert.match(viewSource, /תפעול לקוחות/);
  assert.doesNotMatch(pageSource, /module v1 skeleton/);
  assert.match(viewSource, /ClientWorkspaceModal/);
  const cells = buildRegistryRowCells({
    client_name: 'א',
    tax_id: '1',
    business_type: null,
    payroll_flag: true,
    material_brought_flag: false,
    vat_status: 'חודשי',
    vat_due_registry_display_he: '15',
    income_tax_advance_status: null,
    national_insurance_status: '100',
    national_insurance_deductions_status: null,
    income_tax_deductions_status: null,
    assigned_handler_display_he: null,
    notes_cell_text_he: null,
  });
  assert.equal(cells.payroll, 'כן');
  assert.equal(cells.material_brought, 'לא');
  assert.equal(cells.annual_report, '—');
  assert.equal(cells.capital_declaration, '—');
  assert.match(cells.national_insurance, /₪/);
});

test('toolbar disabled controls expose backend reason (no fake enabled add_column)', () => {
  assert.match(viewSource, /capTitle\('add_column'\)/);
  assert.match(viewSource, /\+ עמודה/);
  assert.match(viewSource, /disabled=\{!canCreateColumn\}/);
});

test('presentation-owned history and fullscreen are available in the aggregate', () => {
  const caps = buildClientOperationsToolbarCapabilities();
  assert.equal(caps.find((c) => c.id === 'undo')?.available, true);
  assert.equal(caps.find((c) => c.id === 'redo')?.available, true);
  assert.equal(caps.find((c) => c.id === 'fullscreen')?.available, true);
});

test('מה״כ shows reporting frequency (not כן/לא); width matches מע״מ', () => {
  assert.equal(formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({ enabled: true, frequency: 'monthly' }), 'חודשי');
  assert.equal(formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({ enabled: true, frequency: 'bi_monthly' }), 'דו-חודשי');
  assert.equal(formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({ enabled: false, frequency: 'monthly' }), null);
  assert.equal(formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({ enabled: true, frequency: null }), null);
  assert.equal(formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({ enabled: null, frequency: 'bi_monthly' }), null);

  const monthlyCells = buildRegistryRowCells({
    client_name: 'א',
    tax_id: '1',
    business_type: null,
    payroll_flag: null,
    material_brought_flag: null,
    vat_status: 'חודשי',
    vat_due_registry_display_he: null,
    income_tax_advance_status: 'חודשי',
    national_insurance_status: null,
    national_insurance_deductions_status: null,
    income_tax_deductions_status: null,
    assigned_handler_display_he: null,
    notes_cell_text_he: null,
  });
  assert.equal(monthlyCells.income_tax_advance, 'חודשי');
  assert.equal(monthlyCells.vat, 'חודשי');

  const naCells = buildRegistryRowCells({
    client_name: 'ב',
    tax_id: '2',
    business_type: null,
    payroll_flag: null,
    material_brought_flag: null,
    vat_status: null,
    vat_due_registry_display_he: null,
    income_tax_advance_status: null,
    national_insurance_status: null,
    national_insurance_deductions_status: null,
    income_tax_deductions_status: null,
    assigned_handler_display_he: null,
    notes_cell_text_he: null,
  });
  assert.equal(naCells.income_tax_advance, '—');
  assert.notEqual(naCells.income_tax_advance, 'כן');
  assert.notEqual(naCells.income_tax_advance, 'לא');

  const byKey = new Map(CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => [c.key, c]));
  assert.equal(byKey.get('income_tax_advance')?.label, 'מה״כ');
  assert.equal(byKey.get('income_tax_advance')?.default_width_px, byKey.get('vat')?.default_width_px);
  assert.equal(byKey.get('vat')?.default_width_px, 72);

  // Backend projects period-frozen frequency; React must not derive it.
  assert.match(serviceSource, /formatIncomeTaxAdvanceRegistryFrequencyDisplayHe/);
  assert.match(serviceSource, /snapshot\.income_tax_advance_frequency/);
  assert.match(serviceSource, /snapshot\.income_tax_advance_enabled/);
  assert.doesNotMatch(viewSource, /bi_monthly|income_tax_advance_frequency/);
  assert.doesNotMatch(viewSource, /חודשי|דו-חודשי/);
});
