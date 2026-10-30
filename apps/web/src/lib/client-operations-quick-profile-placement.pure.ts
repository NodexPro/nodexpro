/**
 * Viewport placement for the Client Operations Quick Profile popover.
 * Geometry only — no domain meaning.
 */

export function placeClientOperationsQuickProfilePopover(input: {
  anchor: { left: number; right: number; top: number; bottom: number };
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
}): { top: number; left: number } {
  const gap = input.gap ?? 8;
  const { anchor, popover, viewport } = input;
  const minLeft = gap;
  const maxLeft = Math.max(gap, viewport.width - popover.width - gap);
  const preferredLeft = anchor.left - popover.width - gap;
  const flipRight = anchor.right + gap;
  let left = preferredLeft;
  if (preferredLeft < minLeft) {
    const rightFits = flipRight + popover.width <= viewport.width - gap;
    left = rightFits ? flipRight : minLeft;
  }
  left = Math.min(Math.max(minLeft, left), maxLeft);

  const minTop = gap;
  const maxTop = Math.max(gap, viewport.height - popover.height - gap);
  let top = anchor.top;
  if (top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;
  return { top, left };
}
