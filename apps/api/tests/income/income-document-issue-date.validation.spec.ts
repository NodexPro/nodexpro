import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const validationSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue-date.validation.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const webWizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);

test('backdated issue error message is Hebrew', () => {
  assert.match(
    validationSource,
    /לא ניתן להפיק מסמך בתאריך מוקדם ממסמך שכבר הונפק בסדרה זו/,
  );
});

test('issue service validates document date on backend', () => {
  assert.match(issueSource, /assertIncomeDocumentIssueDateAllowed/);
  assert.match(issueSource, /resolveIssueDateFromDraft/);
});

test('issue service does not hardcode today-only issue date', () => {
  assert.doesNotMatch(issueSource, /issue_date\s*=\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test('validation checks later issued documents in same issuer/type series', () => {
  assert.match(validationSource, /\.gt\('issue_date'/);
  assert.match(validationSource, /document_type/);
  assert.match(validationSource, /issuer_business_id/);
});

test('work engine wizard has no frontend backdate or numbering rules', () => {
  assert.doesNotMatch(webWizardSource, /61111|לא ניתן להפיק/);
  assert.match(webWizardSource, /מספר מסמך ואימות תאריך ייקבעו בהפקה בשרת/);
});
