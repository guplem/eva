/**
 * The manual update to a chosen version, in a dialog on a computer and a bottom sheet on a
 * phone. Each version is one row with one sentence. A major jump shows a warning first.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { UpdateStatus } from "../../../core/updates/updater.ts";
import { majorUpdateWarning, policyMovesOn } from "../../cli/client.ts";
import { Icon } from "./icons.tsx";
import { installLabel, restartNote, versionRows } from "./update-words.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { useBackLayer } from "./back-layer-hook.ts";

export function UpdateVersionDialog(props: {
  update: UpdateStatus;
  onInstall: (version: string) => void;
  onClose: () => void;
}): ReactElement {
  const { releases } = props.update;
  const [picked, setVersion] = useState(releases[0]?.version ?? "");
  // The list can change while the dialog is open: a pick that left it falls back to the newest.
  const version = releases.some((release) => release.version === picked) ? picked : (releases[0]?.version ?? "");
  const chosen = releases.find((release) => release.version === version);
  const moveOn = chosen === undefined ? null : policyMovesOn(props.update, chosen.version);
  const rows = versionRows(props.update, new Date());
  const dialog = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  // Focus starts on the picked version, so the arrow keys move the pick at once. On close, it
  // goes back to the button that opened the dialog, so a keyboard user keeps their place.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("input:checked, button")?.focus();
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

  return (
    <div
      className="dialog-backdrop update-backdrop"
      // A click inside the dialog also reaches the scrim, so only a click on the scrim itself closes it.
      onClick={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div
        ref={dialog}
        className="dialog update-version"
        role="dialog"
        aria-modal="true"
        aria-label="Update to a version"
      >
        <div className="update-version-title">
          <Visor size={28} face={chosen === undefined ? stateFaces.idle : stateFaces.news} />
          <h2>Update to a version</h2>
        </div>
        {chosen === undefined && (
          <p>Eva {props.update.current ?? "?"} is the newest version. No newer release exists.</p>
        )}
        <div className="version-list">
          {chosen !== undefined && (
            // Only the newer versions are choices, so the installed row stays out of the group.
            <div className="version-choices" role="radiogroup" aria-label="Version">
              {rows
                .filter((row) => !row.installed)
                .map((row) => (
                  <label key={row.version} className="version-row">
                    <input
                      type="radio"
                      name="update-version"
                      value={row.version}
                      checked={row.version === version}
                      onChange={() => setVersion(row.version)}
                    />
                    <VersionRowText version={row.version} day={row.day} headline={row.headline} />
                    <span className="status-pill live">New</span>
                  </label>
                ))}
            </div>
          )}
          {rows
            .filter((row) => row.installed)
            .map((row) => (
              <div key={row.version} className="version-row installed">
                <VersionRowText version={row.version} day={row.day} headline={row.headline} />
                <span className="status-pill ok">Installed</span>
              </div>
            ))}
        </div>
        {chosen !== undefined && (
          <>
            {chosen.level === "major" && (
              <div className="callout warning" role="alert">
                {majorUpdateWarning}
              </div>
            )}
            {moveOn !== null && <div className="field-hint">{moveOn}</div>}
            <details className="update-changes">
              <summary>Every change up to v{chosen.version}</summary>
              <div className="release-summary">{chosen.summary}</div>
            </details>
          </>
        )}
        <div className="update-version-actions">
          {chosen !== undefined && (
            <button className="primary large" onClick={() => props.onInstall(chosen.version)}>
              <Icon name="download" />
              {installLabel(chosen.version)}
            </button>
          )}
          <button className="ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
        {chosen !== undefined && <p className="update-note">{restartNote}</p>}
      </div>
    </div>
  );
}

export function VersionRowText(props: { version: string; day: string; headline: string }): ReactElement {
  return (
    <>
      <span className="version-number">v{props.version}</span>
      <span className="version-day">{props.day}</span>
      <span className="version-headline">{props.headline}</span>
    </>
  );
}
