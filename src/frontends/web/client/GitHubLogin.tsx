/**
 * The GitHub browser login of the page, as in `eva setup`: GitHub gives a short code, and the
 * person types it on GitHub's page from any device. Eva saves the token herself, so the login
 * still ends well when a phone closes the page meanwhile.
 */
import { useState, type ReactElement } from "react";
import { githubLoginAccess } from "../../../core/vault/github-login.ts";
import { api, ApiError } from "./api.ts";
import { CommandLine, errorText, Steps, type SettingsContext } from "./SettingsParts.tsx";
import { ProgressBar } from "./Loading.tsx";
import { restartNote } from "./notes.ts";

/** The pause before the page asks again after a lost answer. */
const retryPauseMs = 3000;
/** GitHub's code lasts 15 minutes, so a longer wait cannot end well. */
const lastAskMs = 16 * 60_000;

export function GitHubLogin({
  context,
  onLoggedIn,
}: {
  readonly context: SettingsContext;
  /** Absent where no card hides the steps after a login. */
  readonly onLoggedIn?: () => void;
}): ReactElement {
  const [shown, setShown] = useState<{ code: string; url: string } | null>(null);
  // Blocks a second press while a request runs. After a reload, Eva gives the same code again.
  const [busy, setBusy] = useState(false);

  const logIn = async (): Promise<void> => {
    setBusy(true);
    try {
      setShown(await api.startGitHubLogin());
      await waitForTheEnd();
      context.reloadSettings();
      onLoggedIn?.();
      context.noteAndReload(restartNote("Logged in to GitHub. Press Restart Eva to use the login in chats and sync."));
    } catch (error) {
      // Eva may have saved the token before the error, as when she restarts: the card shows it.
      context.reloadSettings();
      context.reloadSetup();
      context.notify(errorText(error));
    } finally {
      setShown(null);
      setBusy(false);
    }
  };

  return (
    <Steps>
      <li>
        Eva gets a short code from GitHub.
        <div className="button-row">
          <button className="primary" disabled={busy} onClick={() => void logIn()}>
            {busy && shown === null ? "Getting the code…" : "Log in with GitHub"}
          </button>
        </div>
        {busy && shown === null && <ProgressBar label="Eva gets a code from GitHub…" />}
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
            Eva waits for GitHub, and then saves the login by herself.
          </div>
        )}
      </li>
    </Steps>
  );
}

/**
 * Waits for the end of the login. A phone can cut the long request when the browser goes to the
 * background, while Eva goes on, so the page asks again until Eva answers.
 */
async function waitForTheEnd(): Promise<void> {
  const deadline = Date.now() + lastAskMs;
  for (;;) {
    try {
      await api.finishGitHubLogin();
      return;
    } catch (error) {
      if (error instanceof ApiError || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
    }
  }
}
