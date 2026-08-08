import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedConversionTargetsForSource,
  buildConversionTargetOptions,
  conversionTypeKey,
  draftLinesFromIssuedSnapshot,
  isIncomeConversionSourceType,
  isIncomeConversionTargetType,
  isPreliminaryCancellableType,
  isTaxDocumentDirectCancelForbidden,
  resolveConversionStateKey,
} from '../../src/domains/income/income-document-conversion.pure.js';

test('A — quote conversion targets are deal/tax/tax_receipt only', () => {
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});

test('B — deal_invoice conversion targets are tax/tax_receipt only', () => {
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});

test('C — tax documents have no conversion targets and no direct cancel', () => {
  assert.deepEqual(allowedConversionTargetsForSource('tax_invoice'), []);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice_receipt'), true);
  assert.equal(isPreliminaryCancellableType('tax_invoice'), false);
});

test('D — only quote/deal are conversion sources and preliminary-cancellable', () => {
  assert.equal(isIncomeConversionSourceType('quote'), true);
  assert.equal(isIncomeConversionSourceType('deal_invoice'), true);
  assert.equal(isIncomeConversionSourceType('tax_invoice'), false);
  assert.equal(isPreliminaryCancellableType('quote'), true);
  assert.equal(isPreliminaryCancellableType('deal_invoice'), true);
  assert.equal(isPreliminaryCancellableType('receipt'), false);
});

test('E — target type guard accepts only conversion targets', () => {
  assert.equal(isIncomeConversionTargetType('deal_invoice'), true);
  assert.equal(isIncomeConversionTargetType('tax_invoice'), true);
  assert.equal(isIncomeConversionTargetType('tax_invoice_receipt'), true);
  assert.equal(isIncomeConversionTargetType('quote'), false);
  assert.equal(isIncomeConversionTargetType('receipt'), false);
});

test('F — conversion type keys are stable', () => {
  assert.equal(conversionTypeKey('quote', 'deal_invoice'), 'quote_to_deal_invoice');
  assert.equal(conversionTypeKey('quote', 'tax_invoice'), 'quote_to_tax_invoice');
  assert.equal(conversionTypeKey('deal_invoice', 'tax_invoice'), 'deal_invoice_to_tax_invoice');
});

test('G — convert options enabled only for issued + edit permission', () => {
  const enabled = buildConversionTargetOptions({
    sourceType: 'quote',
    sourceStatus: 'issued',
    canEdit: true,
  });
  assert.equal(enabled.every((t) => t.enabled), true);

  const cancelled = buildConversionTargetOptions({
    sourceType: 'quote',
    sourceStatus: 'cancelled_future',
    canEdit: true,
  });
  assert.equal(cancelled.every((t) => !t.enabled), true);

  const noEdit = buildConversionTargetOptions({
    sourceType: 'deal_invoice',
    sourceStatus: 'issued',
    canEdit: false,
  });
  assert.equal(noEdit.every((t) => !t.enabled), true);
  assert.equal(noEdit.length, 2);
});

test('H — conversion_state_key reflects cancel / active / converted', () => {
  assert.equal(
    resolveConversionStateKey({ sourceStatus: 'cancelled_future', conversionCount: 0 }),
    'cancelled',
  );
  assert.equal(
    resolveConversionStateKey({ sourceStatus: 'issued', conversionCount: 0 }),
    'active',
  );
  assert.equal(
    resolveConversionStateKey({ sourceStatus: 'issued', conversionCount: 2 }),
    'converted',
  );
});

test('I — issued lines snapshot maps to draft lines with new line ids', () => {
  const lines = draftLinesFromIssuedSnapshot(
    [
      {
        description: 'שירות',
        quantity: 2,
        unit_price_reference: 100,
        amount_reference: 200,
        price_includes_vat: false,
        vat_rate_code: 'standard',
      },
    ],
    'ILS',
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.description, 'שירות');
  assert.equal(lines[0]?.quantity, 2);
  assert.ok(lines[0]?.line_id);
  assert.notEqual(lines[0]?.line_id, 'fixed');
});

test('J — document-type tiles remain separate (no mixed preliminary key)', () => {
  // Contract: conversion matrix never invents a merged preliminary type.
  const sources = ['quote', 'deal_invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_tax_invoice'];
  for (const source of sources) {
    for (const target of allowedConversionTargetsForSource(source)) {
      assert.notEqual(target, 'preliminary');
      assert.notEqual(target, 'quote_deal');
      assert.ok(isIncomeConversionTargetType(target));
    }
  }
});
