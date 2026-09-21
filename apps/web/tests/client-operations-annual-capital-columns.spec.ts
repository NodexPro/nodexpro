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

test('annual and capital columns are backend system columns after חומר and before מע״מ', () => {
  assert.match(apiPresentationSource, /key:\s*'material_brought'[\s\S]*key:\s*'annual_report'[\s\S]*key:\s*'capital_declaration'[\s\S]*key:\s*'vat'/);
  assert.match(apiPresentationSource, /key:\s*'annual_report'[\s\S]*label:\s*'דוח שנתי'[\s\S]*cell_kind:\s*'operational_date'[\s\S]*editable:\s*true/);
  assert.match(apiPresentationSource, /key:\s*'capital_declaration'[\s\S]*label:\s*'הצהרת הון'[\s\S]*cell_kind:\s*'operational_date'[\s\S]*editable:\s*true/);
  assert.match(apiPresentationSource, /annual_report:\s*textHe/);
  assert.match(apiPresentationSource, /capital_declaration:\s*textHe/);
});

test('frontend renders operational date cells without tax year math', () => {
  assert.match(viewSource, /cell_kind:\s*'folder' \| 'text' \| 'notes' \| 'custom' \| 'checkbox' \| 'operational_date'/);
  assert.match(viewSource, /annual_report_cell/);
  assert.match(viewSource, /capital_declaration_cell/);
  assert.match(viewSource, /type="date"/);
  assert.doesNotMatch(viewSource, /resolveAnnualReportTaxYearForOperationalPeriod/);
  assert.doesNotMatch(viewSource, /operational_period_key[\s\S]{0,80}split\(/);
  assert.match(apiRegistrySource, /resolveAnnualReportTaxYearForOperationalPeriod\(selectedPeriodKey\)/);
});

test('capital N/A renders dash plus open command affordance', () => {
  assert.match(viewSource, /capital_declaration_cell\?\.can_open/);
  assert.match(viewSource, /open_capital_declaration_instance/);
  assert.match(viewSource, /פתיחת הצהרת הון/);
  assert.match(viewSource, />\s*\+\s*<\/button>/);
  assert.match(viewSource, /<span className="nx-co-sheet__na">—<\/span>/);
});

test('operational date commands use existing registry command endpoint names', () => {
  assert.match(viewSource, /set_annual_report_operational_target_date/);
  assert.match(viewSource, /set_capital_declaration_operational_target_date/);
  assert.match(viewSource, /open_capital_declaration_instance/);
  assert.doesNotMatch(viewSource, /moduleClientOperationsAnnual|moduleClientOperationsCapital/);
});

test('existing material, hidden obligations tab, and month tabs contracts remain intact', () => {
  assert.match(viewSource, /set_material_brought/);
  assert.match(viewSource, /set_income_tax_advance_material_brought/);
  assert.match(viewSource, /set_payroll_material_brought/);
  assert.match(viewSource, />חומר</);
  assert.match(panelSource, /HIDDEN_WORKSPACE_NAV_TAB_KEYS\s*=\s*new Set<WorkspaceTabKey>\(\['obligations'\]\)/);
  assert.match(viewSource, /ClientOperationsPeriodSheetTabs/);
  assert.ok((viewSource.match(/ClientOperationsPeriodSheetTabs/g) || []).length >= 2);
  assert.match(tabsSource, /onSelectPeriod/);
  assert.match(tabsSource, /פתח/);
});
