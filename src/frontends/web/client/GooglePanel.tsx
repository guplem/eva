/**
 * The Google part of the settings: the setup steps with their links, the OAuth client, the
 * access, the login and its Test. Every step works from a phone.
 */
import { useState, type ReactElement } from "react";
import { googleSetupSteps } from "../../../core/google/google-steps.ts";
import { api, type PublicSettings } from "./api.ts";
import { CheckRow, SecretField } from "./SettingsParts.tsx";

interface GooglePanelProps {
  readonly settings: PublicSettings;
  /** Saves a settings change and reloads the settings. False when the save failed. */
  readonly saveNow: (change: Record<string, unknown>) => Promise<boolean>;
  readonly onChanged: (note: string) => void;
  /** Reads the settings again, such as the account that the login set. */
  readonly reload: () => void;
}

export function GooglePanel({ settings, saveNow, onChanged, reload }: GooglePanelProps): ReactElement {
  const google = settings.config.google;
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  // One request at a time: a double tap would start a second login and end the first one.
  const [busy, setBusy] = useState(false);
  const steps = googleSetupSteps(google.services);

  const startLogin = async (): Promise<void> => {
    setBusy(true);
    try {
      // A phone blocks a window that opens after a wait, so the page shows a link instead.
      setLoginUrl((await api.startGoogleLogin()).url);
    } catch (error) {
      onChanged(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const finishLogin = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.finishGoogleLogin(address);
      setAddress("");
      setLoginUrl(null);
      onChanged(
        `Logged in to Google as ${result.email}.${result.restartNeeded ? " Press Restart Eva to use Google in chats." : ""}`,
      );
      reload();
    } catch (error) {
      onChanged(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** The old login holds the old access, so a change needs a new login. */
  const changeAccess = async (readOnly: boolean): Promise<void> => {
    if (await saveNow({ google: { readOnly } }))
      onChanged("Saved. Log in to Google again below, then press Restart Eva.");
  };

  return (
    <>
      <h3>Google</h3>
      <div className="hint">
        Eva can use your Google Calendar, Drive, Contacts and Tasks. Google needs an OAuth client: a key that lets an
        app ask for access to your account. Each person makes their own, for free. These steps need a login with the
        token.
      </div>
      {steps.slice(0, 3).map((step) => (
        <GoogleStepView key={step.title} title={step.title} text={step.text} links={step.links} />
      ))}
      <SecretField
        name="googleOauthClientId"
        label="Google client id"
        saved={settings.secretsSet.googleOauthClientId}
        help="It ends with .apps.googleusercontent.com."
        onChanged={onChanged}
      />
      <SecretField
        name="googleOauthClientSecret"
        label="Google client secret"
        saved={settings.secretsSet.googleOauthClientSecret}
        help="It starts with GOCSPX-."
        onChanged={onChanged}
      />
      <label>
        Google access
        <select
          value={google.readOnly ? "read" : "write"}
          onChange={(event) => void changeAccess(event.target.value === "read")}
        >
          <option value="read">Read only</option>
          <option value="write">Read and change, such as add events</option>
        </select>
      </label>
      <div className="hint">
        Eva asks you before any change that reaches other people, such as an invitation. After a change of access, log
        in to Google again.
      </div>
      {steps[3] !== undefined && <GoogleStepView title={steps[3].title} text={steps[3].text} links={[]} />}
      <div>Account: {google.email ?? "none yet. The login sets it."}</div>
      <div className="check-row">
        <button disabled={busy} onClick={() => void startLogin()}>
          Start the Google login
        </button>
        {loginUrl !== null && (
          <a className="button-link" href={loginUrl} target="_blank" rel="noreferrer">
            Open Google&apos;s page
          </a>
        )}
      </div>
      {loginUrl !== null && (
        <div className="check-row">
          <input
            aria-label="The address after the Google login"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            placeholder="http://127.0.0.1/eva-google-login?state=…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button disabled={busy || address.trim() === ""} onClick={() => void finishLogin()}>
            Finish
          </button>
        </div>
      )}
      <CheckRow name="google" label="Test Google" />
    </>
  );
}

function GoogleStepView({ title, text, links }: ReturnType<typeof googleSetupSteps>[number]): ReactElement {
  return (
    <div>
      <strong>{title}</strong>
      <div className="hint">{text}</div>
      {links.length > 0 && (
        <ul className="link-list">
          {links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
