import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * jsdom parses no stylesheets and computes no styles, so no other suite in this package can see
 * styles.css at all. This file is the one regression lock the touch audit has: it reads the sheet
 * as text and holds down the properties a tablet depends on — that hover styling only exists
 * where there is a pointer to hover with (a touch device otherwise leaves the last thing a finger
 * touched lit up until something else is touched), that heights are measured in units a
 * retracting address bar cannot change, and that the browser's own touch gestures stay off.
 */

// Resolved from the working directory rather than from `import.meta.url`, which Vite rewrites
// away from a file URL before this module ever runs. Vitest's root is this package.
const STYLESHEET = resolve(process.cwd(), 'src/styles.css');
const BACKSLASH = String.fromCharCode(92);

interface HoverSite {
  /** 1-based line in styles.css, so a failure names somewhere to go. */
  line: number;
  /** The selector as read so far, enough to recognise the rule. */
  selector: string;
  /** Whether one of the blocks it sits in is an `@media (hover: hover)`. */
  guarded: boolean;
}

interface CssRule {
  selector: string;
  declarations: string;
  /** The preludes of the enclosing blocks, outermost first. */
  ancestors: string[];
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** True only for a query that needs a real pointer; `not` and `(hover: none)` do not qualify. */
function guardsHover(prelude: string): boolean {
  return (
    prelude.startsWith('@media') &&
    !/\bnot\b/.test(prelude) &&
    /\(\s*hover\s*:\s*hover\s*\)/.test(prelude)
  );
}

/**
 * A character-level walk of the sheet. Four things are skipped rather than read as structure:
 * comments (two of them in this file discuss hovering), strings (`content: '{'` must not open a
 * block), anything inside parentheses (`:has()`, `calc()`, a media feature), and — once those are
 * out of the way — the braces themselves, which are what the block stack is made of.
 */
export function scanCss(css: string): { hoverSites: HoverSite[]; rules: CssRule[] } {
  const hoverSites: HoverSite[] = [];
  const rules: CssRule[] = [];
  const open: { prelude: string; bodyStart: number; ancestors: string[] }[] = [];
  let prelude = '';
  let line = 1;
  let parens = 0;
  let index = 0;

  while (index < css.length) {
    const char = css[index];

    if (char === '/' && css[index + 1] === '*') {
      index += 2;
      while (index < css.length && !(css[index] === '*' && css[index + 1] === '/')) {
        if (css[index] === '\n') {
          line += 1;
        }
        index += 1;
      }
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      while (index < css.length && css[index] !== quote) {
        index += css[index] === BACKSLASH ? 2 : 1;
      }
      index += 1;
      prelude += '""';
      continue;
    }

    if (char === '\n') {
      line += 1;
      prelude += ' ';
      index += 1;
      continue;
    }

    if (char === '(') {
      parens += 1;
      prelude += char;
      index += 1;
      continue;
    }
    if (char === ')') {
      parens = Math.max(0, parens - 1);
      prelude += char;
      index += 1;
      continue;
    }

    if (parens === 0) {
      if (char === '{') {
        open.push({
          prelude: collapse(prelude),
          bodyStart: index + 1,
          ancestors: open.map((block) => block.prelude),
        });
        prelude = '';
        index += 1;
        continue;
      }
      if (char === '}') {
        const block = open.pop();
        if (block !== undefined) {
          rules.push({
            selector: block.prelude,
            declarations: css.slice(block.bodyStart, index),
            ancestors: block.ancestors,
          });
        }
        prelude = '';
        index += 1;
        continue;
      }
      if (char === ';') {
        prelude = '';
        index += 1;
        continue;
      }
    }

    if (css.startsWith(':hover', index)) {
      hoverSites.push({
        line,
        selector: collapse(`${prelude}:hover`),
        guarded: open.some((block) => guardsHover(block.prelude)),
      });
      prelude += ':hover';
      index += ':hover'.length;
      continue;
    }

    prelude += char;
    index += 1;
  }

  return { hoverSites, rules };
}

/** The same skipping, without the parsing: a comment must not satisfy a text assertion. */
export function stripComments(css: string): string {
  let out = '';
  let index = 0;
  while (index < css.length) {
    if (css[index] === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      const comment = css.slice(index, end === -1 ? css.length : end + 2);
      // Newlines are kept so that anything counting lines downstream still can.
      out += comment.replace(/[^\n]/g, '');
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    out += css[index];
    index += 1;
  }
  return out;
}

/*
 * A viewport-height length. The digits have to sit immediately before the unit, which keeps
 * `100dvh` out — its `vh` is preceded by a `d` — while a `calc(100vh - 2rem)` that lost its `d`
 * would be caught. The lookbehind stops a number inside an identifier from reading as a length.
 * `100vw`, which this sheet uses once and legitimately, cannot match at all.
 */
const VIEWPORT_HEIGHT_UNIT = /(?<![\w.-])\d*\.?\d+vh\b/gi;

const css = readFileSync(STYLESHEET, 'utf8');
const { hoverSites, rules } = scanCss(css);

/** Every declaration of every top-level rule whose selector list names one of these. */
function declarationsFor(...selectors: string[]): string {
  return rules
    .filter(
      (rule) =>
        rule.ancestors.length === 0 &&
        rule.selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => selectors.includes(part)),
    )
    .map((rule) => rule.declarations)
    .join('\n');
}

describe('styles.css', () => {
  it('still finds the hover rules it is meant to be guarding', () => {
    // 25 at the time of the touch audit. Without this, a scanner that silently matched nothing
    // would make every assertion below pass for entirely the wrong reason.
    expect(hoverSites.length).toBeGreaterThanOrEqual(25);
  });

  it('only styles hovering where there is something to hover with', () => {
    const unguarded = hoverSites
      .filter((site) => !site.guarded)
      .map((site) => `${String(site.line)}: ${site.selector}`);
    expect(unguarded).toEqual([]);
  });

  it('measures the viewport in units an address bar cannot change', () => {
    expect(stripComments(css).match(VIEWPORT_HEIGHT_UNIT) ?? []).toEqual([]);
    expect(css).toContain('100dvh');
  });

  it('turns off the browser gestures a mixing desk must not answer to', () => {
    const root = declarationsFor('html', 'body');
    expect(root).toMatch(/overscroll-behavior:\s*none/);
    expect(root).toMatch(/touch-action:\s*manipulation/);
    expect(root).toMatch(/user-select:\s*none/);
    expect(root).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it('gives selection back to what is typed into and what is worth copying', () => {
    const selectable = declarationsFor('input', 'textarea', '[contenteditable]');
    expect(selectable).toMatch(/user-select:\s*text/);
    expect(selectable).toMatch(/-webkit-user-select:\s*text/);
    expect(declarationsFor('.connection-dialog__error')).toMatch(/user-select:\s*text/);
  });
});

describe('the stylesheet scanner', () => {
  it('reads nested queries, comments, strings and :has() the way a browser would', () => {
    const fixture = `
      /* a comment about :hover that is not a rule */
      @media (max-width: 800px) {
        @media (hover: hover) {
          .a:hover { color: red; }
        }
      }
      .b::after { content: '{ :hover }'; }
      @media (hover: none) { .c:hover { color: blue; } }
      @media (hover: hover) { .d:hover:has(select:enabled) { color: green; } }
      .e:hover { color: black; }
    `;
    expect(scanCss(fixture).hoverSites.map((site) => [site.selector, site.guarded])).toEqual([
      ['.a:hover', true],
      ['.c:hover', false],
      ['.d:hover', true],
      ['.e:hover', false],
    ]);
  });

  it('does not read a length out of a comment', () => {
    expect(stripComments('/* was 100vh */\n.a { height: 100dvh; }')).not.toMatch(
      VIEWPORT_HEIGHT_UNIT,
    );
  });
});
