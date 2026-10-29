import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import {
  isSupabaseUniqueViolation,
  looksLikePostgresErrorMessage,
  publicErrorDetails,
  publicSafeErrorMessage,
  PUBLIC_DATABASE_ERROR_MESSAGE,
  throwIfSupabaseError,
} from '../../src/shared/supabase-errors.js';

test('throwIfSupabaseError maps undefined column to schema drift AppError', () => {
  assert.throws(
    () =>
      throwIfSupabaseError(
        { code: '42703', message: 'column income_document_drafts.delivery_contact_json does not exist' },
        'loadWizardDraftRow',
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 503);
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

test('unique violation is detected by Postgres code and message', () => {
  assert.equal(isSupabaseUniqueViolation({ code: '23505', message: 'duplicate key' }), true);
  assert.equal(
    isSupabaseUniqueViolation({
      message: 'duplicate key value violates unique constraint "uq_client_annual_report_profiles_org_client_scope"',
    }),
    true,
  );
  assert.equal(isSupabaseUniqueViolation({ code: 'PGRST116', message: 'JSON object' }), false);
});

test('publicSafeErrorMessage hides Postgres structure and keeps a Hebrew user message', () => {
  const pg =
    'duplicate key value violates unique constraint "uq_client_annual_report_profiles_org_client_scope"';
  assert.equal(looksLikePostgresErrorMessage(pg), true);
  assert.equal(publicSafeErrorMessage(pg), PUBLIC_DATABASE_ERROR_MESSAGE);
  assert.equal(looksLikePostgresErrorMessage(PUBLIC_DATABASE_ERROR_MESSAGE), false);
  assert.equal(publicSafeErrorMessage('שורה לא נמצאה'), 'שורה לא נמצאה');
  assert.deepEqual(publicErrorDetails({ pg_code: '23505', pg_details: 'Key', correlation: 'ok' }), {
    correlation: 'ok',
  });
  assert.equal(publicErrorDetails({ pg_code: '23505', migration_hint: 'x' }), undefined);
});
