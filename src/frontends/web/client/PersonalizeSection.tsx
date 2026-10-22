/**
 * The personalize page: this browser's look and sounds, the person's rules for Eva, then the time zone, the
 * rules for chat names. The text fields wait for Save; the look and the sounds apply at once.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, ApiError } from "./api.ts";
import { AssistantRulesCard } from "./AssistantRulesCard.tsx";
import { readAppearance, saveAppearance, type Appearance } from "./appearance.ts";
import {
  canVibrate,
  cues,
  playCue,
  readCueLevels,
  readCuePalette,
  saveCueLevels,
  saveCuePalette,
  type Cue,
  type CueLevels,
  type PaletteId,
  type SoundLevel,
  type VibrationLevel,
} from "./cues.ts";
import { palettes } from "./cue-palettes.ts";
import { Icon, type IconName } from "./icons.tsx";
import { SeedColourPicker } from "./SeedColourPicker.tsx";
import { Card, ChoiceChips, errorText, SelectField, type SettingsContext } from "./SettingsParts.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { restartNote } from "./notes.ts";
import { knownTimeZones, timeZoneChoices } from "./time-zones.ts";

/** The server refuses longer rules, because they go to a model with each new chat. */
const chatNameRulesLength = 4_000;

const themeChoices: readonly { value: Appearance["theme"]; label: string; icon?: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System" },
];

const densityChoices: readonly { value: Appearance["density"]; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const fileNameCutChoices: readonly { value: Appearance["fileNameCut"]; label: string }[] = [
  { value: "start", label: "Start" },
  { value: "middle", label: "Middle" },
  { value: "end", label: "End" },
];

const filesViewChoices: readonly { value: Appearance["filesView"]; label: string }[] = [
  { value: "columns", label: "Columns" },
  { value: "single", label: "One folder" },
];

export function PersonalizeSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <AppearanceCard />
      <CuesCard />
      <AssistantRulesCard context={context} />
      <PreferencesForm context={context} />
    </>
  );
}

/** The design reference shows it too, so a person sees each token change with the seed and the theme. */
export function AppearanceCard(): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const change = (next: Partial<Appearance>): void => {
    const merged = { ...appearance, ...next };
    setAppearance(merged);
    saveAppearance(merged);
  };
  return (
    <Card
      item="appearance"
      title="Appearance"
      description="This browser keeps its own colour, theme, density, files view and long file names."
    >
      <div className="field">
        <span className="field-label">Colour</span>
        <span className="field-hint">Pick a colour. Eva builds the whole palette from it.</span>
        <SeedColourPicker seed={appearance.seed} onPick={(seed) => change({ seed })} />
      </div>
      <ChoiceChips
        label="Theme"
        value={appearance.theme}
        choices={themeChoices}
        onChange={(theme) => change({ theme })}
      />
      <ChoiceChips
        label="Density"
        value={appearance.density}
        choices={densityChoices}
        onChange={(density) => change({ density })}
      />
      <ChoiceChips
        label="Files view"
        value={appearance.filesView}
        choices={filesViewChoices}
        hint="Columns show each folder of the path side by side. One folder shows only the open folder or file. A phone always shows one."
        onChange={(filesView) => change({ filesView })}
      />
      <ChoiceChips
        label="Long file names"
        hint="The Files page shows each name on one line. A name that is too long loses this part: “…board.pdf”, “Annual rep…board.pdf” or “Annual report fo…”."
        value={appearance.fileNameCut}
        choices={fileNameCutChoices}
        onChange={(fileNameCut) => change({ fileNameCut })}
      />
    </Card>
  );
}

function PreferencesForm({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  const [timeZone, setTimeZone] = useState(config.timeZone ?? "");
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

  /** True only when all of it saved: a half save shows no check. */
  const save = async (): Promise<boolean> => {
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
        timeZone: timeZone === "" ? null : timeZone,
      });
      notify(
        result.restartNeeded
          ? restartNote(`Saved. Press Restart Eva to use the new settings.${rulesProblem}`)
          : `Saved.${rulesProblem}`,
      );
      context.reloadSettings();
      return rulesProblem === "";
    } catch (error) {
      notify(errorText(error) + rulesProblem);
      return false;
    }
  };

  return (
    <>
      <Card item="time-zone" title="Time zone" description="Schedules and dates use it.">
        <SelectField
          label="Time zone"
          value={timeZone}
          choices={timeZoneChoices(timeZone, knownTimeZones())}
          onChange={setTimeZone}
        />
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
      <div className="save-bar">
        <SaveButton className="primary" onSave={save}>
          Save
        </SaveButton>
      </div>
    </>
  );
}

const soundChoices: readonly { value: SoundLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "quiet", label: "Quiet" },
  { value: "normal", label: "Normal" },
  { value: "loud", label: "Loud" },
];

const vibrationChoices: readonly { value: VibrationLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "light", label: "Light" },
  { value: "strong", label: "Strong" },
];

const cueLabels: Record<Cue, string> = {
  tap: "Tap",
  send: "Send",
  answer: "Answer",
  question: "Question",
  saved: "Saved",
  problem: "Problem",
};

const paletteChoices: readonly { value: PaletteId; label: string; icon: IconName }[] = palettes.map((palette) => ({
  value: palette.id,
  label: palette.label,
  icon: palette.icon,
}));

/** A change plays the answer cue at the new levels or style, so the person hears and feels the choice. */
function CuesCard(): ReactElement {
  const [levels, setLevels] = useState<CueLevels>(readCueLevels);
  const [palette, setPalette] = useState<PaletteId>(readCuePalette);
  const change = (next: Partial<CueLevels>): void => {
    const merged = { ...levels, ...next };
    setLevels(merged);
    saveCueLevels(merged);
    playCue("answer", merged);
  };
  const pick = (next: PaletteId): void => {
    setPalette(next);
    saveCuePalette(next);
    playCue("answer");
  };
  return (
    <Card
      item="sounds"
      title="Sounds and vibration"
      description="Eva plays a sound and the phone vibrates when you tap, send and save, and when Eva answers, asks or hits a problem. This browser keeps its own style and levels."
    >
      <ChoiceChips
        label="Style"
        value={palette}
        choices={paletteChoices}
        hint={palettes.find((candidate) => candidate.id === palette)?.sound ?? ""}
        onChange={pick}
      />
      <ChoiceChips label="Sounds" value={levels.sound} choices={soundChoices} onChange={(sound) => change({ sound })} />
      <ChoiceChips
        label="Vibration"
        value={levels.vibration}
        choices={vibrationChoices}
        hint={
          canVibrate()
            ? "A web page cannot set the strength of a vibration, so Strong vibrates longer."
            : "This browser cannot vibrate. Safari on an iPhone or an iPad never lets a web page vibrate."
        }
        onChange={(vibration) => change({ vibration })}
      />
      <div className="field">
        <span className="field-label">Try them</span>
        <div className="button-row">
          {cues.map((cue) => (
            // Each button plays its cue through `data-cue`, as every button of the page does.
            <button key={cue} type="button" className="ghost" data-cue={cue}>
              <Icon name="play" />
              {cueLabels[cue]}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
