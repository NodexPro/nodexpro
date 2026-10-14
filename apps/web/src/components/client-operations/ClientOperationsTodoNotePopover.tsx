/**
 * ToDo card progress-note popover (שלב טיפול) — presentation only.
 * Rendered in a portal because the sticky card clips its content (overflow hidden + transform).
 * Opens on hover, keyboard focus, or tap/click (pinned); Escape or an outside tap dismisses it.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_MAX_WIDTH = 260;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

type Placement = { left: number; top?: number; bottom?: number; width: number };

function computePlacement(anchor: DOMRect, viewportWidth: number, viewportHeight: number): Placement {
  const width = Math.min(POPOVER_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  const centered = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(centered, viewportWidth - width - VIEWPORT_MARGIN));
  // Prefer below the card; flip above when there is no room below.
  if (anchor.bottom + ANCHOR_GAP + 96 > viewportHeight && anchor.top > 96) {
    return { left, bottom: viewportHeight - anchor.top + ANCHOR_GAP, width };
  }
  return { left, top: anchor.bottom + ANCHOR_GAP, width };
}

export function ClientOperationsTodoNotePopover(props: {
  id: string;
  note: string;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { id, note, anchorRef } = props;
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      setPlacement(computePlacement(el.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, note]);

  if (!placement) return null;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      dir="rtl"
      className="nx-co-todo-note-popover"
      data-testid="client-operations-todo-note-popover"
      style={{ left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width }}
    >
      <div className="nx-co-todo-note-popover__label">שלב טיפול</div>
      <div className="nx-co-todo-note-popover__text">{note}</div>
    </div>,
    document.body,
  );
}

/** Pin/dismiss behaviour for touch + keyboard (hover and focus are tracked by the card). */
export function useDismissOnOutsidePointer(
  active: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const el = anchorRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active, anchorRef, onDismiss]);
}
