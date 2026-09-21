import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionModuleEnabled } from '../src/lib/session-enabled-module-access.pure.ts';

test('isSessionModuleEnabled is true when code is present (case-insensitive)', () => {
  assert.equal(isSessionModuleEnabled(['docflow', 'client-operations'], 'DocFlow'), true);
  assert.equal(isSessionModuleEnabled(['DOCFLOW'], 'docflow'), true);
});

test('isSessionModuleEnabled is false when code absent or list empty', () => {
  assert.equal(isSessionModuleEnabled(['client-operations'], 'docflow'), false);
  assert.equal(isSessionModuleEnabled([], 'docflow'), false);
  assert.equal(isSessionModuleEnabled(null, 'docflow'), false);
  assert.equal(isSessionModuleEnabled(undefined, 'docflow'), false);
});

test('isSessionModuleEnabled is generic — not DocFlow-specific', () => {
  assert.equal(isSessionModuleEnabled(['invoice'], 'invoice'), true);
  assert.equal(isSessionModuleEnabled(['invoice'], 'docflow'), false);
});
