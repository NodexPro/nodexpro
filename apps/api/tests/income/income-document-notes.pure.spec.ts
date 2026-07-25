import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INCOME_DOCUMENT_NOTES_HINT_HE,
  INCOME_DOCUMENT_NOTES_MAX_LENGTH,
  incomeDocumentNotesLengthError,
} from '../../src/domains/income/income-document-notes.pure.js';

test('income document notes allow up to 500 characters', () => {
  assert.equal(INCOME_DOCUMENT_NOTES_MAX_LENGTH, 500);
  assert.equal(INCOME_DOCUMENT_NOTES_HINT_HE, 'מקסימום 500 תווים');
  assert.equal(incomeDocumentNotesLengthError(null), null);
  assert.equal(incomeDocumentNotesLengthError(''), null);
  assert.equal(incomeDocumentNotesLengthError('a'.repeat(500)), null);
  assert.equal(incomeDocumentNotesLengthError('a'.repeat(501)), INCOME_DOCUMENT_NOTES_HINT_HE);
});
