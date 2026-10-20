/**
 * The GitHub browser login of the page, as in `eva setup`: GitHub gives a short code, and the
 * person types it on GitHub's page from any device. Eva saves the token herself, so the login
 * still ends well when a phone closes the page meanwhile.
 */
import { useState, type ReactElement } from "react";
import { githubLoginAccess } from "../../../core/vault/github-login.ts";
import { api } from "./api.ts";
import { CommandLine, errorText, Steps, type SettingsContext } from "./SettingsParts.tsx";

export function GitHubLogin({ context }: { readonly context: SettingsContext }): ReactElement {
  const [shown, setShown] = useState<{ code: string; url: string } | null>(null);
  // One request at a time. Eva gives the same code again while a login waits, so a reload loses nothing.
  const [busy, setBusy] = useState(false);

  const logIn = async (): Promise<void> => {
    setBusy(true);
    try {
      setShown(await api.startGitHubLogin());
      await api.finishGitHubLogin();
      context.reloadSettings();
      context.noteAndReload("Logged in to GitHub. Press Restart Eva to use the login in chats and sync.");
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setShown(null);
      setBusy(false);
    }
  };

  return (
    <Steps>
      <li>
        Press Log in with GitHub. Eva gets a short code from GitHub.
        <div className="button-row">
          <button className="primary" disabled={busy} onClick={() => void logIn()}>
            {busy && shown === null ? "Getting the code…" : "Log in with GitHub"}
          </button>
        </div>
        <div className="field-hint">{githubLoginAccess}</div>
      </li>
      <li>
        Open GitHub&apos;s page on any device. Type the code there, and allow the access.
        {shown !== null && <CommandLine command={shown.code} />}
        <div className="button-row">
          {shown === null ? (
            // A disabled button keeps the place of the link, so the person sees what comes.
            <button disabled>Open GitHub&apos;s page</button>
          ) : (
            // A phone blocks a window that opens after a wait, so the page shows a link.
            <a className="button-link" href={shown.url} target="_blank" rel="noreferrer">
              Open GitHub&apos;s page
            </a>
          )}
        </div>
        {shown !== null && (
          <div className="field-hint" role="status">
            Eva waits until you allow the access on GitHub. Then she saves the login by herself.
          </div>
        )}
      </li>
    </Steps>
  );
}
