import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const apiPresentationSource = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations-registry-presentation.pure.ts'),
  'utf8',
);
const apiRegistrySource = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const panelSource = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const tabsSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);

test('compact tax labels are presentation-only (domain keys unchanged)', () => {
  assert.match(apiPresentationSource, /key:\s*'income_tax_advance'[\s\S]*?label:\s*'מה״כ'/);
  assert.match(apiPresentationSource, /key:\s*'national_insurance'[\s\S]*?label:\s*'ביטוח לאומי'/);
  assert.match(apiPresentationSource, /key:\s*'national_insurance_deductions'[\s\S]*?label:\s*'ב״ל ניכויים'/);
  assert.match(apiPresentationSource, /key:\s*'income_tax_deductions'[\s\S]*?label:\s*'מ״ה ניכויים'/);
  assert.doesNotMatch(apiPresentationSource, /label:\s*'מקדמות מס הכנסה'/);
  assert.doesNotMatch(apiPresentationSource, /label:\s*'ביטוח לאומי ניכויים'/);
  assert.doesNotMatch(apiPresentationSource, /label:\s*'מס הכנסה ניכויים'/);
});

test('annual and capital columns sit after מ״ה ניכויים (not before מע״מ)', () => {
  assert.match(
    apiPresentationSource,
    /key:\s*'income_tax_deductions'[\s\S]*key:\s*'annual_report'[\s\S]*key:\s*'capital_declaration'[\s\S]*key:\s*'handler'/,
  );
  assert.doesNotMatch(
    apiPresentationSource,
    /key:\s*'material_brought'[\s\S]*key:\s*'annual_report'[\s\S]*key:\s*'capital_declaration'[\s\S]*key:\s*'vat'/,
  );
  assert.match(apiPresentationSource, /key:\s*'material_brought'[\s\S]*key:\s*'vat'/);
  assert.match(
    apiPresentationSource,
    /key:\s*'annual_report'[\s\S]*label:\s*'דוח שנתי'[\s\S]*cell_kind:\s*'operational_date'/,
  );
  assert.match(
    apiPresentationSource,
    /key:\s*'capital_declaration'[\s\S]*label:\s*'הצהרת הון'[\s\S]*cell_kind:\s*'operational_date'/,
  );
});

test('default widths keep tax columns compact and date columns calendar-sized', () => {
  assert.match(apiPresentationSource, /key:\s*'vat'[\s\S]*?default_width_px:\s*72/);
  assert.match(apiPresentationSource, /key:\s*'income_tax_advance'[\s\S]*?default_width_px:\s*72/);
  assert.match(apiPresentationSource, /key:\s*'national_insurance'[\s\S]*?default_width_px:\s*72/);
  assert.match(apiPresentationSource, /key:\s*'national_insurance_deductions'[\s\S]*?default_width_px:\s*120/);
  assert.match(apiPresentationSource, /key:\s*'income_tax_deductions'[\s\S]*?default_width_px:\s*72/);
  assert.match(apiPresentationSource, /key:\s*'annual_report'[\s\S]*?default_width_px:\s*118/);
  assert.match(apiPresentationSource, /key:\s*'capital_declaration'[\s\S]*?default_width_px:\s*118/);
  assert.match(apiPresentationSource, /key:\s*'material_brought'[\s\S]*?default_width_px:\s*120/);
});

