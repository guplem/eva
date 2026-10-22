/** The updates page: the versions of Eva and her tools with their updates, Eva's update policy, and a restart. */
import { Fragment, useEffect, useState, type ReactElement } from "react";
import { isNewerVersion } from "../../../core/updates/version-order.ts";
import { describeEngineUpdate } from "../../cli/client.ts";
import {
  ApiError,
  api,
  type EngineUpdateStatus,
  type EvaVersions,
  type InstallableTool,
  type PublicSettings,
  type UpdateStatus,
} from "./api.ts";
import { ChangelogDialog } from "./ChangelogDialog.tsx";
import { Card, ChoiceChips, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { FactsSkeleton, ProgressBar } from "./Loading.tsx";
import { evaNewest, restartWait, updateCallout, updatesFace, updateWait } from "./update-words.ts";
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

/**
 * Eva's update status and the version dialog, for both cards: the Versions card names a newer
 * Eva and opens the dialog, and the Eva updates card installs the version that the dialog picks.
 */
interface EvaUpdate {
  readonly update: UpdateStatus | null;
  readonly setUpdate: (update: UpdateStatus | null) => void;
  readonly pickingVersion: boolean;
  readonly setPickingVersion: (picking: boolean) => void;
  /** True while the request to update runs. It ends only after the download. */
  readonly posting: boolean;
  readonly setPosting: (posting: boolean) => void;
  /** Checks first, so the dialog lists the releases of now. */
  readonly openVersions: () => Promise<void>;
}

export function UpdatesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [pickingVersion, setPickingVersion] = useState(false);
  const [posting, setPosting] = useState(false);
  const openVersions = async (): Promise<void> => {
    setUpdate(await api.checkForUpdate());
    setPickingVersion(true);
  };
  const eva: EvaUpdate = { update, setUpdate, pickingVersion, setPickingVersion, posting, setPosting, openVersions };
  return (
    <>
      <VersionsCard eva={eva} />
      <EvaUpdatesCard context={context} eva={eva} />
      <RestartCard context={context} />
    </>
  );
}

/**
 * The versions that `eva doctor` shows in a terminal, so a phone sees them too. A tool that Eva
 * installs herself gets a button, so a missing or old tool needs no terminal. claude updates with
 * its own `claude update`, which waits until no chat runs a turn. Voice notes get one row and one
 * button for all their parts, as the person wants the feature, not each program. A newer Eva
 * opens the version dialog, so a major update shows its warning first.
 */
