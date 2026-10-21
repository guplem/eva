/**
 * The state of a done login: a green panel that says so, with Log out and Log in again. The login
 * steps wait behind Log in again, so a person who is logged in does not see them as a task.
 */
import { useState, type ReactElement } from "react";
import { api, type PageSecretName } from "./api.ts";
import { Dialog } from "./ChatPanel.tsx";
import { restartNote, type Note } from "./notes.ts";
import { errorText, StatusIcon, type SettingsContext } from "./SettingsParts.tsx";

/** A saved token also changes whether a login card shows as logged in, so the settings load again too. */
export function reloadAfterSave(context: SettingsContext, note: Note): void {
  context.noteAndReload(note);
  context.reloadSettings();
}

export function LoggedIn({
  service,
  secret,
  warning,
  context,
  onLogInAgain,
}: {
  /** Such as "Claude Code"; it names the panel, its buttons and its dialog. */
  readonly service: string;
  /** The saved token that Log out removes. */
  readonly secret: PageSecretName;
  /** What stops working after the log out. */
  readonly warning: string;
  readonly context: SettingsContext;
  readonly onLogInAgain: () => void;
}): ReactElement {
  const [asking, setAsking] = useState(false);
  // One request at a time: while it runs, the dialog stays and its buttons do nothing.
  const [busy, setBusy] = useState(false);

  const logOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.removeSecret(secret);
      setAsking(false);
      reloadAfterSave(context, restartNote(`Logged out of ${service}. Press Restart Eva to stop using the login.`));
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="logged-in" role="group" aria-label={`${service} login`}>
      <StatusIcon state="done" />
      <span className="logged-in-text">You are logged in to {service}.</span>
      <div className="button-row">
        <button className="ghost" onClick={onLogInAgain}>
          Log in again
        </button>
        <button className="ghost danger" aria-label={`Log out of ${service}`} onClick={() => setAsking(true)}>
          Log out
        </button>
      </div>
      {asking && (
        <Dialog label={`Log out of ${service}`} onClose={busy ? ignore : () => setAsking(false)} closeLabel="Cancel">
          <h2>Log out of {service}?</h2>
          <div className="callout warning">{warning}</div>
          <button className="danger" disabled={busy} onClick={() => void logOut()}>
            {busy ? "Logging out…" : "Log out"}
          </button>
        </Dialog>
      )}
    </div>
  );
}

function ignore(): void {
  // Nothing to do: the dialog closes when the log out ends.
}
