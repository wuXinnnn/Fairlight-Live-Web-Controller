import { Fragment } from 'react';

/** One command the menu offers. Picking it runs the command; the menu keeps no value of its own. */
export interface RowMenuItem {
  /** Identifies the command; handed back to `onPick`. */
  id: string;
  text: string;
  disabled?: boolean;
  /** Marks the choice the row already sits on, for the sections that have one. */
  selected?: boolean;
}

export interface RowMenuSection {
  /** Heading above the items; commands that stand on their own leave it out. */
  label?: string;
  items: RowMenuItem[];
}

interface RowMenuProps {
  /** Accessible name of the menu. Must differ from every other control on the row. */
  label: string;
  sections: readonly RowMenuSection[];
  disabled?: boolean;
  onPick(id: string): void;
}

function options(items: RowMenuItem[]) {
  return items.map((item) => (
    <option key={item.id} value={item.id} disabled={item.disabled}>
      {/* The dot is the only way a command menu can show which choice is in force. */}
      {item.selected === true ? `• ${item.text}` : item.text}
    </option>
  ));
}

/**
 * Every control of a row or a group header, folded into one menu for a column too narrow to hold
 * them apart. It is a native `<select>` under a hamburger square: the platform draws the list, so
 * a phone gets its own picker and nothing here has to position, clip or re-render a popover. The
 * items are `<option>`s rather than a second set of buttons and comboboxes, which keeps them out
 * of the accessible names the wide shape already owns.
 */
export function RowMenu({ label, sections, disabled, onPick }: RowMenuProps) {
  return (
    <span className="row-menu">
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M2 3h8M2 6h8M2 9h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
        />
      </svg>
      <select
        aria-label={label}
        value=""
        disabled={disabled}
        onChange={(event) => {
          const id = event.target.value;
          // A command has happened, not a value been chosen: put the menu back on its placeholder.
          event.target.value = '';
          if (id !== '') {
            onPick(id);
          }
        }}
      >
        <option value="" hidden />
        {sections.map((section, position) =>
          section.label === undefined ? (
            <Fragment key={`commands-${position}`}>{options(section.items)}</Fragment>
          ) : (
            <optgroup key={section.label} label={section.label}>
              {options(section.items)}
            </optgroup>
          ),
        )}
      </select>
    </span>
  );
}
