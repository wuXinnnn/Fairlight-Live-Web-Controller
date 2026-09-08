import type { CSSProperties } from 'react';

/** One colour a row or a group can be set to, described by the list that offers it. */
export interface PaletteChoice<T> {
  /** Identifies the choice inside this control; only the menu ever shows it. */
  id: string;
  /** What `onSelect` hands back when this choice is picked. */
  value: T;
  /** Accessible name of the button. The caller builds it so each list keeps its own wording. */
  ariaLabel: string;
  /** Tooltip of the button, and the menu option's text for choices that draw a swatch. */
  title: string;
  /** Word shown on the button; choices without one draw a swatch instead. */
  text?: string;
  /** Colour of the swatch, for choices that draw one. */
  swatch?: string;
  selected: boolean;
}

interface PaletteControlProps<T> {
  choices: readonly PaletteChoice<T>[];
  /** Accessible name of the menu the buttons collapse into. Must differ from every button name. */
  menuLabel: string;
  disabled?: boolean;
  onSelect(value: T): void;
}

/**
 * The colour picker of a channel row or a group header, in both of its shapes: a row of buttons
 * and the menu it collapses into once the CHANNEL ORDER column is too narrow to hold them beside
 * everything else on the line. Both are always rendered and a container query shows exactly one,
 * so the shape follows the column's width with no measuring and nothing to re-render mid-drag.
 */
export function PaletteControl<T>({
  choices,
  menuLabel,
  disabled,
  onSelect,
}: PaletteControlProps<T>) {
  const selected = choices.find((choice) => choice.selected);
  const pick = (id: string) => {
    const choice = choices.find((candidate) => candidate.id === id);
    if (choice !== undefined) {
      onSelect(choice.value);
    }
  };
  return (
    <div className="palette">
      <div className="palette-control">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.id}
            className={[
              choice.text === undefined ? '' : 'is-label',
              choice.selected ? 'is-selected' : '',
            ]
              .join(' ')
              .trim()}
            aria-label={choice.ariaLabel}
            title={choice.title}
            style={
              choice.swatch === undefined
                ? undefined
                : ({ '--swatch': choice.swatch } as CSSProperties)
            }
            onClick={() => onSelect(choice.value)}
            disabled={disabled}
          >
            {choice.text ?? <span aria-hidden="true" />}
          </button>
        ))}
      </div>
      <select
        className="palette-select"
        aria-label={menuLabel}
        value={selected?.id ?? ''}
        disabled={disabled}
        onChange={(event) => pick(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.text ?? choice.title}
          </option>
        ))}
      </select>
    </div>
  );
}
