/**
 * The personalize page: this browser's look, then the time zone, the rules for chat names and
 * the extra project folders. The text fields wait for Save; the look applies at once.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, ApiError } from "./api.ts";
import { readAppearance, saveAppearance, type Appearance } from "./appearance.ts";
import { Card, errorText, SelectField, type SettingsContext } from "./SettingsParts.tsx";

/** The server refuses longer rules, because they go to a model with each new chat. */
const chatNameRulesLength = 4_000;

const themeChoices: readonly { value: Appearance["theme"]; label: string }[] = [
  { value: "system", label: "Use the system setting" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const densityChoices: readonly { value: Appearance["density"]; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

export function PersonalizeSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <AppearanceCard />
      <PreferencesForm context={context} />
    </>
  );
}

function AppearanceCard(): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const change = (next: Partial<Appearance>): void => {
    const merged = { ...appearance, ...next };
    setAppearance(merged);
    saveAppearance(merged);
  };
  return (
    <Card item="appearance" title="Appearance" description="This browser keeps its own theme and density.">
      <SelectField
        label="Theme"
        value={appearance.theme}
        choices={themeChoices}
        onChange={(theme) => change({ theme })}
      />
      <SelectField
        label="Density"
        value={appearance.density}
        choices={densityChoices}
        onChange={(density) => change({ density })}
      />
    </Card>
  );
}

function PreferencesForm({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  const [timeZone, setTimeZone] = useState(config.timeZone ?? "");
  const [projectRoots, setProjectRoots] = useState(config.projectRoots.join("\n"));
  /** Null until loaded, and when no vault holds the rules. */
  const [chatNameRules, setChatNameRules] = useState<string | null>(null);
  /** Save sends the rules only when they changed, so it never overwrites an edit that Eva made in a chat. */
  const [savedChatNameRules, setSavedChatNameRules] = useState<string | null>(null);
  const { notify } = context;

  useEffect(() => {
    api
      .chatNameRules()
      .then((loaded) => {
        setChatNameRules(loaded.rules);
        setSavedChatNameRules(loaded.rules);
      })
      .catch((error: unknown) => {
        // Without a vault, the page shows no field for the rules.
        if (!(error instanceof ApiError && error.status === 409)) notify(errorText(error));
      });
  }, [notify]);

  const save = async (): Promise<void> => {
    // The rules save on their own, so a vault that Eva cannot write still lets the other settings save.
    let rulesProblem = "";
    if (chatNameRules !== null && chatNameRules !== savedChatNameRules) {
      try {
        const saved = (await api.saveChatNameRules(chatNameRules)).rules;
        setChatNameRules(saved);
        setSavedChatNameRules(saved);
      } catch (error) {
        rulesProblem = ` The rules for chat names were not saved: ${errorText(error)}`;
      }
    }
    try {
      const result = await api.saveSettings({
        timeZone: timeZone.trim() === "" ? null : timeZone.trim(),
        projectRoots: projectRoots
          .split("\n")
          .map((root) => root.trim())
          .filter((root) => root.length > 0),
      });
      notify((result.restartNeeded ? "Saved. Press Restart Eva to use the new settings." : "Saved.") + rulesProblem);
      context.reloadSettings();
    } catch (error) {
      notify(errorText(error) + rulesProblem);
    }
  };

  return (
    <>
      <Card item="time-zone" title="Time zone" description="Schedules and dates use it. Empty: this machine's own.">
        <label className="field">
          <span className="field-label">Time zone</span>
          <input value={timeZone} placeholder="Europe/Madrid" onChange={(event) => setTimeZone(event.target.value)} />
        </label>
      </Card>
      {chatNameRules !== null && (
        <Card
          item="chat-names"
          title="Chat names"
          description="After the first answer in a chat, a small model call names the chat by these rules. Leave the rules empty to name each chat by its first line."
        >
          <label className="field">
            <span className="field-label">Rules for chat names</span>
            <textarea
              value={chatNameRules}
              maxLength={chatNameRulesLength}
              placeholder={"Lead every name with an emoji.\nName an issue chat “Implementing #N”."}
              onChange={(event) => setChatNameRules(event.target.value)}
            />
            <span className="field-hint">The rules live in your vault, in .eva/chat-names.md.</span>
          </label>
        </Card>
      )}
      <Card item="project-folders" title="Project folders" description="Eva also looks for projects in these folders.">
        <label className="field">
          <span className="field-label">Extra project folders (one per line)</span>
          <textarea value={projectRoots} onChange={(event) => setProjectRoots(event.target.value)} />
        </label>
      </Card>
      <div className="save-bar">
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}
