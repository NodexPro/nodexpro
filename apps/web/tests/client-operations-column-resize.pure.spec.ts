import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeClientOperationsColumnResizeDelta,
  CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE,
  type ClientOperationsResizeHandleEdge,
  type ClientOperationsResizeDirection,
} from '../src/lib/client-operations-column-resize.pure.js';

test('handle edge constant is inline-start (matches CSS)', () => {
  assert.equal(CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE, 'inline-start');
});

test('RTL + inline-start handle: moving pointer right grows column', () => {
  const delta = computeClientOperationsColumnResizeDelta({
    startClientX: 100,
    currentClientX: 120,
    handleEdge: 'inline-start',
    direction: 'rtl',
  });
  // handle at inline-start in RTL = physical right → moving right is positive delta
  assert.equal(delta, 20);
});

test('RTL + inline-start handle: moving pointer left shrinks column', () => {
  const delta = computeClientOperationsColumnResizeDelta({
    startClientX: 120,
    currentClientX: 100,
    handleEdge: 'inline-start',
    direction: 'rtl',
  });
  assert.equal(delta, -20);
});

test('LTR + inline-start handle: moving pointer right shrinks column', () => {
  const delta = computeClientOperationsColumnResizeDelta({
    startClientX: 100,
    currentClientX: 120,
    handleEdge: 'inline-start',
    direction: 'ltr',
  });
  // handle at inline-start in LTR = physical left → moving right means pointer goes away from left edge
  assert.equal(delta, -20);
});

test('LTR + inline-end handle: moving pointer right grows column', () => {
  const delta = computeClientOperationsColumnResizeDelta({
    startClientX: 100,
    currentClientX: 130,
    handleEdge: 'inline-end',
    direction: 'ltr',
  });
  assert.equal(delta, 30);
});

test('RTL + inline-end handle: moving pointer left grows column', () => {
  const delta = computeClientOperationsColumnResizeDelta({
    startClientX: 100,
    currentClientX: 80,
    handleEdge: 'inline-end',
    direction: 'rtl',
  });
  assert.equal(delta, 20);
});

test('zero movement produces zero delta regardless of direction', () => {
  for (const direction of ['rtl', 'ltr'] as ClientOperationsResizeDirection[]) {
    for (const handleEdge of ['inline-start', 'inline-end'] as ClientOperationsResizeHandleEdge[]) {
      const delta = computeClientOperationsColumnResizeDelta({
        startClientX: 200,
        currentClientX: 200,
        handleEdge,
        direction,
      });
      assert.equal(delta, 0, `expected 0 for direction=${direction} edge=${handleEdge}`);
    }
  }
});
