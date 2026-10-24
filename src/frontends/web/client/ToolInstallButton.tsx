/**
 * The Install button of a missing program that Eva installs herself, so a phone needs no terminal.
 * A failure keeps its words on the card: they name the cause and the steps by hand.
 */
import { useState, type ReactElement } from "react";
import { api, type InstallableTool } from "./api.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { restartNote } from "./notes.ts";
import { errorText, type SettingsContext } from "./SettingsParts.tsx";

export function ToolInstallButton({
  program,
  name,
  context,
}: {
  readonly program: InstallableTool;
  /** The name that a person knows the program by, such as Claude Code. */
  readonly name: string;
  readonly context: SettingsContext;
}): ReactElement {
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const label = `Install ${name}`;

  const install = async (): Promise<void> => {
    setInstalling(true);
    setFailure(null);
    try {
      const result = await api.installTool(program);
      if (!result.ok) setFailure(result.message);
      // The engines start with Eva, so a chat uses a new engine program after a restart.
      else if (program === "claude" || program === "pi")
        context.noteAndReload(restartNote(`Installed ${name}. Log in on its card, then restart Eva.`));
      else context.noteAndReload(`Installed ${name}.`);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <div className="button-row">
        <button className="primary" disabled={installing} aria-busy={installing} onClick={() => void install()}>
          {installing && <ButtonSpinner />}
          {installing ? "Installing…" : label}
        </button>
      </div>
      {installing && <ProgressBar label={`Eva downloads and installs ${name}. This can take a few minutes.`} />}
      {failure !== null && (
        <div className="callout warning">
          {failure} To try again, press {label}.
        </div>
      )}
    </>
  );
}
