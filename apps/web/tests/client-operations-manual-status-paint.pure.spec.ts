import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeManualStatusPaintFailure,
  completeManualStatusPaintSuccess,
  rememberManualStatusPaintIntent,
  tryStartManualStatusPaint,
  type ManualStatusPaintSlot,
} from '../src/lib/client-operations-manual-status-paint.pure.js';

test('same-cell paint: in-flight blocks parallel start; latest intent wins', () => {
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = 'c1:material_brought:2026-09';

  rememberManualStatusPaintIntent(slots, key, 'ready');
  const first = tryStartManualStatusPaint(slots, key);
  assert.deepEqual(first, { key, status: 'ready' });

  rememberManualStatusPaintIntent(slots, key, 'completed');
  assert.equal(tryStartManualStatusPaint(slots, key), null);

  const after = completeManualStatusPaintSuccess(slots, key, 'ready');
  assert.equal(after.applyAggregateRecommended, false);
  assert.deepEqual(after.startNext, { key, status: 'completed' });

  const done = completeManualStatusPaintSuccess(slots, key, 'completed');
  assert.equal(done.applyAggregateRecommended, true);
  assert.equal(done.startNext, null);
});

test('different cells may start concurrently', () => {
  const slots = new Map<string, ManualStatusPaintSlot>();
  rememberManualStatusPaintIntent(slots, 'a:vat:2026-09', 'ready');
  rememberManualStatusPaintIntent(slots, 'b:vat:2026-09', 'ready');
  assert.ok(tryStartManualStatusPaint(slots, 'a:vat:2026-09'));
  assert.ok(tryStartManualStatusPaint(slots, 'b:vat:2026-09'));
});

test('failure clears in-flight but keeps latest intent for retry', () => {
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = 'c1:user_slot_01:2026-09';
  rememberManualStatusPaintIntent(slots, key, 'sent_for_approval');
  assert.ok(tryStartManualStatusPaint(slots, key));
  completeManualStatusPaintFailure(slots, key);
  const retry = tryStartManualStatusPaint(slots, key);
  assert.deepEqual(retry, { key, status: 'sent_for_approval' });
});
