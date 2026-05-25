import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
  reorderDraftLines,
  serializeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import { computeDraftTotalsPreview } from '../../src/domains/income/income-document-draft-totals.pure.js';
import { incomeDraftVatFallbackResolution } from '../../src/domains/income/income-draft-vat-fallback.pure.js';

test('normalizes lines with stable line_id and per-row currency', () => {
  const lines = normalizeDraftLines([
    { description: 'A', quantity: 2, unit_price_reference: 50, currency: 'USD' },
  ]);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].line_id);
  assert.equal(lines[0].currency, 'USD');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].sort_index, 0);
});

test('reorders by line_id list from backend command payload', () => {
  const a = createEmptyDraftLine(0);
  const b = createEmptyDraftLine(1);
  b.description = 'B';
  const reordered = reorderDraftLines([a, b], [b.line_id, a.line_id]);
  assert.equal(reordered[0].description, 'B');
  assert.equal(reordered[1].line_id, a.line_id);
});

test('computes draft totals preview on server (not financial truth)', async () => {
  const lines = normalizeDraftLines(serializeDraftLines([createEmptyDraftLine(0)]));
  const updated = applyLineFieldUpdate(lines, lines[0].line_id, {
    unit_price_reference: 100,
    quantity: 1,
  });
  const totals = await computeDraftTotalsPreview(
    updated,
    'ILS',
    {
      vat_mode: 'standard',
      amount_rounding: 'none',
    },
    incomeDraftVatFallbackResolution(),
    '2026-05-21',
  );
  assert.equal(totals.not_financial_truth, true);
  assert.equal(totals.vat_reference, 18);
  assert.equal(totals.grand_total_reference, 118);
});

test('add line command path appends second row with distinct line_id', () => {
  const first = createEmptyDraftLine(0);
  const lines = normalizeDraftLines(serializeDraftLines([first]));
  const withSecond = [...lines, createEmptyDraftLine(1)];
  assert.equal(withSecond.length, 2);
  assert.notEqual(withSecond[0].line_id, withSecond[1].line_id);
});
