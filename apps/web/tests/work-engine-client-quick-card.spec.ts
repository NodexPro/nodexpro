import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  join(dir, '../src/components/income/IncomeClientDocumentManagementPanel.tsx'),
  'utf8',
);
const shellSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
  'utf8',
);
const popoverSource = readFileSync(
  join(dir, '../src/components/work-engine/ClientQuickCardPopover.tsx'),
  'utf8',
);
const incomePageSource = readFileSync(join(dir, '../src/pages/IncomeWorkspacePage.tsx'), 'utf8');
const incomeShellSource = readFileSync(
  join(dir, '../src/components/income/IncomeClientDocumentManagementShell.tsx'),
  'utf8',
);

describe('WE invoices Client Quick Card — FE contract', () => {
  it('WE shell enables Quick Card; /m/income shells do not', () => {
    assert.match(shellSource, /clientQuickCardEnabled/);
    assert.doesNotMatch(incomeShellSource, /clientQuickCardEnabled/);
    assert.doesNotMatch(incomePageSource, /clientQuickCardEnabled/);
  });

  it('main row hides email/tax when Quick Card enabled; keeps name + avatar', () => {
    assert.match(panelSource, /showQuickCard/);
    assert.match(panelSource, /\[row\.tax_id, row\.email\]/);
    assert.match(panelSource, /nx-income-cdm__client-name/);
    assert.match(panelSource, /nx-income-cdm__avatar/);
    assert.match(panelSource, /client_quick_card/);
  });

  it('uses one shared Quick Card renderer (no Office/EndCustomer split components)', () => {
    assert.match(popoverSource, /ClientQuickCardPopover/);
    assert.match(popoverSource, /card\.rows/);
    assert.match(popoverSource, /card\.actions/);
    assert.doesNotMatch(popoverSource, /population_key\s*===\s*['"]office_client['"]/);
    assert.doesNotMatch(popoverSource, /office_client_customer/);
    assert.doesNotMatch(panelSource, /OfficeClientQuickCard|EndCustomerQuickCard/);
  });

  it('copy uses backend copy_value; DocFlow action rendered from actions[] only', () => {
    assert.match(popoverSource, /row\.copy_value/);
    assert.match(popoverSource, /row\.copy_enabled/);
    assert.doesNotMatch(popoverSource, /invite_to_docflow/);
    assert.doesNotMatch(shellSource, /population_key[\s\S]{0,80}invite/);
  });

  it('Quick Card action routes to existing DocFlow invite command then refreshes invoices tab', () => {
    assert.match(shellSource, /kind === 'quick_card_action'/);
    assert.match(shellSource, /docflowOfficeCommands/);
    assert.match(shellSource, /fetchWorkEngineInvoicesTabAggregate/);
    assert.match(shellSource, /invite_client_to_docflow|action\.command/);
  });
});
