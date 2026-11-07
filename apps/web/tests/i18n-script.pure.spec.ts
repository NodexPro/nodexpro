import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayValueAllowedForLocale } from '../src/lib/i18n-script.pure.js';

test('English overlay rejects Hebrew system text and keeps brands', () => {
  assert.equal(overlayValueAllowedForLocale('Client name', 'en'), true);
  assert.equal(overlayValueAllowedForLocale('שם לקוח', 'en'), false);
  assert.equal(overlayValueAllowedForLocale('DocFlow', 'en'), true);
  assert.equal(overlayValueAllowedForLocale('Exempt dealer (עוסק פטור)', 'en'), true);
});

test('Hebrew overlay rejects English-only chrome except allowed brands', () => {
  assert.equal(overlayValueAllowedForLocale('ניהול לקוחות', 'he'), true);
  assert.equal(overlayValueAllowedForLocale('Client Operations', 'he'), false);
  assert.equal(overlayValueAllowedForLocale('DocFlow', 'he'), true);
});
