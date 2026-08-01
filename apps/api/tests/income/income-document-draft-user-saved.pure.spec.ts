import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientSuppliedUserSavedAt,
  isUserSavedDraftForList,
} from '../../src/domains/income/income-document-draft-user-saved.pure.js';

test('generated review (null user_saved_at) is not listable as טיוטה', () => {
  assert.equal(
    isUserSavedDraftForList({ status: 'draft', user_saved_at: null }),
    false,
  );
});

test('explicit saved draft is listable', () => {
  assert.equal(
    isUserSavedDraftForList({
      status: 'draft',
      user_saved_at: '2026-08-01T10:00:00.000Z',
    }),
    true,
  );
});

test('issued draft is not listable even if user_saved_at was set earlier', () => {
  assert.equal(
    isUserSavedDraftForList({
      status: 'issued',
      user_saved_at: '2026-08-01T10:00:00.000Z',
    }),
    false,
  );
});

test('untrusted client cannot claim user_saved_at via presence check', () => {
  assert.equal(clientSuppliedUserSavedAt({ user_saved_at: 'x' }), true);
  assert.equal(clientSuppliedUserSavedAt({ draft_id: 'a' }), false);
});
