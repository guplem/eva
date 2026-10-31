/**
 * The vault picker: a dialog that browses the vault, as the Files page does, to pick a folder or
 * a file. It works with a tap on a phone. A widget input uses it (#691); the Files page can later.
 * It hides each place that a widget never reaches; the core checks the pick again.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type FileEntry } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { errorText } from "./SettingsParts.tsx";
import { isPickable } from "./widget-form.ts";

function childOf(path: string, name: string): string {
  return path === "" ? name : `${path}/${name}`;
}

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function VaultPicker({
  label,
  kind,
  start,
  onPick,
  onClose,
}: {
  readonly label: string;
  readonly kind: "folder" | "file";
  /** The folder that the picker opens first: the folder of the current value, or the vault root. */
  readonly start: string;
  readonly onPick: (path: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const [path, setPath] = useState(start);
  const [entries, setEntries] = useState<readonly FileEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setEntries(null);
    setProblem(null);
    api
      .files(path)
      .then((browsed) => {
        if (!current) return;
        if (browsed.kind === "folder") setEntries(browsed.entries);
        // The start can be a file or a folder that moved: open the vault root instead.
        else setPath(parentOf(path));
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (path !== "") setPath(parentOf(path));
        else setProblem(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [path]);

  const shown = (entries ?? []).filter(
    (entry) =>
      (entry.kind === "folder" || (kind === "file" && entry.kind === "file")) && isPickable(childOf(path, entry.name)),
  );
  return (
    <Dialog label={label} closeLabel="Cancel" onClose={onClose}>
      <h2>{label}</h2>
      <div className="vault-picker">
        <div className="vault-picker-path">
          <button
            type="button"
            className="icon-button"
            aria-label="Up one folder"
            aria-disabled={path === "" ? "true" : undefined}
            onClick={() => path !== "" && setPath(parentOf(path))}
          >
            <Icon name="back" />
          </button>
          <span className="vault-picker-place">{path === "" ? "Vault" : path}</span>
        </div>
        {problem !== null && <p className="callout danger">{problem}</p>}
        {entries === null && problem === null && <ProgressBar label="Opening the folder" />}
        {entries !== null &&
          (shown.length === 0 ? (
            <div className="empty">{kind === "folder" ? "No folder here." : "No folder or file here."}</div>
          ) : (
            <ul className="files-list" aria-label={`Contents of ${path === "" ? "the vault" : path}`}>
              {shown.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    className="files-entry"
                    onClick={() =>
                      entry.kind === "folder" ? setPath(childOf(path, entry.name)) : onPick(childOf(path, entry.name))
                    }
                  >
                    <Icon name={entry.kind === "folder" ? "folder" : "file"} />
                    <span className="files-name">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {kind === "folder" && (
          <div className="button-row">
            <button
              type="button"
              className="primary"
              aria-disabled={path === "" || !isPickable(path) ? "true" : undefined}
              onClick={() => path !== "" && isPickable(path) && onPick(path)}
            >
              <Icon name="check" />
              {path === "" ? "Open a folder to pick it" : `Pick ${path}`}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
