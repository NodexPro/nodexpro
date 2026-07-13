import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeDocumentAllocationNumberField,
  defaultIncomeTaxAllocationNumberPolicy,
  validateAllocationNumberFormat,
  allocationNumberForDocumentRender,
} from '../../src/domains/income/income-document-allocation-number.pure.js';
import { INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER } from '../../src/domains/income/income.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const detailsBuilderSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);

test('allocation number field descriptor comes from backend policy', () => {
  const policy = defaultIncomeTaxAllocationNumberPolicy();
  const field = buildIncomeDocumentAllocationNumberField({
    policy,
    documentType: 'tax_invoice',
    value: null,
    canEdit: true,
    isIssued: false,
  });
  assert.equal(field.visible, true);
  assert.equal(field.editable, true);
  assert.equal(field.command_name, INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER);
  assert.equal(field.label, 'מספר הקצאה');
});

test('allocation number not applicable for receipt document type', () => {
  const field = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'receipt',
    value: '123',
    canEdit: true,
    isIssued: false,
  });
  assert.equal(field.visible, false);
  assert.equal(field.editable, false);
});

test('allocation number disabled after issue by default policy', () => {
  const field = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: '123456789',
    canEdit: true,
    isIssued: true,
  });
  assert.equal(field.editable, false);
  assert.match(field.disabled_reason ?? '', /לאחר הפקת המסמך/);
});

test('allocation number format validation accepts digits only', () => {
  assert.equal(validateAllocationNumberFormat('123456789'), null);
  assert.match(validateAllocationNumberFormat('12A34') ?? '', /ספרות בלבד/);
});

test('document render shows allocation row when field is applicable', () => {
  const visibleField = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: null,
    canEdit: true,
    isIssued: false,
  });
  assert.equal(visibleField.display_value, 'הזינו מספר הקצאה');
  const render = allocationNumberForDocumentRender(visibleField);
  assert.equal(render.visible, true);
  assert.equal(render.display, 'הזינו מספר הקצאה');

  const savedField = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: '998877665',
    canEdit: true,
    isIssued: false,
  });
  const savedRender = allocationNumberForDocumentRender(savedField);
  assert.equal(savedRender.visible, true);
  assert.equal(savedRender.display, '998877665');

  const hiddenField = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'receipt',
    value: '123',
    canEdit: true,
    isIssued: false,
  });
  const hiddenRender = allocationNumberForDocumentRender(hiddenField);
  assert.equal(hiddenRender.visible, false);
  assert.equal(hiddenRender.display, null);
});

test('named command wired for allocation number update', () => {
  assert.match(commandsSource, /INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER/);
  assert.match(commandsSource, /updateIncomeDocumentAllocationNumber/);
  assert.match(draftEditorSource, /tax_allocation_number/);
  assert.match(detailsBuilderSource, /allocation_number_field/);
  assert.match(detailsBuilderSource, /buildIncomeDocumentAllocationNumberField/);
});
