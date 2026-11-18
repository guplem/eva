/**
 * Tabs inside a dialog or a card: a row of buttons, and the panels below. Every panel stays in the
 * page and shares one cell, so the box is as tall as the tallest panel and never jumps when the
 * person changes tab. A panel that is not shown is hidden and inert.
 */
import { useId, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

export interface TabSpec {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export function Tabs({
  tabs,
  selected,
  onSelect,
}: {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
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
  return (
    <div className="tabs">
      <div className="tab-list" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            role="tab"
            className="tab"
            aria-selected={tab.id === selected}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panels">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`${base}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${base}-tab-${tab.id}`}
            className={tab.id === selected ? "tab-panel" : "tab-panel hidden"}
            inert={tab.id !== selected}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
