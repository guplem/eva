/**
 * Tabs inside a dialog or a card: a row of buttons, and the panels below. By default every panel
 * stays in the page and shares one cell, so the box is as tall as the tallest panel and never jumps
 * when the person changes tab. A panel that is not shown is hidden and inert.
 *
 * The `line` look marks the shown tab with an accent line on a rule under the row, with room for
 * buttons at the right end of the row, as the Widget layout card has (#995). With `fit`, only the
 * shown panel is in the page, so the box takes the height of that panel.
 */
import { useId, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "./icons.tsx";

export interface TabSpec {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly content: ReactNode;
}

export function Tabs({
  tabs,
  selected,
  onSelect,
  label,
  look = "pill",
  actions,
  fit = false,
}: {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  /** The name of the row of tabs for a screen reader. */
  readonly label?: string;
  readonly look?: "pill" | "line";
  /** Buttons at the right end of the row of tabs. */
  readonly actions?: ReactNode;
  readonly fit?: boolean;
}): ReactElement {
  const base = useId();
  const move = (event: KeyboardEvent, index: number): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  };
  const list = (
    <div className="tab-list" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`${base}-tab-${tab.id}`}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab.id === selected}
          aria-controls={`${base}-panel-${tab.id}`}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.icon !== undefined && <Icon name={tab.icon} />}
          {tab.label}
        </button>
      ))}
    </div>
  );
  return (
    <div className={look === "line" ? "tabs tabs-line" : "tabs"}>
      {actions === undefined ? (
        list
      ) : (
        <div className="tab-row">
          {list}
          <div className="tab-actions">{actions}</div>
        </div>
      )}
      <div className="tab-panels">
        {tabs.map((tab) => {
          const shown = tab.id === selected;
          return (
            <div
              key={tab.id}
              id={`${base}-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`${base}-tab-${tab.id}`}
              className={shown ? "tab-panel" : "tab-panel hidden"}
              inert={!shown}
              hidden={fit && !shown}
            >
              {fit && !shown ? null : tab.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
