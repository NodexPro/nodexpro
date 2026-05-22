import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { throwIfSupabaseError } from '../../src/shared/supabase-errors.js';

test('throwIfSupabaseError maps undefined column to schema drift AppError', () => {
  assert.throws(
    () =>
      throwIfSupabaseError(
        { code: '42703', message: 'column income_document_drafts.delivery_contact_json does not exist' },
        'loadWizardDraftRow',
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 500);
      assert.equal(err.code, 'DB_SCHEMA_DRIFT');
      return true;
    },
  );
});

test('throwIfSupabaseError maps invalid uuid input to 400', () => {
  assert.throws(
    () => throwIfSupabaseError({ code: '22P02', message: 'invalid input syntax for type uuid' }, 'loadIncomeRecipientById'),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'DB_INVALID_INPUT');
      return true;
    },
  );
});

test('throwIfSupabaseError is no-op when error is null', () => {
  assert.doesNotThrow(() => throwIfSupabaseError(null, 'noop'));
});
