/**
 * Geometry helpers that read element positions as if no FLIP tween were running.
 *
 * `getBoundingClientRect` reports where an element is painted, which includes the transform a
 * tween is part-way through. Measuring that way makes a half-finished tween look like a layout
 * change, so the next commit "corrects" a move that never happened. Everything here works from
 * the natural position instead: the rect minus whatever translate is currently in effect.
 */

/** The horizontal and vertical part of a transform; FLIP only ever writes translations. */
export interface Translate {
  x: number;
  y: number;
}

const NO_TRANSLATE: Translate = { x: 0, y: 0 };

/** Elements FLIP animates. Only these carry a translate, so only these need unwinding. */
const FLIP_SELECTOR = '[data-flip-key]';

function numberAt(parts: string[], index: number): number {
  const value = Number.parseFloat(parts[index] ?? '');
  return Number.isFinite(value) ? value : 0;
}

function argumentsOf(transform: string, name: string): string[] | null {
  if (!transform.startsWith(`${name}(`) || !transform.endsWith(')')) {
    return null;
  }
  return transform.slice(name.length + 1, -1).split(',');
}

/**
 * Translation carried by one `transform` value. Browsers resolve `getComputedStyle` to a matrix,
 * but jsdom hands back whatever was written inline, so the `translate*` forms FLIP writes are
 * parsed too. Anything else (rotation, scale, a keyword) contributes no translation.
 */
export function translateOf(transform: string): Translate {
  const value = transform.trim();
  if (value.length === 0 || value === 'none') {
    return NO_TRANSLATE;
  }
  const matrix = argumentsOf(value, 'matrix');
  if (matrix !== null && matrix.length === 6) {
    return { x: numberAt(matrix, 4), y: numberAt(matrix, 5) };
  }
  const matrix3d = argumentsOf(value, 'matrix3d');
  if (matrix3d !== null && matrix3d.length === 16) {
    return { x: numberAt(matrix3d, 12), y: numberAt(matrix3d, 13) };
  }
  const translate = argumentsOf(value, 'translate') ?? argumentsOf(value, 'translate3d');
  if (translate !== null) {
    return { x: numberAt(translate, 0), y: numberAt(translate, 1) };
  }
  const x = argumentsOf(value, 'translateX');
  if (x !== null) {
    return { x: numberAt(x, 0), y: 0 };
  }
  const y = argumentsOf(value, 'translateY');
  if (y !== null) {
    return { x: 0, y: numberAt(y, 0) };
  }
  return NO_TRANSLATE;
}

/** Translation an element carries itself, ignoring anything its ancestors contribute. */
export function ownTranslateOf(element: Element): Translate {
  return translateOf(getComputedStyle(element).transform);
}

/**
 * Every translation that moved `element` away from its natural place: its own plus each
 * `[data-flip-key]` ancestor's, because a moving group block carries its members with it. This is
 * what `getBoundingClientRect` has already baked in, so it is what `naturalRect` takes back out.
 */
export function flipTranslateOf(element: Element): Translate {
  let total = ownTranslateOf(element);
  let parent = element.parentElement?.closest(FLIP_SELECTOR) ?? null;
  while (parent !== null) {
    const translate = ownTranslateOf(parent);
    total = { x: total.x + translate.x, y: total.y + translate.y };
    parent = parent.parentElement?.closest(FLIP_SELECTOR) ?? null;
  }
  return total;
}

/** Rectangle shape shared with `@dnd-kit/core`, so this can serve as a `measure` implementation. */
export interface NaturalRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function withoutTranslate(rect: DOMRect, x: number, y: number): NaturalRect {
  return {
    top: rect.top - y,
    left: rect.left - x,
    right: rect.right - x,
    bottom: rect.bottom - y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Where `element` sits with every FLIP translation unwound: its layout position. Passing this to
 * dnd-kit as the droppable measurement keeps collision detection aimed at the layout the preview
 * is settling into rather than at the half-way point of a tween.
 */
export function naturalRect(element: Element): NaturalRect {
  const { x, y } = flipTranslateOf(element);
  return withoutTranslate(element.getBoundingClientRect(), x, y);
}

/**
 * The natural position and the element's own translate together. Reading computed styles is the
 * expensive part of both, and the FLIP list wants both for every element on every commit, so
 * this walks the ancestors once instead of twice.
 */
export function naturalGeometry(element: Element): { rect: NaturalRect; own: Translate } {
  const own = ownTranslateOf(element);
  let x = own.x;
  let y = own.y;
  let parent = element.parentElement?.closest(FLIP_SELECTOR) ?? null;
  while (parent !== null) {
    const translate = ownTranslateOf(parent);
    x += translate.x;
    y += translate.y;
    parent = parent.parentElement?.closest(FLIP_SELECTOR) ?? null;
  }
  return { rect: withoutTranslate(element.getBoundingClientRect(), x, y), own };
}
