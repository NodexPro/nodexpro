import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fillI18n,
  formatAccountingSummaryPrimaryEntry,
  localizeFilledLabel,
  localizeSystemLabel,
} from '../src/lib/co-display-label.pure.js';

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

test('formatAccountingSummaryPrimaryEntry localizes system chrome and leaves amounts and user suffix', () => {
  const t = (key: string) => {
    if (key === 'clientOperations.accounting.expenses.rent') return 'Rent';
    if (key === 'clientOperations.accounting.income.business') return 'Business';
    if (key === 'clientOperations.accounting.authorizedShort') return 'Authorized dealer';
    if (key === 'clientOperations.accounting.namedAmount') return '{{label}} {{amount}}';
    if (key === 'clientOperations.accounting.workplacesCount') return '{{n}} workplaces';
    if (key === 'clientOperations.accounting.additionalIncome') return 'Additional income';
    return key;
  };
  assert.equal(
    formatAccountingSummaryPrimaryEntry(t, {
      text_he: 'שכירות ₪3,000',
      label_he: 'שכירות',
      label_key: 'clientOperations.accounting.expenses.rent',
      amount_display: '₪3,000',
    }, 'en'),
    'Rent ₪3,000',
  );
  assert.equal(
    formatAccountingSummaryPrimaryEntry(t, {
      text_he: 'עסק (מורשה / 123456789) ₪4,000',
      label_he: 'עסק',
      label_key: 'clientOperations.accounting.income.business',
      type_he: 'מורשה',
      type_key: 'clientOperations.accounting.authorizedShort',
      suffix: '123456789',
      amount_display: '₪4,000',
    }, 'en'),
    'Business (Authorized dealer / 123456789) ₪4,000',
  );
  assert.equal(
    formatAccountingSummaryPrimaryEntry(t, {
      text_he: '2 מקומות עבודה',
      label_he: '2 מקומות עבודה',
      fill_key: 'clientOperations.accounting.workplacesCount',
      fill_params: { n: 2 },
    }, 'en'),
    '2 workplaces',
  );
  assert.equal(
    formatAccountingSummaryPrimaryEntry(t, {
      text_he: 'הכנסה נוספת',
      label_he: 'הכנסה נוספת',
      label_key: 'clientOperations.accounting.additionalIncome',
    }, 'en'),
    'Additional income',
  );
});