function VersionsCard({ eva }: { readonly eva: EvaUpdate }): ReactElement {
  const [versions, setVersions] = useState<EvaVersions | "loading" | "failed">("loading");
  /** The newest published version of each tool, by program. A tool that is missing here is unknown. */
  const [latest, setLatest] = useState<ReadonlyMap<string, string>>(new Map());
  /** False until the latest versions answer or fail, so no Update button flickers on and off. */
  const [latestRead, setLatestRead] = useState(false);
  /** The tool that this page installs now. */
  const [installing, setInstalling] = useState<InstallableTool | "voice notes" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  /** Null when no claude program was found when Eva started. */
  const [engineUpdate, setEngineUpdate] = useState<EngineUpdateStatus | null | "loading">("loading");
  /** True while the request that starts `claude update` runs, so a second tap sends nothing. */
  const [engineStarting, setEngineStarting] = useState(false);
  /** Counts the failed engine status reads, so a failed read asks again. */
  const [engineReadFailures, setEngineReadFailures] = useState(0);
  /** True while the Eva row checks for the releases before the version dialog opens. */
  const [openingVersions, setOpeningVersions] = useState(false);
  const newestEva = evaNewest(eva.update);

  const readVersions = (): void => {
    api.versions().then(setVersions, () => {
      setVersions("failed");
    });
  };
  useEffect(readVersions, []);

  // The latest versions come from the network, so they come after the versions of this machine.
  useEffect(() => {
    api.latestVersions().then(
      (found) => {
        setLatest(new Map(found.flatMap((tool) => (tool.latest === null ? [] : [[tool.program, tool.latest]]))));
        setLatestRead(true);
      },
      // Without the latest versions, each tool keeps its Update button.
      () => {
        setLatestRead(true);
      },
    );
  }, []);

  useEffect(() => {
    api.engineUpdateStatus().then(setEngineUpdate, () => {
      setEngineReadFailures((count) => count + 1);
    });
  }, []);

  // The engine update can wait for a long turn, then download for minutes. The page asks
  // until it ends, also after a reload or a failed read on a weak phone connection.
  const engineBusy = engineUpdate === "loading" || (engineUpdate !== null && engineUpdate.phase !== "idle");
  /** `claude update` runs or waits. The page holds the other installs until it ends, so two installs never overlap. */
  const engineRuns = engineUpdate !== "loading" && engineUpdate !== null && engineUpdate.phase !== "idle";
  useEffect(() => {
    if (!engineBusy) return;
    const timer = setTimeout(() => {
      api.engineUpdateStatus().then(
        (status) => {
          setEngineUpdate(status);
          // The row shows the new version once the update ends.
          if (engineUpdate !== "loading" && (status === null || status.phase === "idle")) readVersions();
        },
        () => {
          setEngineReadFailures((count) => count + 1);
        },
      );
    }, statusPollMs);
    return () => {
      clearTimeout(timer);
    };
  }, [engineUpdate, engineReadFailures]);

  const install = async (program: InstallableTool | "voice notes"): Promise<void> => {
    setNote(null);
    setInstalling(program);
    try {
      const result = await (program === "voice notes" ? api.installVoiceNotes() : api.installTool(program));
      setNote({ ok: result.ok, text: result.message });
    } catch (error) {
      setNote({ ok: false, text: errorText(error) });
    } finally {
      setInstalling(null);
      readVersions();
    }
  };

  /** Starts `claude update`; the effect above asks for its status until it ends. */
  const updateEngine = async (): Promise<void> => {
    setNote(null);
    setEngineStarting(true);
    try {
      setEngineUpdate(await api.updateEngine());
    } catch (error) {
      setNote({ ok: false, text: errorText(error) });
    } finally {
      setEngineStarting(false);
    }
  };

  const openVersions = async (): Promise<void> => {
    if (openingVersions) return;
    setNote(null);
    setOpeningVersions(true);
    try {
      await eva.openVersions();
    } catch (error) {
      setNote({ ok: false, text: errorText(error) });
    } finally {
      setOpeningVersions(false);
    }
  };

  /** claude goes through `claude update` once Eva has found it; a missing claude goes through its installer. */
  const usesEngineUpdate = (program: string): boolean => program === "claude" && engineUpdate !== null;

  return (
    <Card item="versions" title="Versions" description="The version of Eva and of each tool that she uses.">
      {versions === "loading" ? (
        // Eva, the tools of `usedTools` in an installed Eva, which carries its own Bun, and voice notes.
        <FactsSkeleton label="Reading the versions…" rows={11} />
      ) : versions === "failed" ? (
        <div role="status">Eva could not read the versions. Open this page again to retry.</div>
      ) : (
        <dl className="facts">
          <dt>Eva</dt>
          <dd className={newestEva === null ? undefined : "fact-with-action"}>
            {/* The status follows a restart into a new version. The list of versions is read once. */}
            {newestEva === null
              ? (eva.update?.current ?? versions.eva)
              : `${eva.update?.current ?? versions.eva} (${newestEva} available)`}
            {newestEva !== null && (
              <button
                className="primary small"
                disabled={eva.posting || eva.update?.phase !== "idle"}
                onClick={() => void openVersions()}
              >
                {openingVersions ? "Checking…" : "Update"}
              </button>
            )}
          </dd>
          {versions.tools.map((tool) => {
            const newest = latest.get(tool.program);
            const action = toolAction(tool, newest);
            const viaEngine = action === "Update" && usesEngineUpdate(tool.program);
            const working = viaEngine ? engineRuns || engineStarting : installing === tool.program;
            const waitsForLatest = action === "Update" && !tool.tooOld && !latestRead;
            return (
              <Fragment key={tool.program}>
                <dt data-tooltip={`For ${tool.feature}`}>{tool.program}</dt>
                <dd className={action === null ? undefined : "fact-with-action"}>
                  {versionText(tool, newest)}
                  {action !== null && (
                    <button
                      className={
                        action === "Install" || tool.tooOld || freshness(tool, newest) === "old"
                          ? "primary small"
                          : "ghost small"
                      }
                      disabled={installing !== null || engineRuns || engineStarting || waitsForLatest}
                      onClick={() => void (viaEngine ? updateEngine() : install(tool.program as InstallableTool))}
                    >
                      {working ? (action === "Update" ? "Updating…" : "Installing…") : action}
                    </button>
                  )}
                </dd>
              </Fragment>
            );
          })}
          <dt data-tooltip="For voice notes in chats">voice notes</dt>
          <dd className={versions.voiceNotes.missing.length === 0 ? undefined : "fact-with-action"}>
            {voiceNotesText(versions.voiceNotes)}
            {versions.voiceNotes.missing.length > 0 && (
              <button
                className="primary small"
                disabled={installing !== null || engineRuns || engineStarting}
                onClick={() => void install("voice notes")}
              >
                {installing === "voice notes" ? "Installing…" : "Install"}
              </button>
            )}
          </dd>
        </dl>
      )}
      {openingVersions && <ProgressBar label="Looking for the versions…" />}
      {/* An install says nothing until it ends, so its share is unknown. */}
      {installing !== null && <ProgressBar label={`Installing ${installing}. This can take a few minutes.`} />}
      {/* `claude update` says nothing until it ends, so its share is unknown. */}
      {engineUpdate !== "loading" && engineUpdate !== null && engineUpdate.phase !== "idle" && (
        <ProgressBar label={describeEngineUpdate(engineUpdate)} />
      )}
      {engineUpdate !== "loading" && engineUpdate?.phase === "idle" && engineUpdate.last !== null && (
        <div role="status" className={engineUpdate.last.outcome === "failed" ? "callout warning" : "callout"}>
          {describeEngineUpdate(engineUpdate)}
        </div>
      )}
      {note !== null && (
        <div role="status" className={note.ok ? "callout" : "callout warning"}>
          {note.text}
        </div>
      )}
    </Card>
  );
}

