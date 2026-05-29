import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyInternalIdentifier,
  isLikelyInternalShortCode,
  publicDisplayName,
  toPublicPreviewParty,
} from '../../src/domains/income/income-document-preview-party.pure.js';

test('isLikelyInternalIdentifier detects UUIDs', () => {
  assert.equal(isLikelyInternalIdentifier('31e8d298-054d-49c0-86c4-1b9045500f8e'), true);
  assert.equal(isLikelyInternalIdentifier('לקוח בע״מ'), false);
});

test('publicDisplayName hides internal identifiers', () => {
  assert.equal(publicDisplayName('31e8d298-054d-49c0-86c4-1b9045500f8e', '—'), '—');
  assert.equal(publicDisplayName('חברת דוגמה', '—'), 'חברת דוגמה');
});

test('toPublicPreviewParty strips internal display values', () => {
  const party = toPublicPreviewParty(
    {
      display_name: 'CUST-00042',
      tax_id: '514000000',
      address: 'תל אביב',
      phone: '03-0000000',
      email: 'a@b.com',
    },
    'לקוח',
  );
  assert.equal(party.display_name, 'לקוח');
  assert.equal(party.tax_id, '514000000');
});

test('isLikelyInternalShortCode detects NYC-style codes', () => {
  assert.equal(isLikelyInternalShortCode('NYC'), true);
  assert.equal(isLikelyInternalShortCode('חברת דוגמה בע״מ'), false);
});

test('toPublicPreviewParty hides short internal code when no public business signals', () => {
  const party = toPublicPreviewParty(
    {
      display_name: 'NYC',
      tax_id: null,
      address: null,
      phone: null,
      email: null,
    },
    'לקוח',
  );
  assert.equal(party.display_name, 'לקוח');
});
