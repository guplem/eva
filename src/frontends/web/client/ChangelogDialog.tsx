/**
 * The changelog: the newest releases of Eva, each with what it changed. It reads them when it
 * opens, so a phone gets them with no terminal. It has the look of the "Update to a version" dialog.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { api, type ChangelogEntry } from "./api.ts";
import { ListSkeleton } from "./Loading.tsx";
import { errorText } from "./SettingsParts.tsx";
import { releaseDay } from "./update-words.ts";
import { VersionRowText } from "./UpdateVersionDialog.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { useBackLayer } from "./back-layer-hook.ts";

export function ChangelogDialog({ onClose }: { readonly onClose: () => void }): ReactElement {
  const [entries, setEntries] = useState<readonly ChangelogEntry[] | "loading" | { failed: string }>("loading");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.changelog().then(setEntries, (error: unknown) => {
      setEntries({ failed: errorText(error) });
    });
  }, []);

  // On close, the focus goes back to the button that opened the dialog, so a keyboard user keeps their place.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useBackLayer(true, onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = new Date();
  return (
    <div
      className="dialog-backdrop update-backdrop"
      // A click inside the dialog also reaches the scrim, so only a click on the scrim itself closes it.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialog} className="dialog update-version" role="dialog" aria-modal="true" aria-label="Changelog">
        <div className="update-version-title">
          <Visor size={28} face={stateFaces.news} />
          <h2>Changelog</h2>
        </div>
        {entries === "loading" ? (
          <ListSkeleton label="Reading the releases…" rows={4} />
        ) : "failed" in entries ? (
          <div role="status" className="callout warning">
            Eva could not read the releases: {entries.failed}
          </div>
        ) : entries.length === 0 ? (
          <p>No release exists yet.</p>
        ) : (
          <div className="version-list">
            {entries.map((entry) => (
              <div key={entry.version} className="version-row">
                <VersionRowText
                  version={entry.version}
                  day={releaseDay(entry.publishedAt, now)}
                  headline={entry.headline ?? "No listed changes."}
                />
                {entry.installed && <span className="status-pill ok">Installed</span>}
                {entry.headline !== null && (
                  <details className="update-changes">
                    <summary>Every change in v{entry.version}</summary>
                    <div className="release-summary">{entry.changes}</div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="update-version-actions">
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