/** Whether voice notes run, and what they still need. */
function voiceNotesText(state: EvaVersions["voiceNotes"]): string {
  if (state.missing.length > 0) return `Off, needs ${state.missing.join(", ")}`;
  return state.on ? "On" : "Installed, restart Eva to turn them on";
}

/**
 * Whether an installed tool is older than the newest version. A tool that prints no version
 * number, or a newest version that Eva could not read, gives "unknown".
 */
function freshness(tool: EvaVersions["tools"][number], newest: string | undefined): "old" | "latest" | "unknown" {
  if (tool.version === null || newest === undefined || !/\d/.test(tool.version)) return "unknown";
  return isNewerVersion(newest, tool.version) ? "old" : "latest";
}

/** The version, and the newest one when it is newer. */
function versionText(tool: EvaVersions["tools"][number], newest: string | undefined): string {
  if (tool.version === null) return "Not installed";
  if (tool.tooOld) return `${tool.version}, too old`;
  return freshness(tool, newest) === "old" ? `${tool.version} (${newest ?? ""} available)` : tool.version;
}

/**
 * "Install" for a missing tool, "Update" for an old one, or null for no button. Without the
 * newest version, Eva cannot tell whether the tool is old, so it keeps its Update button.
 */
function toolAction(tool: EvaVersions["tools"][number], newest: string | undefined): "Install" | "Update" | null {
  if (!tool.installable) return null;
  if (tool.version === null) return "Install";
  return !tool.tooOld && freshness(tool, newest) === "latest" ? null : "Update";
}

function EvaUpdatesCard({
  context,
  eva,
}: {
  readonly context: SettingsContext;
  readonly eva: EvaUpdate;
}): ReactElement {
  const config = context.settings.config;
  const { update, setUpdate, pickingVersion, setPickingVersion, posting, setPosting } = eva;
  const [note, setNote] = useState<string | null>(null);
  /** The sentence of a wait that this page started, such as a check. */
  const [work, setWork] = useState<string | null>(null);
  /** Counts the failed status reads, so a failed read asks again. */
  const [readFailures, setReadFailures] = useState(0);
  const [showingChangelog, setShowingChangelog] = useState(false);
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
      setWork(restartWait(status));
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

  const pickVersion = async (): Promise<void> => {
    setNote(null);
    setWork("Looking for the versions…");
    try {
      await eva.openVersions();
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setWork(null);
    }
  };

  const wait = updateWait(update, work);
  const callout = updateCallout(update, wait);

  return (
    <Card
      item="eva-updates"
      title="Eva updates"
      description="Eva installs an update only when no chat is running, then restarts."
      aside={<Visor face={updatesFace(update, restarted)} />}
    >
      {callout !== null && <div className="callout">{callout}</div>}
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
        <button onClick={() => setShowingChangelog(true)}>Changelog</button>
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
      {showingChangelog && <ChangelogDialog onClose={() => setShowingChangelog(false)} />}
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
