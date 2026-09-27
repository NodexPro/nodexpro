/**
 * Physical column-resize delta for Client Operations headers.
 * Handle edge geometry — do not blindly invert because of document.dir.
 */

export type ClientOperationsResizeHandleEdge = 'inline-start' | 'inline-end';
export type ClientOperationsResizeDirection = 'rtl' | 'ltr';

/**
 * Positive return value means the column should grow.
 * When the handle sits on the physical right edge, moving the pointer right grows the column.
 */
export function computeClientOperationsColumnResizeDelta(input: {
  startClientX: number;
  currentClientX: number;
  handleEdge: ClientOperationsResizeHandleEdge;
  direction: ClientOperationsResizeDirection;
}): number {
  const physicalDelta = input.currentClientX - input.startClientX;
  const handleIsPhysicalRight =
    (input.handleEdge === 'inline-start' && input.direction === 'rtl') ||
    (input.handleEdge === 'inline-end' && input.direction === 'ltr');
  const delta = handleIsPhysicalRight ? physicalDelta : -physicalDelta;
  // Avoid signed zero (-0) which breaks strict equality checks.
  return delta === 0 ? 0 : delta;
}

/** Current spreadsheet CSS places the handle at inset-inline-start. */
export const CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE: ClientOperationsResizeHandleEdge = 'inline-start';
