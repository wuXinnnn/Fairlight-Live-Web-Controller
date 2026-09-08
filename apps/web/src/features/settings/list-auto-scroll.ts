/**
 * Scroll step for a pointer near the top or bottom edge of a scroll container: negative to scroll
 * up, positive to scroll down, zero elsewhere. The step grows linearly from 0 at `edge` pixels
 * inside the container to `maxStep` at the edge, and stays at `maxStep` while the pointer is
 * up to `edge` pixels past the edge (a finger at a phone's list border often rests there).
 */
export function scrollStepFor(
  pointerY: number,
  box: { top: number; bottom: number },
  edge: number,
  maxStep: number,
): number {
  if (edge <= 0 || maxStep <= 0 || box.bottom - box.top <= 2 * edge) {
    return 0;
  }
  const fromTop = pointerY - box.top;
  if (fromTop < edge) {
    return fromTop <= -edge ? 0 : -maxStep * (1 - Math.max(fromTop, 0) / edge);
  }
  const fromBottom = box.bottom - pointerY;
  if (fromBottom < edge) {
    return fromBottom <= -edge ? 0 : maxStep * (1 - Math.max(fromBottom, 0) / edge);
  }
  return 0;
}
