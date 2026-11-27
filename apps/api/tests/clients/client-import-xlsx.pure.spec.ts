import assert from 'node:assert/strict';
import test from 'node:test';
import { detectColumnMap, formatExcelNumericIdentifier } from '../../src/domains/clients/client-import-mapping.pure.js';
import { buildXlsxTwoColumnTemplate, parseXlsxFirstSheet } from '../../src/domains/clients/client-import-xlsx.pure.js';

test('Excel template round-trip keeps Hebrew headers and tax_id as text', () => {
  const bytes = buildXlsxTwoColumnTemplate(['שם מלא', 'מספר עוסק']);
  const grid = parseXlsxFirstSheet(bytes);
  assert.deepEqual(grid.headers, ['שם מלא', 'מספר עוסק']);
  const detected = detectColumnMap(grid.headers);
  assert.equal(detected.missingRequired, false);
  assert.match(new TextDecoder().decode(bytes), /numFmtId="164"/);
  assert.match(new TextDecoder().decode(bytes), /formatCode="@"/);
});

test('Excel English template has only the two required columns', () => {
  const bytes = buildXlsxTwoColumnTemplate(['name', 'tax_id']);
  const grid = parseXlsxFirstSheet(bytes);
  assert.deepEqual(grid.headers, ['name', 'tax_id']);
  assert.equal(grid.headers.length, 2);
});

test('numeric Excel identifiers are not rendered in scientific notation', () => {
  assert.equal(formatExcelNumericIdentifier(123456782), '123456782');
  assert.equal(formatExcelNumericIdentifier(1.23456782e8), '123456782');
  assert.doesNotMatch(formatExcelNumericIdentifier(123456782), /e/i);
});
