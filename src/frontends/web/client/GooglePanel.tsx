/**
 * The Google card: the setup steps with their links, the OAuth client, the access, the login and
 * its Test, in one numbered list. Every step works from a phone.
 */
import { useState, type ReactElement } from "react";
import { googleSetupSteps } from "../../../core/google/google-steps.ts";
import { api } from "./api.ts";
import { restartNote } from "./notes.ts";
import { Card, CheckRow, errorText, SecretField, StatusPill, type SettingsContext } from "./SettingsParts.tsx";

export function GooglePanel({ context }: { readonly context: SettingsContext }): ReactElement {
  const { settings, saveNow, noteAndReload: onChanged, reloadSettings: reload } = context;
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
      const loggedIn = `Logged in to Google as ${result.email}.`;
      onChanged(result.restartNeeded ? restartNote(`${loggedIn} Press Restart Eva to use Google in chats.`) : loggedIn);
      reload();
    } catch (error) {
      onChanged(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** The old login holds the old access, so a change needs a new login. */
  const changeAccess = async (readOnly: boolean): Promise<void> => {
    // Before the first login, the login itself asks for the new access.
    if ((await saveNow({ google: { readOnly } })) && google.email !== null)
      onChanged("Saved. Log in to Google again below, then press Restart Eva.");
  };

  return (
    <Card
      item="google"
      title="Google"
      description="Eva can use your Google Calendar, Drive, Contacts and Tasks. Google needs an OAuth client: a key that lets an app ask for access to your account. Each person makes their own, for free."
      aside={<StatusPill state={google.email === null ? "optional" : "done"} />}
    >
      <ol className="guide-steps">
        {steps.slice(0, 3).map((step, index) => (
          <li key={step.title}>
            <GoogleStepView title={step.title} text={step.text} links={step.links} />
            {/* The client fields sit in step 3, so the numbers match the ones that the Google check names. */}
            {index === 2 && (
              <>
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
                <label className="field">
                  <span className="field-label">Google access</span>
                  <select
                    value={google.readOnly ? "read" : "write"}
                    onChange={(event) => void changeAccess(event.target.value === "read")}
                  >
                    <option value="read">Read only</option>
                    <option value="write">Read and change, such as add events</option>
                  </select>
                  <span className="field-hint">
                    Eva asks you before any change that reaches other people, such as an invitation. After a change of
                    access, log in to Google again.
                  </span>
                </label>
              </>
            )}
          </li>
        ))}
        {steps[3] !== undefined && (
          <li>
            <GoogleStepView {...steps[3]} />
            <div className="field-hint">Account: {google.email ?? "none yet. The login sets it."}</div>
            <div className="button-row">
              <button disabled={busy} onClick={() => void startLogin()}>
                Start the Google login
              </button>
              {loginUrl !== null && (
                <a className="button-link" href={loginUrl} target="_blank" rel="noreferrer">
                  Open Google&apos;s page
                </a>
              )}
            </div>
            {/* Always here: a phone may reload the page while the person is on Google's page. */}
            <div className="inline-form">
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
              <button className="primary" disabled={busy || address.trim() === ""} onClick={() => void finishLogin()}>
                Finish
              </button>
            </div>
          </li>
        )}
      </ol>
      <CheckRow name="google" label="Test Google" />
    </Card>
  );
}

function GoogleStepView({ title, text, links, warning }: ReturnType<typeof googleSetupSteps>[number]): ReactElement {
  return (
    <>
      <strong>{title.replace(/^\d+\.\s*/, "")}</strong>
      <div className="field-hint">{text}</div>
      {warning !== undefined && <div className="callout warning">{warning}</div>}
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
    </>
  );
}