test('frontend renders integrated date/calendar control without tax year math', () => {
  assert.match(viewSource, /nx-co-sheet__date-field/);
  assert.match(viewSource, /nx-co-sheet__date-field-input/);
  assert.match(viewSource, /nx-co-sheet__date-field-icon/);
  assert.match(cssSource, /\.nx-co-sheet__date-field\s*\{/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-input\s*\{/);
  assert.match(viewSource, /annual_report_cell/);
  assert.match(viewSource, /capital_declaration_cell/);
  assert.match(viewSource, /type="date"/);
  assert.doesNotMatch(viewSource, /resolveAnnualReportTaxYearForOperationalPeriod/);
  assert.match(apiRegistrySource, /resolveAnnualReportTaxYearForOperationalPeriod\(/);
});

test('capital N/A renders integrated dash plus open affordance', () => {
  assert.match(viewSource, /capital_declaration_cell\?\.can_open/);
  assert.match(viewSource, /open_capital_declaration_instance/);
  assert.match(viewSource, /פתיחת הצהרת הון/);
  assert.match(viewSource, /nx-co-sheet__date-field-plus/);
  assert.match(viewSource, /nx-co-sheet__date-field-value/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-plus/);
});

test('הצהרת הון open and no-open share the same outer date-field chrome', () => {
  // One shared outer class for open instance and no-open (+ / —) states.
  assert.match(viewSource, /nx-co-sheet__date-field is-na\$\{canOpenCapital \? ' is-openable' : ''\}/);
  assert.match(viewSource, /className=\{`nx-co-sheet__date-field\$\{disabled/);
  assert.match(cssSource, /\.nx-co-sheet__date-field\s*\{[\s\S]*?min-width:\s*104px/);
  // No-open must not shrink / restyle into a different box (stay within the rule body).
  assert.doesNotMatch(cssSource, /\.nx-co-sheet__date-field\.is-na\s*\{[^}]*min-width\s*:/);
  assert.doesNotMatch(cssSource, /\.nx-co-sheet__date-field\.is-openable\s*\{[^}]*min-width\s*:/);
  assert.doesNotMatch(cssSource, /\.nx-co-sheet__date-field\.is-na\s*\{[^}]*background\s*:/);
  // Compact + still opens the canonical instance command.
  assert.match(viewSource, /open_capital_declaration_instance/);
  assert.match(viewSource, /nx-co-sheet__date-field-plus/);
});

test('editable annual/capital date field is a full-area operable native input', () => {
  // Real native date input for editable applicable cells.
  assert.match(viewSource, /type="date"/);
  assert.match(viewSource, /nx-co-sheet__date-field-input/);
  // Disabled only from backend/edit gates — no invented applicability math.
  assert.match(
    viewSource,
    /disabled = !canEdit \|\| !col\.editable \|\| !operationalCell\.editable \|\| !onRegistryCommand/,
  );
  assert.doesNotMatch(viewSource, /resolveAnnualReportTaxYearForOperationalPeriod/);
  // id/name for accessibility (DevTools form-field warning).
  assert.match(viewSource, /id=\{dateInputId\}/);
  assert.match(viewSource, /name=\{dateInputName\}/);
  assert.match(viewSource, /co-date-\$\{col\.key\}-\$\{r\.client_id\}/);
  // Full interactive area: overlay covers the field; decorative chrome ignores pointer events.
  assert.match(cssSource, /\.nx-co-sheet__date-field-input\s*\{[\s\S]*?inset:\s*0/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-input\s*\{[\s\S]*?z-index:\s*2/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-input\s*\{[\s\S]*?opacity:\s*0\.01/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-value\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-icon\s*\{[\s\S]*?pointer-events:\s*none/);
  // Chromium/Opera: full-field calendar-picker-indicator hit target (field + icon area).
  assert.match(
    cssSource,
    /::-webkit-calendar-picker-indicator\s*\{[\s\S]*?inset:\s*0[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/,
  );
  // Progressive showPicker once per pointerdown gesture (not click-only).
  // Note: this environment cannot literally open Chromium's native picker UI.
  assert.match(viewSource, /tryShowNativeDatePicker/);
  assert.match(viewSource, /onPointerDown=\{[\s\S]*?tryShowNativeDatePicker/);
  assert.match(viewSource, /showPicker/);
  // Annual + open capital share the SAME date-field branch (one component pattern).
  assert.match(viewSource, /col\.key === 'annual_report' \? 'annual_report' : 'capital_declaration'/);
  // Capital no-open: + only, no active date input in that branch.
  assert.match(viewSource, /nx-co-sheet__date-field-plus/);
  assert.match(viewSource, /open_capital_declaration_instance/);
  const noOpenBranch = viewSource.slice(
    viewSource.indexOf("if (!operationalCell?.applicable)"),
    viewSource.indexOf("const dateInputId"),
  );
  assert.match(noOpenBranch, /nx-co-sheet__date-field-plus/);
  assert.doesNotMatch(noOpenBranch, /type="date"/);
  assert.doesNotMatch(noOpenBranch, /showPicker/);
  assert.doesNotMatch(noOpenBranch, /tryShowNativeDatePicker/);
});

test('date field click paths reach showPicker helper; change maps to named commands', () => {
  // Field / icon are not interactive themselves — native input covers them.
  assert.match(viewSource, /nx-co-sheet__date-field-value/);
  assert.match(viewSource, /nx-co-sheet__date-field-icon/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-value\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(cssSource, /\.nx-co-sheet__date-field-icon\s*\{[\s\S]*?pointer-events:\s*none/);
  // Pointerdown on the overlay input is the showPicker entry (field click + icon area).
  const editableBranch = viewSource.slice(
    viewSource.indexOf('const dateInputId'),
    viewSource.indexOf("if (col.cell_kind === 'checkbox' && col.key === 'material_brought')"),
  );
  assert.match(editableBranch, /onPointerDown=\{[\s\S]*?tryShowNativeDatePicker/);
  assert.match(editableBranch, /setOperationalTargetDate/);
  assert.match(viewSource, /set_annual_report_operational_target_date/);
  assert.match(viewSource, /set_capital_declaration_operational_target_date/);
  // + open path remains separate and command-named.
  assert.match(viewSource, /open_capital_declaration_instance/);
});

test('operational date commands use existing registry command endpoint names', () => {
  assert.match(viewSource, /set_annual_report_operational_target_date/);
  assert.match(viewSource, /set_capital_declaration_operational_target_date/);
  assert.match(viewSource, /open_capital_declaration_instance/);
});

test('ב״ל ניכויים renders backend 102/100/126 cell without inventing month/cycle logic', () => {
  assert.match(viewSource, /national_insurance_deductions_cell/);
  assert.match(viewSource, /set_ni_deductions_reported_102/);
  assert.match(viewSource, /set_ni_deductions_reported_100/);
  assert.match(viewSource, /complete_ni_deductions_126_cycle/);
  // Frontend must not invent monthly 126 storage or cycle identity.
  assert.doesNotMatch(viewSource, /\breported_126\b/);
  assert.doesNotMatch(viewSource, /reporting_year\s*[:=]/);
  assert.doesNotMatch(viewSource, /cycle_type\s*[:=]/);
  assert.doesNotMatch(cssSource, /ni-deductions-102|ni-deductions-checkboxes/);
});

test('existing material, hidden obligations tab, and month tabs contracts remain intact', () => {
  assert.match(viewSource, /set_material_brought/);
  assert.match(viewSource, /set_income_tax_advance_material_brought/);
  assert.match(viewSource, /set_payroll_material_brought/);
  assert.match(viewSource, />חומר</);
  assert.match(
    panelSource,
    /HIDDEN_WORKSPACE_NAV_TAB_KEYS\s*=\s*new Set<WorkspaceTabKey>\(\['obligations'\]\)/,
  );
  assert.match(viewSource, /ClientOperationsPeriodSheetTabs/);
  assert.ok((viewSource.match(/ClientOperationsPeriodSheetTabs/g) || []).length >= 2);
  assert.match(tabsSource, /onSelectPeriod/);
  assert.match(tabsSource, /פתח/);
});
