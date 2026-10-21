/**
 * The state of a done login: a green panel that says so, with Log out and Log in again. The login
 * steps wait behind Log in again, so a person who is logged in does not see them as a task.
 */
import { useState, type ReactElement, type ReactNode } from "react";
import { Dialog } from "./ChatPanel.tsx";
import { restartNote, type Note } from "./notes.ts";
import { errorText, StatusIcon, type SettingsContext } from "./SettingsParts.tsx";

/** A saved token also changes whether a login card shows as logged in, so the settings load again too. */
export function reloadAfterSave(context: SettingsContext, note: Note): void {
  context.noteAndReload(note);
  context.reloadSettings();
}

/** The words of the panel. A bot, such as Telegram's, connects rather than logs in. */
export interface LoginWords {
  /** Such as "Log out"; the button of the panel and of the dialog. */
  readonly end: string;
  /** Such as "Log out of Google"; it names the button and the dialog. */
  readonly endTitle: string;
  /** Such as "Logged out of Google."; the note after the end. */
  readonly ended: string;
  readonly again: string;
}

export function logInWords(service: string): LoginWords {
  return {
    end: "Log out",
    endTitle: `Log out of ${service}`,
    ended: `Logged out of ${service}.`,
    again: "Log in again",
  };
}

export function LoggedIn({
  service,
  text,
  words = logInWords(service),
  warning,
  logOut,
  context,
  onLogInAgain,
}: {
  /** Such as "Claude Code"; it names the panel. */
  readonly service: string;
  /** Absent: "You are logged in to <service>." */
  readonly text?: ReactNode;
  readonly words?: LoginWords;
  /** What stops working after the log out. */
  readonly warning: string;
  /** Ends the login on Eva's computer, such as by removing its saved token. */
  readonly logOut: () => Promise<unknown>;
  readonly context: SettingsContext;
  readonly onLogInAgain: () => void;
}): ReactElement {
  const [asking, setAsking] = useState(false);
  // One request at a time: while it runs, the dialog stays and its buttons do nothing.
  const [busy, setBusy] = useState(false);

  const end = async (): Promise<void> => {
    setBusy(true);
    try {
      await logOut();
      setAsking(false);
      reloadAfterSave(context, restartNote(`${words.ended} Press Restart Eva to finish.`));
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="logged-in" role="group" aria-label={`${service} login`}>
      <StatusIcon state="done" />
      <span className="logged-in-text">{text ?? `You are logged in to ${service}.`}</span>
      <div className="button-row">
        <button className="ghost" onClick={onLogInAgain}>
          {words.again}
        </button>
        <button className="ghost danger" aria-label={words.endTitle} onClick={() => setAsking(true)}>
          {words.end}
        </button>
      </div>
      {asking && (
        <Dialog label={words.endTitle} onClose={busy ? ignore : () => setAsking(false)} closeLabel="Cancel">
          <h2>{words.endTitle}?</h2>
          <div className="callout warning">{warning}</div>
          <button className="danger" disabled={busy} onClick={() => void end()}>
            {busy ? "Working…" : words.end}
          </button>
        </Dialog>
      )}
    </div>
  );
}

function ignore(): void {
  // Nothing to do: the dialog closes when the log out ends.
}
