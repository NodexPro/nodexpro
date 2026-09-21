/**
 * Phase 1 — Client Operations registry notes → full refreshed aggregate.
 * Source-contract regression tests (no network).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistryRowCells } from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const notesService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-notes.service.ts'),
  'utf8',
);
const routes = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.routes.ts'),
  'utf8',
);
const service = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const presentation = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-presentation.pure.ts'),
  'utf8',
);
const view = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const page = readFileSync(join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const customColumns = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const weHost = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);
const vatDivuach = readFileSync(
  join(dir, '../../src/domains/client-operations/vat-divuach.ts'),
  'utf8',
);

test('1-3 create/update/delete note return refreshed registry aggregate', () => {
  assert.match(notesService, /buildOperationalNoteMutationResult/);
  assert.match(notesService, /listClientOperationsRegistry\(ctx/);
  assert.match(notesService, /listOperationalNotes\(ctx, clientId\)/);
  assert.match(notesService, /OperationalNoteMutationResult/);
  assert.doesNotMatch(notesService, /registryPreview/);
  assert.equal(
    (notesService.match(/return buildOperationalNoteMutationResult\(ctx, clientId, note\)/g) ?? []).length,
    2,
  );
  assert.match(notesService, /return buildOperationalNoteMutationResult\(ctx, clientId\);/);
  assert.match(routes, /const out = await deleteOperationalNote/);
  assert.match(routes, /res\.status\(200\)\.json\(out\)/);
});

test('4-6 no registryPreview patch / no hidden GET after note mutation', () => {
  assert.doesNotMatch(view, /registryPreview/);
  assert.match(view, /onApplyAggregate\(mutation\.registry\)/);
  const deleteIdx = view.indexOf("method: 'DELETE'");
  assert.ok(deleteIdx > 0);
  const deleteWindow = view.slice(deleteIdx, deleteIdx + 900);
  assert.doesNotMatch(deleteWindow, /moduleClientOperationsOperationalNotes\(/);
  assert.doesNotMatch(deleteWindow, /reloadRegistry\(\)/);
});

test('7 frontend replaces aggregate after note command', () => {
  assert.match(view, /onApplyAggregate/);
  assert.match(page, /onApplyAggregate=\{applyAggregate\}/);
  assert.match(view, /if \(onApplyAggregate\) onApplyAggregate\(mutation\.registry\)/);
});

test('8 EMBEDDED_FALLBACK_COLUMNS removed', () => {
  assert.doesNotMatch(view, /EMBEDDED_FALLBACK_COLUMNS/);
  assert.match(view, /const columns = columnsProp \?\? \[\]/);
});

test('9 displayForColumn business fallback removed', () => {
  assert.match(view, /function displayForColumn/);
  assert.doesNotMatch(view, /col\.key === 'payroll'/);
  assert.doesNotMatch(view, /col\.key === 'national_insurance'/);
  assert.doesNotMatch(view, /col\.value_field/);
  assert.match(view, /r\.cells\?\.\[col\.key\]/);
});

test('10-12 handler cell display-ready, batched, no N+1', () => {
  assert.match(presentation, /assigned_handler_display_he/);
  assert.match(presentation, /handler: textHe\(input\.assigned_handler_display_he\)/);
  assert.match(service, /loadHandlerDisplayNamesByUserIds/);
  assert.match(service, /\.in\('user_id', unique\)/);
  assert.match(service, /handlerDisplayByUserId\.get\(assigned_handler_user_id\)/);
  assert.equal((service.match(/await loadHandlerDisplayNamesByUserIds/g) ?? []).length, 1);
  const cells = buildRegistryRowCells({
    client_name: 'א',
    tax_id: '1',
    business_type: null,
    payroll_flag: true,
    material_brought_flag: false,
    vat_status: null,
    vat_due_registry_display_he: null,
    income_tax_advance_status: null,
    national_insurance_status: null,
    national_insurance_deductions_status: null,
    income_tax_deductions_status: null,
    assigned_handler_display_he: 'ישראל ישראלי',
    notes_cell_text_he: null,
  });
  assert.equal(cells.handler, 'ישראל ישראלי');
});

test('13 business action gating from aggregate allowed_actions', () => {
  assert.match(page, /allowedActions\.includes\('client_operations\.edit'\)/);
  assert.doesNotMatch(page, /permissions\.includes\('client_operations\.edit'\)/);
  assert.match(service, /allowed_actions: buildRegistryAllowedActions/);
});

test('14-15 custom columns + max 10 still backend-owned', () => {
  assert.match(customColumns, /listClientOperationsRegistry\(ctx/);
  assert.match(customColumns, /CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX/);
  assert.match(presentation, /CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX = 10/);
});

test('material VAT checkbox is a named command returning refreshed registry aggregate', () => {
  assert.match(presentation, /cell_kind: 'checkbox'/);
  assert.match(view, /['"]set_material_brought['"]/);
  assert.match(view, /type="checkbox"/);
  assert.match(customColumns, /command === 'set_material_brought'/);
  assert.match(customColumns, /client_operational_profiles/);
  assert.match(customColumns, /material_brought_flag: value/);
  assert.match(customColumns, /listClientOperationsRegistry\(ctx,\s*responseQuery\)/);
  assert.doesNotMatch(view, /setRows\(.*material_brought/i);
});

test('annual and capital operational DATE columns are in default registry presentation', () => {
  assert.match(presentation, /key: 'annual_report'/);
  assert.match(presentation, /key: 'capital_declaration'/);
  assert.match(presentation, /דוח שנתי/);
  assert.match(presentation, /הצהרת הון/);
  assert.match(presentation, /cell_kind: 'operational_date'/);
  assert.doesNotMatch(service, /loadAnnualRegistryStatusProjection/);
  assert.doesNotMatch(service, /annual_report_status_he/);
  assert.doesNotMatch(service, /capital_declaration_status_he/);
  assert.match(customColumns, /set_annual_report_operational_target_date/);
  assert.match(customColumns, /open_capital_declaration_instance/);
  assert.match(customColumns, /set_capital_declaration_operational_target_date/);
  assert.match(customColumns, /set_material_brought/);
  assert.doesNotMatch(view, /buildAnnualControlState|missing_documents|completion_percent/);
});

test('16 folder boundary unchanged', () => {
  assert.match(view, /openClientModal/);
  assert.match(weHost, /ClientOperationsRegistryView/);
  assert.match(weHost, /columns=\{aggregate\.client_operations_aggregate\.columns/);
});

test('17-18 tenant isolation + RBAC unchanged for notes', () => {
  assert.match(notesService, /ensureClientInOrg/);
  assert.match(routes, /client_operations\.edit/);
});

test('VAT legal deadline ownership — STOPPED (no Country Pack wire in Phase 1)', () => {
  assert.match(vatDivuach, /19/);
  assert.match(vatDivuach, /23/);
  assert.doesNotMatch(service, /countryPack.*vat.*due|ownerLegal.*vatDue/i);
});
