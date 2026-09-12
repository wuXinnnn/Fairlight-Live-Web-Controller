import { afterEach, describe, expect, it, vi } from 'vitest';
import { flipTranslateOf, naturalRect, ownTranslateOf, translateOf } from './flip-geometry.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('translateOf', () => {
  it('reads nothing from an absent or neutral transform', () => {
    expect(translateOf('')).toEqual({ x: 0, y: 0 });
    expect(translateOf('   ')).toEqual({ x: 0, y: 0 });
    expect(translateOf('none')).toEqual({ x: 0, y: 0 });
  });

  it('takes the translation components of a matrix', () => {
    expect(translateOf('matrix(1, 0, 0, 1, 12, -34)')).toEqual({ x: 12, y: -34 });
    expect(translateOf('matrix(1, 0, 0, 1, 2.5, -0.75)')).toEqual({ x: 2.5, y: -0.75 });
  });

  it('takes the 13th and 14th components of a 3d matrix', () => {
    const values = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -8.5, 16, 0, 1];
    expect(translateOf(`matrix3d(${values.join(', ')})`)).toEqual({ x: -8.5, y: 16 });
  });

  it('reads the translate forms, which is what jsdom hands back for an inline style', () => {
    expect(translateOf('translate(0px, 20px)')).toEqual({ x: 0, y: 20 });
    expect(translateOf('translate(-4.5px, -12px)')).toEqual({ x: -4.5, y: -12 });
    expect(translateOf('translate3d(3px, 7px, 0px)')).toEqual({ x: 3, y: 7 });
    expect(translateOf('translateX(9px)')).toEqual({ x: 9, y: 0 });
    expect(translateOf('translateY(-9px)')).toEqual({ x: 0, y: -9 });
  });

  it('contributes no translation for transforms it does not understand', () => {
    expect(translateOf('rotate(45deg)')).toEqual({ x: 0, y: 0 });
    expect(translateOf('scale(2)')).toEqual({ x: 0, y: 0 });
    expect(translateOf('matrix(1, 0, 0, 1)')).toEqual({ x: 0, y: 0 });
  });
});

describe('flipTranslateOf', () => {
  it('adds up the element and every flip ancestor, ignoring unmarked ones', () => {
    document.body.innerHTML = `
      <ol data-flip-key="outer" style="transform: translate(1px, 10px)">
        <li><ul data-flip-key="inner" style="transform: translate(2px, 20px)">
          <li id="plain" style="transform: translate(100px, 100px)">
            <span id="leaf" data-flip-key="leaf" style="transform: translate(4px, 40px)"></span>
          </li>
        </ul></li>
      </ol>`;
    const leaf = document.querySelector('#leaf') as HTMLElement;
    // 4 + 2 + 1 and 40 + 20 + 10: the unmarked wrapper in between contributes nothing.
    expect(flipTranslateOf(leaf)).toEqual({ x: 7, y: 70 });
    expect(ownTranslateOf(leaf)).toEqual({ x: 4, y: 40 });
  });

  it('is zero for an element with no transform anywhere above it', () => {
    document.body.innerHTML = `<div data-flip-key="a"><span id="b" data-flip-key="b"></span></div>`;
    expect(flipTranslateOf(document.querySelector('#b') as HTMLElement)).toEqual({ x: 0, y: 0 });
  });
});

describe('naturalRect', () => {
  it('takes the in-flight translation back out of the painted rectangle', () => {
    document.body.innerHTML = `
      <div data-flip-key="group" style="transform: translate(5px, 50px)">
        <p id="row" data-flip-key="row" style="transform: translate(1px, 10px)"></p>
      </div>`;
    const row = document.querySelector('#row') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 160,
      left: 26,
      right: 126,
      bottom: 200,
      width: 100,
      height: 40,
    } as DOMRect);
    // The row is painted 6px right and 60px down from where it belongs.
    expect(naturalRect(row)).toEqual({
      top: 100,
      left: 20,
      right: 120,
      bottom: 140,
      width: 100,
      height: 40,
    });
  });
});
