/** The updates page: the versions of Eva and her tools, Eva's update policy, the Claude Code update, and a restart. */
import { Fragment, useEffect, useState, type ReactElement } from "react";
import { describeEngineUpdate, describeUpdate } from "../../cli/client.ts";
import {
  ApiError,
  api,
  type EngineUpdateStatus,
  type EvaVersions,
  type PublicSettings,
  type UpdateStatus,
} from "./api.ts";
import { Card, ChoiceChips, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { FactsSkeleton, ProgressBar } from "./Loading.tsx";
import { updatesFace, updateWait } from "./update-words.ts";
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
/** A download moves fast, so the bar reads its share more often. */
const downloadPollMs = 1_000;
const restartPollLimit = 60;
/** Eva gives a download 10 minutes, so a lost answer waits a little longer than that. */
const downloadPollLimit = 220;
/** What a proxy answers when the server behind it does not. */
const gatewayErrors = new Set([502, 503, 504]);

export function UpdatesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <VersionsCard />
      <EvaUpdatesCard context={context} />
      <EngineUpdateCard />
      <RestartCard context={context} />
    </>
  );
}

/** The versions that `eva doctor` shows in a terminal, so a phone sees them too. */
function VersionsCard(): ReactElement {
  const [versions, setVersions] = useState<EvaVersions | "loading" | "failed">("loading");

  useEffect(() => {
    api.versions().then(setVersions, () => {
      setVersions("failed");
    });
  }, []);

  return (
    <Card item="versions" title="Versions" description="The version of Eva and of each tool that she uses.">
      {versions === "loading" ? (
        // About as many rows as Eva and her tools in `tool-versions.ts`, so the card keeps its height.
        <FactsSkeleton label="Reading the versions…" rows={11} />
      ) : versions === "failed" ? (
        <div role="status">Eva could not read the versions. Open this page again to retry.</div>
      ) : (
        <dl className="facts">
          <dt>Eva</dt>
          <dd>{versions.eva}</dd>
          {versions.tools.map((tool) => (
            <Fragment key={tool.program}>
              <dt title={`For ${tool.feature}`}>{tool.program}</dt>
              <dd>{tool.version ?? "Not installed"}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Card>
  );
}

function EvaUpdatesCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The sentence of a wait that this page started, such as a check. */
  const [work, setWork] = useState<string | null>(null);
  /** True while the request to update runs. It ends only after the download. */
  const [posting, setPosting] = useState(false);
  /** Counts the failed status reads, so a failed read asks again. */
  const [readFailures, setReadFailures] = useState(0);
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

  // The bar follows the download, also one that Eva started by herself or that a reload left open.
  const isBusy = update?.phase === "checking" || update?.phase === "updating";
  useEffect(() => {
    if (!posting && !isBusy) return;
    // An answer that comes after the final status of the install is older than it, so it is dropped.
    let isCurrent = true;
    const timer = setTimeout(() => {
      api.updateStatus().then(
        (status) => {
          if (isCurrent) setUpdate(status);
        },
        () => {
          if (isCurrent) setReadFailures((count) => count + 1);
        },
      );
    }, downloadPollMs);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [posting, isBusy, update, readFailures]);

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

  /**
   * The status once the install ends. A proxy on the way, such as `tailscale serve`, can close a
   * long request while the download goes on. So a lost answer reads the status until it ends.
   */
  const installResult = async (version?: string): Promise<UpdateStatus> => {
    try {
      return await api.updateNow(version);
    } catch (error) {
      // A proxy that gave up answers with a gateway error. Any other answer comes from Eva herself.
      if (error instanceof ApiError && !gatewayErrors.has(error.status)) throw error;
      for (let attempt = 0; attempt < downloadPollLimit; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, statusPollMs));
        const status = await api.updateStatus().catch(() => undefined);
        if (status === null) break;
        if (status !== undefined && status.phase !== "checking" && status.phase !== "updating") return status;
      }
      throw error;
    }
  };

  /** Installs `version`, or what the update policy allows when it is undefined. */
  const updateNow = async (version?: string): Promise<void> => {
    setPickingVersion(false);
    setRestarted(false);
    setNote(null);
    setWork(version === undefined ? "Looking for a new version…" : `Installing ${version}…`);
    setPosting(true);
    const before = update?.current ?? null;
    try {
      const status = await installResult(version);
      setPosting(false);
      setUpdate(status);
      // After a dropped request, the first answer can already come from the new Eva.
      if (status.phase === "idle" && before !== null && status.current !== null && status.current !== before) {
        setWork(null);
        setRestarted(true);
        setNote("Eva restarted with the new version.");
        return;
      }
      if (status.phase !== "restarting") {
        setWork(null);
        return;
      }
      setWork("Eva restarts with the new version when no chat runs…");
      const result = await waitForNewEva();
      setWork(null);
      setRestarted(result === "restarted");
      setNote(
        result === "restarted"
          ? "Eva restarted with the new version."
          : result === "waiting"
            ? "Eva restarts with the new version when no chat runs."
            : "Eva did not answer after the update. Check her log.",
      );
    } catch (error) {
      setPosting(false);
      setWork(null);
      setNote(errorText(error));
    }
  };

  /** Checks first, so the dialog lists the releases of now. */
  const pickVersion = async (): Promise<void> => {
    setNote(null);
    setWork("Looking for the versions…");
    try {
      setUpdate(await api.checkForUpdate());
      setPickingVersion(true);
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setWork(null);
    }
  };

  const wait = updateWait(update, work);

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
        <div className="callout warning" role="alert">
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
      {wait !== null && <ProgressBar label={wait.label} share={wait.share} />}
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
      {engineUpdate === "loading" ? (
        <ProgressBar label="Claude Code: reading the update status…" />
      ) : engineUpdate === null ? (
        <div role="status">No claude program was found.</div>
      ) : engineUpdate.phase === "idle" ? (
        <div role="status">{describeEngineUpdate(engineUpdate)}</div>
      ) : (
        // `claude update` says nothing until it ends, so its share is unknown.
        <ProgressBar label={describeEngineUpdate(engineUpdate)} />
      )}
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
