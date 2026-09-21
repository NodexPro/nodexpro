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
  'מקדמות מס הכנסה',
  'ביטוח לאומי',
  'מס הכנסה ניכויים',
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

test('1b — default visible registry columns hide cleanup fields and expose material checkbox; annual STATUS cols absent', () => {
  const byKey = new Map(CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => [c.key, c]));
  assert.equal(byKey.get('tax_id')?.visible, false);
  assert.equal(byKey.get('business_type')?.visible, false);
  assert.equal(byKey.get('vat_due')?.visible, false);
  assert.equal(byKey.get('material_brought')?.label, 'חומר');
  assert.equal(byKey.get('material_brought')?.cell_kind, 'checkbox');
  assert.equal(byKey.get('material_brought')?.editable, true);
  assert.equal(byKey.has('annual_report'), false);
  assert.equal(byKey.has('capital_declaration'), false);
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
  assert.equal(cells.annual_report, undefined);
  assert.equal(cells.capital_declaration, undefined);
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
