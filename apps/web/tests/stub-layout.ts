/**
 * jsdom reports a zero rectangle for every element, which leaves dnd-kit without geometry for
 * collision detection and keyboard navigation. This stub lays the configuration page out as a
 * vertical stack: AVAILABLE CHANNELS entries at x = 0, CHANNEL ORDER blocks at x = 500 starting
 * `STUB_LIST_PADDING` below the list's top edge, each row `STUB_ROW_HEIGHT` tall and group blocks
 * spanning their header and members. Rectangles are recomputed on every call, so they follow the
 * DOM.
 *
 * The layout above is where elements *belong*. A real `getBoundingClientRect` also includes any
 * transform in effect, and the FLIP list leans on that: it measures natural positions by taking
 * the transform back out again. So a rectangle from the layout below is shifted by whatever the
 * element and its flip ancestors currently translate by, or a running tween would read as a
 * layout change and the list would animate moves that never happened.
 *
 * Every call walks the lists, and dnd-kit measures constantly, so this runs thousands of times in
 * one drag: it reads direct children rather than querying, which keeps each call proportional to
 * the number of rows instead of the number of nodes. The rows carry a collapsed menu of their own
 * these days, and a descendant query pays for every option in it on every measurement.
 */

import { flipTranslateOf } from '../src/features/settings/flip-geometry.js';

export const STUB_ROW_HEIGHT = 40;
export const STUB_ROW_WIDTH = 400;
/** Root slots are short bands overlaying the top of the block below a boundary. */
export const STUB_SLOT_HEIGHT = 16;
/**
 * The slot of an empty view takes the space the list has left. It is laid out below whatever
 * precedes it and given a few rows' worth of height, so its centre is below every AVAILABLE
 * entry and a keyboard drag reaches it with ArrowDown.
 */
export const STUB_FILL_SLOT_HEIGHT = 3 * STUB_ROW_HEIGHT;
/**
 * Space the list keeps above its first and below its last row. It is wider than the auto-scroll
 * edge zone, so a pointer over the first or last row does not scroll the list: jsdom accepts any
 * `scrollTop`, and each scroll step would re-measure every droppable.
 */
export const STUB_LIST_PADDING = 2 * STUB_ROW_HEIGHT;
const LIST_LEFT = 500;

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function layoutRects(): Map<Element, DOMRect> {
  const rects = new Map<Element, DOMRect>();
  const checklist = document.querySelector('.channel-checklist');
  let entry = 0;
  for (const label of checklist?.children ?? []) {
    if (!(label instanceof HTMLElement) || label.dataset.availableChannelId === undefined) {
      continue;
    }
    // Level with the list's rows, so a keyboard pickup starts beside a row of the same index.
    const y = STUB_LIST_PADDING + entry * STUB_ROW_HEIGHT;
    rects.set(label, rect(0, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
    entry += 1;
  }
  const list = document.querySelector('.view-channel-list');
  let y = STUB_LIST_PADDING;
  for (const block of list?.children ?? []) {
    if (block.classList.contains('view-group')) {
      const start = y;
      y += STUB_ROW_HEIGHT;
      const list = [...block.children].find((child) =>
        child.classList.contains('view-group__members'),
      );
      const members = list === undefined ? [] : [...list.children];
      for (const row of members) {
        rects.set(row, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
        y += STUB_ROW_HEIGHT;
      }
      // An empty group shows its "assign channels" body; a collapsed one is only its header.
      if (members.length === 0 && !block.classList.contains('is-collapsed')) {
        y += STUB_ROW_HEIGHT;
      }
      rects.set(block, rect(LIST_LEFT, start, STUB_ROW_WIDTH, y - start));
    } else if (block.classList.contains('root-slot--fill')) {
      // The empty-view slot is a block of its own: it follows what came before and takes space.
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_FILL_SLOT_HEIGHT));
      const band = block.firstElementChild;
      if (band !== null) {
        rects.set(band, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_FILL_SLOT_HEIGHT));
      }
      y += STUB_FILL_SLOT_HEIGHT;
    } else if (block.classList.contains('root-slot')) {
      // The slot takes no space; its band overlays the top of whatever follows.
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, 0));
      const band = block.firstElementChild;
      if (band !== null) {
        rects.set(band, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_SLOT_HEIGHT));
      }
    } else if (block.classList.contains('panel-empty')) {
      // The empty notice is a row of the list. It steps aside for a drag, so nothing drops on it.
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
      y += STUB_ROW_HEIGHT;
    } else {
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
      y += STUB_ROW_HEIGHT;
    }
  }
  if (list !== null) {
    rects.set(list, rect(LIST_LEFT, 0, STUB_ROW_WIDTH, y + STUB_LIST_PADDING));
  }
  return rects;
}

/**
 * dnd-kit positions its DragOverlay wrapper with inline `top/left/width/height` plus a
 * `translate3d` transform; jsdom does no layout, so the rect is rebuilt from those styles.
 */
function overlayRect(element: Element): DOMRect | undefined {
  if (!(element instanceof HTMLElement) || element.style.position !== 'fixed') {
    return undefined;
  }
  const { top, left, width, height, transform } = element.style;
  if (top === '' || left === '') {
    return undefined;
  }
  const shift = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(transform);
  const dx = shift === null ? 0 : Number(shift[1]);
  const dy = shift === null ? 0 : Number(shift[2]);
  return rect(
    parseFloat(left) + dx,
    parseFloat(top) + dy,
    parseFloat(width) || 0,
    parseFloat(height) || 0,
  );
}

/** Moves a laid-out rectangle by the translation the element is currently painted with. */
function withInFlightTranslate(element: Element, laidOut: DOMRect): DOMRect {
  const { x, y } = flipTranslateOf(element);
  return x === 0 && y === 0
    ? laidOut
    : rect(laidOut.left + x, laidOut.top + y, laidOut.width, laidOut.height);
}

/** Installs the layout stub and returns a function that restores the original method. */
export function stubListLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stubbed(this: Element): DOMRect {
    const laidOut = layoutRects().get(this);
    if (laidOut !== undefined) {
      return withInFlightTranslate(this, laidOut);
    }
    return (
      overlayRect(this) ??
      // dnd-kit measures the overlay's only child rather than the positioned wrapper itself.
      (this.parentElement === null ? undefined : overlayRect(this.parentElement)) ??
      rect(0, 0, 0, 0)
    );
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}
