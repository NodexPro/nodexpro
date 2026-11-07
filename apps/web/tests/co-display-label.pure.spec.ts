import assert from 'node:assert/strict';
import test from 'node:test';
import { fillI18n, localizeFilledLabel, localizeSystemLabel } from '../src/lib/co-display-label.pure.js';

test('localizeSystemLabel prefers t() overlay and does not keep Hebrew fallback in English', () => {
  const t = (key: string) => (key === 'clientOperations.yes' ? 'Yes' : key);
  assert.equal(localizeSystemLabel(t, 'clientOperations.yes', 'כן', 'en'), 'Yes');
  assert.equal(localizeSystemLabel(t, 'missing.key', 'כן', 'en'), 'missing.key');
  assert.equal(localizeSystemLabel(t, 'missing.key', 'כן', 'he'), 'כן');
  assert.equal(localizeSystemLabel(t, null, 'כן', 'he'), 'כן');
});

test('fillI18n substitutes template variables without changing other text', () => {
  assert.equal(fillI18n('{{count}} documents', { count: 3 }), '3 documents');
  assert.equal(fillI18n('Edit {{label}}', { label: 'Income' }), 'Edit Income');
});

test('localizeFilledLabel translates interpolated chrome via param keys', () => {
  const t = (key: string) => {
    if (key === 'clientOperations.fees.recentSummary') return '{{reason}} — {{service}}';
    if (key === 'clientOperations.fees.changeReasons.manual') return 'Manual update';
    return key;
  };
  assert.equal(
    localizeFilledLabel(
      t,
      'clientOperations.fees.recentSummary',
      'עדכון ידני — שירות',
      { reason: 'עדכון ידני', service: 'Custom' },
      { reason: 'clientOperations.fees.changeReasons.manual' },
    ),
    'Manual update — Custom',
  );
});
