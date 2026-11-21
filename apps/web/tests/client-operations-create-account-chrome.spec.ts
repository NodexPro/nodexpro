/**
 * Client Operations modals/buttons reuse Create Account (nx-register-ocean) Deep Ocean glass.
 * Does not restyle Register / office-owner / personal space.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const registerOcean = read('../src/styles/nx-office-deep-ocean.css');
const premium = read('../src/styles/nx-workspace-modal-premium.css');
const nested = read('../src/styles/nx-workspace-nested-dialogs.css');
const spreadsheet = read('../src/styles/nx-client-operations-spreadsheet.css');
const todo = read('../src/styles/nx-client-operations-todo.css');
const noteModal = read('../src/components/ClientNoteModal.tsx');
const registerPage = read('../src/pages/Register.tsx');
const officeOcean = registerOcean;

const CARD_FILL =
  /linear-gradient\(180deg, rgba\(23, 84, 122, 0\.38\) 0%, rgba\(16, 45, 73, 0\.44\) 100%\)/;
const PRIMARY_FILL =
  /linear-gradient\(180deg, rgba\(54, 169, 198, 0\.62\) 0%, rgba\(19, 191, 208, 0\.48\) 100%\)/;

test('Create Account card recipe is unchanged and is the CO chrome source', () => {
  assert.match(registerPage, /PublicAuthShell/);
  assert.match(registerPage, /nx-glass-btn nx-glass-btn--purple/);
  assert.match(officeOcean, /\.nx-register-ocean \.nx-glass-auth__card/);
  assert.match(officeOcean, /#102d49/);
  assert.match(officeOcean, CARD_FILL);
  assert.match(officeOcean, /rgba\(23, 84, 122, 0\.38\)/);
  assert.match(officeOcean, /rgba\(16, 45, 73, 0\.44\)/);
  assert.match(officeOcean, /rgba\(54, 169, 198, 0\.62\)/);
  assert.match(officeOcean, /#13bfd0/);
  assert.match(officeOcean, /rgba\(19, 191, 208, 0\.48\)/);
});

test('Client Workspace modal and nested dialogs copy Create Account glass, not electric navy', () => {
  assert.match(premium, CARD_FILL);
  assert.match(premium, /#102d49/);
  assert.doesNotMatch(premium, /#04152f/);
  assert.doesNotMatch(premium, /#277cff 0%,\s*#165dff/);
  assert.match(nested, CARD_FILL);
  assert.doesNotMatch(nested, /#04152f/);
  assert.match(nested, PRIMARY_FILL);
});

test('Registry NI/PDF/notes and ToDo chrome copy Create Account buttons', () => {
  assert.match(spreadsheet, CARD_FILL);
  assert.match(spreadsheet, PRIMARY_FILL);
  assert.match(spreadsheet, /accent-color:\s*#13bfd0/);
  assert.doesNotMatch(spreadsheet.slice(spreadsheet.indexOf('.nx-co-ni-overlay .nx-co-ni-modal.nx-clients-modal.nx-glass-card')), /#38bdf8 0%, #3b82f6/);
  assert.match(noteModal, /nx-co-ops-modal-overlay/);
  assert.match(noteModal, /nx-co-ops-modal/);
  assert.match(todo, PRIMARY_FILL);
  assert.doesNotMatch(todo, /#ffe566, #ffd24d/);
});

test('Office Deep Ocean / Register files are not rewritten as a second design system', () => {
  assert.match(officeOcean, /Scope: `\.nx-office-ocean` only/);
  assert.doesNotMatch(registerPage, /nx-workspace-modal/);
});

test('Taxes/payroll/history interiors are ocean glass, not white chips with white text', () => {
  const taxes = read('../src/styles/nx-workspace-taxes-tab.css');
  const payroll = read('../src/styles/nx-workspace-payroll-tab.css');
  const history = read('../src/styles/nx-workspace-history-tab.css');
  const annual = read('../src/styles/nx-workspace-annual-tab.css');
  assert.match(taxes, /nx-ws-taxes-row__value[\s\S]*#ffffff/);
  assert.doesNotMatch(taxes, /nx-ws-taxes-row__value[\s\S]*rgba\(255, 255, 255, 0\.94\)/);
  assert.match(taxes, /nx-ws-taxes-row--warning[\s\S]*#9a3412/);
  assert.match(payroll, CARD_FILL);
  assert.doesNotMatch(payroll, /rgba\(255, 255, 255, 0\.9\)/);
  assert.match(history, CARD_FILL);
  assert.match(annual, /nx-annual-status-chip[\s\S]*#102d49/);
});

test('Annual add-document uses CO prompt dialog, not window.prompt', () => {
  const annualSrc = read('../src/components/ClientAnnualReportTab.tsx');
  const dialogs = read('../src/components/client-operations/ClientOperationsChromeDialogs.tsx');
  const he = read('../src/i18n/he.json');
  assert.doesNotMatch(annualSrc, /window\.prompt/);
  assert.doesNotMatch(annualSrc, /window\.confirm/);
  assert.match(annualSrc, /ClientOperationsPromptDialog/);
  assert.match(annualSrc, /addDocumentNamed/);
  assert.match(dialogs, /autofocus|inputRef/);
  assert.match(dialogs, /Escape/);
  assert.match(dialogs, /Enter/);
  assert.match(he, /"addDocumentNamed": "להוסיף מסמך בשם:"/);
  assert.match(he, /"addConfirm": "הוסף"/);
});
