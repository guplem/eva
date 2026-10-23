/**
 * The rows of a line diff, for the note conflict view and the rules card. An added or removed line
 * also has a mark and a hidden word, so its colour is not the only sign.
 */
import type { ReactElement } from "react";
import type { DiffRow } from "./line-diff.ts";

const marks = {
  added: { sign: "+", word: "Added:" },
  removed: { sign: "-", word: "Removed:" },
} as const;

export function DiffLines({ rows }: { readonly rows: readonly DiffRow[] }): ReactElement {
  return (
    <div className="diff">
      {rows.map((row, index) => {
        if (row.kind === "gap") {
          return (
            <div key={index} className="gap">
              {row.count} lines that did not change
            </div>
          );
        }
        // An empty line keeps its height.
        const text = row.text === "" ? " " : row.text;
        if (row.kind === "added" || row.kind === "removed") {
          const mark = marks[row.kind];
          return (
            <div key={index} className={row.kind}>
              <span className="mark" aria-hidden="true">
                {mark.sign}
              </span>
              <span className="visually-hidden">{mark.word}</span>
              {text}
            </div>
          );
        }
        return (
          <div key={index} className={row.kind === "changed" ? "a" : undefined}>
            {text}
          </div>
        );
      })}
    </div>
  );
}
