import assert from 'node:assert/strict';
import test from 'node:test';
import { placeClientOperationsQuickProfilePopover } from '../src/lib/client-operations-quick-profile-placement.pure';

const popover = { width: 360, height: 420 };

test('opens to the left of the client-name cell when there is room', () => {
  const pos = placeClientOperationsQuickProfilePopover({
    anchor: { left: 900, right: 1100, top: 120, bottom: 148 },
    popover,
    viewport: { width: 1440, height: 900 },
  });
  assert.equal(pos.left, 900 - 360 - 8);
  assert.ok(pos.left + popover.width <= 900);
  assert.equal(pos.top, 120);
});

test('flips to the right of the name when the left side cannot fit', () => {
  const pos = placeClientOperationsQuickProfilePopover({
    anchor: { left: 40, right: 180, top: 80, bottom: 108 },
    popover,
    viewport: { width: 1440, height: 900 },
  });
  assert.equal(pos.left, 180 + 8);
  assert.ok(pos.left >= 180);
});

test('clamps inside the viewport and does not cover the name when left is preferred', () => {
  const pos = placeClientOperationsQuickProfilePopover({
    anchor: { left: 1280, right: 1420, top: 820, bottom: 848 },
    popover,
    viewport: { width: 1440, height: 900 },
  });
  assert.ok(pos.left >= 8);
  assert.ok(pos.left + popover.width <= 1440 - 8);
  assert.ok(pos.top >= 8);
  assert.ok(pos.top + popover.height <= 900 - 8);
  assert.ok(pos.left + popover.width <= 1280);
});
