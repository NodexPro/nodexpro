import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyColumnMap,
  csvFromGrid,
  detectColumnMap,
  fieldForHeader,
  fileDuplicateTaxIdIndices,
  parseCsvGrid,
  preserveIdentifierText,
  templateHeaders,
  validateImportRow,
  validateImportedTaxId,
} from '../../src/domains/clients/client-import-mapping.pure.js';

const VALID_TZ = '123456782';
const VALID_TZ_LEADING = '000000018';
const VALID_TZ_2 = '000000026';

test('recognizes English and Hebrew name/tax_id headers independently of UI language', () => {
  for (const name of ['name', 'full_name', 'שם', 'שם מלא', 'שם לקוח']) {
    assert.equal(fieldForHeader(name), 'name', name);
  }
  for (const id of ['tax_id', 'תעודת זהות', 'ת.ז.', 'מספר זהות', 'ח.פ.', 'מספר עוסק']) {
    assert.equal(fieldForHeader(id), 'tax_id', id);
  }
  const en = detectColumnMap(['name', 'tax_id']);
  const he = detectColumnMap(['שם מלא', 'מספר עוסק']);
  assert.equal(en.missingRequired, false);
  assert.equal(he.missingRequired, false);
  assert.equal(en.ambiguous, false);
  assert.equal(he.ambiguous, false);
});

test('ambiguous duplicate headers require mapping instead of guessing', () => {
  const detected = detectColumnMap(['name', 'full_name', 'tax_id']);
  assert.equal(detected.collisions.includes('name'), true);
  assert.equal(detected.ambiguous, true);
  assert.equal(detected.map.name, 'name');
  assert.equal(detected.map.tax_id, 'tax_id');
});

test('required fields are only name and tax_id; optional blanks still validate', () => {
  assert.deepEqual(validateImportRow({ name: 'Dana', tax_id: VALID_TZ }), []);
  assert.deepEqual(validateImportRow({ name: 'Dana', tax_id: VALID_TZ, email: '', phone: '' }), []);
  assert.equal(validateImportRow({ name: '', tax_id: VALID_TZ }).includes('NAME_MISSING'), true);
  assert.equal(validateImportRow({ name: 'Dana', tax_id: '' }).includes('TAX_ID_MISSING'), true);
});

test('known IL identifiers use checksum; other shapes stay opaque; leading zeros kept', () => {
  assert.equal(validateImportedTaxId(VALID_TZ), null);
  assert.equal(validateImportedTaxId(VALID_TZ_LEADING), null);
  assert.equal(validateImportedTaxId('123456781'), 'TAX_ID_INVALID_FORMAT');
  assert.equal(validateImportedTaxId('VAT-99-X'), null);
  assert.equal(preserveIdentifierText('  000000018  '), VALID_TZ_LEADING);
});

test('CSV UTF-8 Hebrew, extra columns, and in-file duplicates', () => {
  const csv = csvFromGrid(
    ['שם מלא', 'מספר עוסק', 'email'],
    [
      ['דנה כהן', VALID_TZ, 'dana@example.com'],
      ['רועי לוי', VALID_TZ_LEADING, ''],
      ['דנה כהן', VALID_TZ, ''],
    ],
  );
  const grid = parseCsvGrid(csv);
  const detected = detectColumnMap(grid.headers);
  const rows = applyColumnMap(grid.headers, grid.rows, detected.map);
  assert.equal(rows[0].name, 'דנה כהן');
  assert.equal(rows[1].tax_id, VALID_TZ_LEADING);
  assert.equal(rows[0].email, 'dana@example.com');
  const dups = fileDuplicateTaxIdIndices(rows);
  assert.equal(dups.has(2), true);
});

test('three isolated test clients with only required columns are valid', () => {
  const rows = [
    { name: 'Client One', tax_id: VALID_TZ },
    { name: 'לקוח שני', tax_id: VALID_TZ_LEADING },
    { name: 'Client Three', tax_id: VALID_TZ_2 },
  ];
  for (const row of rows) assert.deepEqual(validateImportRow(row), []);
  assert.equal(fileDuplicateTaxIdIndices(rows).size, 0);
});

test('templates expose only the two required columns in the active language', () => {
  assert.deepEqual(templateHeaders('en'), { name: 'name', tax_id: 'tax_id' });
  assert.deepEqual(templateHeaders('he'), { name: 'שם מלא', tax_id: 'מספר עוסק' });
});
