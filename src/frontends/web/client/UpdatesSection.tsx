/** The updates page: Eva's own version and policy, the Claude Code update, and a restart. */
import { useEffect, useState, type ReactElement } from "react";
import { describeEngineUpdate, describeUpdate } from "../../cli/client.ts";
import { api, type EngineUpdateStatus, type PublicSettings, type UpdateStatus } from "./api.ts";
import { Card, ChoiceChips, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { updatesFace } from "./update-words.ts";
import { UpdateVersionDialog } from "./UpdateVersionDialog.tsx";
import { Visor } from "./Visor.tsx";

type Updates = PublicSettings["config"]["updates"];

const updateChoices: readonly { value: Updates["frequency"]; label: string }[] = [
  { value: "off", label: "Never" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

const installChoices: readonly { value: Updates["install"]; label: string }[] = [
  { value: "patch", label: "Fixes only" },
  { value: "minor", label: "Fixes and new features" },
  { value: "major", label: "Every release, even major ones" },
];

const statusPollMs = 3_000;
const restartPollLimit = 60;

export function UpdatesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <EvaUpdatesCard context={context} />
      <EngineUpdateCard />
      <RestartCard context={context} />
    </>
  );
}

function EvaUpdatesCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickingVersion, setPickingVersion] = useState(false);
  /** Only an answer from the new Eva proves the install, so only then does the card look happy. */
  const [restarted, setRestarted] = useState(false);

  // A fresh status says again what waits, so the happy face of an older install ends.
  useEffect(() => {
    api
      .updateStatus()
      .then((status) => {
        setUpdate(status);
        setRestarted(false);
      })
      .catch((error: unknown) => setNote(errorText(error)));
  }, [config.updates.frequency, config.updates.install]);

  /** The old Eva answers "restarting" until she stops; only the new one answers otherwise. */
  const waitForNewEva = async (): Promise<"restarted" | "waiting" | "silent"> => {
    let answered = false;
    for (let attempt = 0; attempt < restartPollLimit; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, statusPollMs));
      try {
        const answer = await api.updateStatus();
        setUpdate(answer);
        if (answer?.phase !== "restarting") return "restarted";
        answered = true;
      } catch {
        answered = false;
      }
    }
    return answered ? "waiting" : "silent";
  };

  /** Installs `version`, or what the update policy allows when it is undefined. */
  const updateNow = async (version?: string): Promise<void> => {
    setPickingVersion(false);
    setRestarted(false);
    setNote(version === undefined ? "Checking…" : `Installing ${version}…`);
    try {
      const status = await api.updateNow(version);
      setUpdate(status);
      setNote(null);
      if (status.phase !== "restarting") return;
      setNote("Eva restarts with the new version when no chat runs…");
      const result = await waitForNewEva();
      setRestarted(result === "restarted");
      setNote(
        result === "restarted"
          ? "Eva restarted with the new version."
          : result === "waiting"
            ? "Eva restarts with the new version when no chat runs."
            : "Eva did not answer after the update. Check her log.",
      );
    } catch (error) {
      setNote(errorText(error));
    }
  };

  /** Checks first, so the dialog lists the releases of now. */
  const pickVersion = async (): Promise<void> => {
    setNote("Checking…");
    try {
      setUpdate(await api.checkForUpdate());
      setNote(null);
      setPickingVersion(true);
    } catch (error) {
      setNote(errorText(error));
    }
  };

  return (
    <Card
      item="eva-updates"
      title="Eva updates"
      description="Eva installs an update only when no chat is running, then restarts."
      aside={<Visor face={updatesFace(update, restarted)} />}
    >
      <div className="callout">{update === null ? "This Eva cannot update herself." : describeUpdate(update)}</div>
      <ChoiceChips
        label="Install updates automatically"
        value={config.updates.frequency}
        choices={updateChoices}
        onChange={(frequency) => void context.saveNow({ updates: { frequency } })}
      />
      <ChoiceChips
        label="Eva installs by herself"
        value={config.updates.install}
        choices={installChoices}
        onChange={(install) => void context.saveNow({ updates: { install } })}
      />
      {config.updates.install === "major" && (
        <div className="callout warning">
          A major update can break things that work today. With this choice, Eva installs it by herself.
        </div>
      )}
      <div className="button-row">
        <button className="primary" disabled={update === null} onClick={() => void updateNow()}>
          Check and install
        </button>
        <button disabled={update === null || update.kind === "source"} onClick={() => void pickVersion()}>
          Update to a version…
        </button>
      </div>
      {update?.kind === "source" && (
        <div className="field-hint">This Eva runs from a git checkout, so she follows the main branch.</div>
      )}
      {note !== null && <div role="status">{note}</div>}
      {pickingVersion && update !== null && (
        <UpdateVersionDialog
          update={update}
          onInstall={(version) => void updateNow(version)}
          onClose={() => setPickingVersion(false)}
        />
      )}
    </Card>
  );
}

function EngineUpdateCard(): ReactElement {
  /** Null when no claude program was found. */
  const [engineUpdate, setEngineUpdate] = useState<EngineUpdateStatus | null | "loading">("loading");
  const [note, setNote] = useState<string | null>(null);
  /** Counts the failed status reads, so a failed read asks again. */
  const [readFailures, setReadFailures] = useState(0);

  useEffect(() => {
    api.engineUpdateStatus().then(setEngineUpdate, () => {
      setReadFailures((count) => count + 1);
    });
  }, []);

  // The engine update can wait for a long turn, then download for minutes. The page asks
  // until it ends, also after a reload or a failed read on a weak phone connection.
  useEffect(() => {
    if (engineUpdate === null || (engineUpdate !== "loading" && engineUpdate.phase === "idle")) return;
    const timer = setTimeout(() => {
      api.engineUpdateStatus().then(setEngineUpdate, () => {
        setReadFailures((count) => count + 1);
      });
    }, statusPollMs);
    return () => {
      clearTimeout(timer);
    };
  }, [engineUpdate, readFailures]);

  /** Starts `claude update`; the effect above asks for its status until it ends. */
  const updateEngine = async (): Promise<void> => {
    setNote(null);
    try {
      setEngineUpdate(await api.updateEngine());
    } catch (error) {
      setNote(errorText(error));
    }
  };

  return (
    <Card item="engine-update" title="Claude Code update">
      <div role="status">
        {engineUpdate === "loading"
          ? "Claude Code: reading the update status…"
          : engineUpdate === null
            ? "No claude program was found."
            : describeEngineUpdate(engineUpdate)}
      </div>
      <div className="button-row">
        <button
          disabled={engineUpdate === "loading" || engineUpdate?.phase !== "idle"}
          onClick={() => void updateEngine()}
        >
          Update Claude Code
        </button>
      </div>
      {note !== null && <div role="status">{note}</div>}
    </Card>
  );
}

export function RestartCard({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <Card
      item="restart"
      title="Restart Eva"
      description="Eva reads new tokens and some settings only when she starts. A restart stops the running chats."
    >
      <div className="button-row">
        <button onClick={context.askRestart}>Restart now</button>
      </div>
    </Card>
  );
}
