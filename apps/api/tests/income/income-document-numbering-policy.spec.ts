import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const policySource = readFileSync(
  join(dir, '../../src/domains/income/income-document-numbering-policy.ts'),
  'utf8',
);
const numberingSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-numbering.service.ts'),
  'utf8',
);

function assertFirstNumber(docType: string, expected: number): void {
  const re = new RegExp(`${docType}:\\s*\\{[\\s\\S]*?first_number:\\s*${expected}`, 'm');
  assert.match(policySource, re, `policy for ${docType} must start at ${expected}`);
}

test('quote starts at 1000', () => assertFirstNumber('quote', 1000));
test('deal_invoice starts at 2000', () => assertFirstNumber('deal_invoice', 2000));
test('receipt starts at 3000', () => assertFirstNumber('receipt', 3000));
test('tax_invoice starts at 4000', () => assertFirstNumber('tax_invoice', 4000));
test('tax_invoice_receipt starts at 5000', () => assertFirstNumber('tax_invoice_receipt', 5000));
test('credit_tax_invoice starts at 6000', () => assertFirstNumber('credit_tax_invoice', 6000));

test('credit_tax_invoice overflow after 6999 continues 61111', () => {
  assert.match(policySource, /overflow_next:\s*61111/);
  assert.match(policySource, /currentNumber === policy\.range_end/);
});

test('numbering service scopes by issuer and represented client', () => {
  assert.match(numberingSource, /represented_client_id/);
  assert.match(numberingSource, /issuer_business_id/);
  assert.match(numberingSource, /IL_NUMBERING_POLICY_KEY/);
});

test('numbering policy module exists as backend-only policy', () => {
  assert.match(policySource, /IL_SERIES_POLICIES/);
  assert.match(policySource, /TEMPORARY_COUNTRY_PACK_PENDING/);
});
