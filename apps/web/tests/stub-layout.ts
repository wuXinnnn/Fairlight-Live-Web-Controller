/**
 * jsdom reports a zero rectangle for every element, which leaves dnd-kit without geometry for
 * collision detection and keyboard navigation. This stub lays the configuration page out as a
 * vertical stack: AVAILABLE CHANNELS entries at x = 0, CHANNEL ORDER blocks at x = 500, each row
 * `STUB_ROW_HEIGHT` tall and group blocks spanning their header and members. Rectangles are
 * recomputed on every call, so they follow the DOM.
 */

export const STUB_ROW_HEIGHT = 40;
export const STUB_ROW_WIDTH = 400;
/** Root slots are short bands overlaying the top of the block below a boundary. */
export const STUB_SLOT_HEIGHT = 16;
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
  document.querySelectorAll('[data-available-channel-id]').forEach((label, index) => {
    rects.set(label, rect(0, index * STUB_ROW_HEIGHT, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
  });
  const list = document.querySelector('.view-channel-list');
  let y = 0;
  for (const block of list?.children ?? []) {
    if (block.classList.contains('view-group')) {
      const start = y;
      y += STUB_ROW_HEIGHT;
      const members = block.querySelectorAll(':scope > .view-group__members > li');
      members.forEach((row) => {
        rects.set(row, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
        y += STUB_ROW_HEIGHT;
      });
      if (members.length === 0) {
        y += STUB_ROW_HEIGHT;
      }
      rects.set(block, rect(LIST_LEFT, start, STUB_ROW_WIDTH, y - start));
    } else if (block.classList.contains('root-slot')) {
      // The slot takes no space; its band overlays the top of whatever follows.
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, 0));
      const band = block.querySelector('.root-slot__band');
      if (band !== null) {
        rects.set(band, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_SLOT_HEIGHT));
      }
    } else {
      rects.set(block, rect(LIST_LEFT, y, STUB_ROW_WIDTH, STUB_ROW_HEIGHT));
      y += STUB_ROW_HEIGHT;
    }
  }
  if (list !== null) {
    rects.set(list, rect(LIST_LEFT, 0, STUB_ROW_WIDTH, y));
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

/** Installs the layout stub and returns a function that restores the original method. */
export function stubListLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stubbed(this: Element): DOMRect {
    return (
      layoutRects().get(this) ??
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
