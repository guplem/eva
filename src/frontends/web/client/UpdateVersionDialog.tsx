/**
 * The manual update to a chosen version: only newer releases, each with what the jump to it
 * brings, breaking changes first. A major jump shows a warning before the person confirms.
 */
import { useState, type ReactElement } from "react";
import type { UpdateStatus } from "../../../core/updates/updater.ts";
import { majorUpdateWarning } from "../../cli/client.ts";

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
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog update-version"
        role="dialog"
        aria-modal="true"
        aria-label="Update to a version"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <strong>Update to a version</strong>
        {chosen === undefined ? (
          <div>Eva {props.update.current ?? "?"} is the newest version. No newer release exists.</div>
        ) : (
          <>
            <label>
              Version (this is {props.update.current ?? "?"})
              <select value={version} onChange={(event) => setVersion(event.target.value)}>
                {releases.map((release) => (
                  <option key={release.version} value={release.version}>
                    {release.version} ({release.level})
                  </option>
                ))}
              </select>
            </label>
            {chosen.level === "major" && (
              <div className="update-warning" role="alert">
                {majorUpdateWarning}
              </div>
            )}
            <div className="release-summary">{chosen.summary}</div>
          </>
        )}
        <div className="message-actions">
          {chosen !== undefined && (
            <button className="primary" onClick={() => props.onInstall(chosen.version)}>
              Install {chosen.version}
            </button>
          )}
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
