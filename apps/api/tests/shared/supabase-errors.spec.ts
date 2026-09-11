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

test('throwIfSupabaseError maps 42501 permission denied to 503 DB_PERMISSION', () => {
  assert.throws(
    () =>
      throwIfSupabaseError(
        {
          code: '42501',
          message: 'permission denied for table organizations',
          hint: 'Grant the required privileges to the current role with: GRANT SELECT ON public.organizations TO service_role;',
        },
        'ownerLegalControl.organizations',
        { migrationHint: 'Apply supabase/migrations/618_owner_legal_control_service_role_privileges.sql' },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 503);
      assert.equal(err.code, 'DB_PERMISSION');
      assert.match(err.message, /permission denied for table organizations/);
      assert.match(err.message, /618_owner_legal_control_service_role_privileges\.sql/);
      return true;
    },
  );
});
