/**
 * The Google card: the setup steps with their links, the OAuth client, the access, the login and
 * its Test, in one numbered list. Every step works from a phone.
 */
import { useState, type ReactElement } from "react";
import {
  googleAccessLevels,
  googleAccessPresets,
  googleLevelLabels,
  googleServiceLabels,
  matchingGoogleAccessPreset,
  type GoogleAccessPreset,
} from "../../../core/google/google-access.ts";
import { googleSetupSteps } from "../../../core/google/google-steps.ts";
import type { EvaConfig } from "../../../core/settings/home.ts";
import { api } from "./api.ts";
import {
  Card,
  CheckRow,
  errorText,
  SecretField,
  SelectField,
  StatusPill,
  type SettingsContext,
} from "./SettingsParts.tsx";

type GoogleAccess = EvaConfig["google"]["access"];

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
  const changeAccess = async (access: Partial<GoogleAccess>): Promise<void> => {
    // Before the first login, the login itself asks for the new access.
    if ((await saveNow({ google: { access } })) && google.email !== null)
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
                <GoogleAccessFields
                  access={google.access}
                  services={google.services}
                  onChange={(access) => void changeAccess(access)}
                />
              </>
            )}
          </li>
        ))}
        {steps[3] !== undefined && (
          <li>
            <GoogleStepView title={steps[3].title} text={steps[3].text} links={[]} />
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

type PresetChoice = GoogleAccessPreset["id"] | "custom";

/** A preset select, and one select for each service that is on when the levels match no preset. */
function GoogleAccessFields({
  access,
  services,
  onChange,
}: {
  readonly access: GoogleAccess;
  readonly services: readonly (keyof GoogleAccess)[];
  readonly onChange: (access: Partial<GoogleAccess>) => void;
}): ReactElement {
  const preset = matchingGoogleAccessPreset(access, services);
  // "Custom" opens the service selects before any level differs from the preset.
  const [customOpen, setCustomOpen] = useState(false);
  const custom = customOpen || preset === null;

  const choosePreset = (choice: PresetChoice): void => {
    setCustomOpen(choice === "custom");
    const chosen = googleAccessPresets.find((candidate) => candidate.id === choice);
    if (chosen !== undefined) onChange(chosen.access);
  };

  return (
    <>
      <SelectField<PresetChoice>
        label="Google access"
        value={custom ? "custom" : preset.id}
        choices={[
          ...googleAccessPresets.map((candidate) => ({ value: candidate.id, label: candidate.label })),
          { value: "custom", label: "Custom: choose for each service" },
        ]}
        onChange={choosePreset}
        hint="Eva asks you before any change that reaches other people, such as an invitation or a sent mail. After a change of access, log in to Google again."
      />
      {custom &&
        services.map((service) => {
          const labels: Readonly<Record<string, string>> = googleLevelLabels[service];
          return (
            <SelectField<string>
              key={service}
              label={googleServiceLabels[service]}
              value={access[service]}
              choices={googleAccessLevels[service].map((level) => ({ value: level, label: labels[level] ?? level }))}
              onChange={(level) => onChange({ [service]: level })}
            />
          );
        })}
    </>
  );
}

function GoogleStepView({ title, text, links }: ReturnType<typeof googleSetupSteps>[number]): ReactElement {
  return (
    <>
      <strong>{title.replace(/^\d+\.\s*/, "")}</strong>
      <div className="field-hint">{text}</div>
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
