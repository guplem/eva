/**
 * Settings: Setup, Updates, Appearance and Projects. Dropdowns save at once, each
 * token saves with its own button, and the text fields wait for Save.
 */
import { useEffect, useState, type ReactElement } from "react";
import { describeEngineUpdate, describeUpdate } from "../../cli/client.ts";
import {
  api,
  type EngineUpdateStatus,
  type EvaStatus,
  type PublicSettings,
  type SetupState,
  type UpdateStatus,
  type VaultSyncState,
} from "./api.ts";
import { readAppearance, saveAppearance, type Appearance } from "./appearance.ts";
import { CheckRow, SecretField, VaultSyncView } from "./SettingsParts.tsx";
import { UpdateVersionDialog } from "./UpdateVersionDialog.tsx";

const pullChoices: readonly { value: string; label: string }[] = [
  { value: "null", label: "Only before each Assistant turn" },
  { value: "1", label: "Every minute" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
];

const updateChoices: readonly { value: PublicSettings["config"]["updates"]["frequency"]; label: string }[] = [
  { value: "off", label: "Never" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

const installChoices: readonly { value: PublicSettings["config"]["updates"]["install"]; label: string }[] = [
  { value: "patch", label: "Fixes only" },
  { value: "minor", label: "Fixes and new features" },
  { value: "major", label: "Every release, even major ones" },
];

const engineChoices: readonly { value: PublicSettings["config"]["engines"]["default"]; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "pi", label: "pi" },
];

const modelChoices: readonly {
  value: PublicSettings["config"]["engines"]["claudeCode"]["defaultModel"];
  label: string;
}[] = [
  { value: "default", label: "Claude Code's default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const statusPollMs = 3_000;
const restartPollLimit = 60;

export function SettingsView({ onLoggedOut }: { onLoggedOut: () => void }): ReactElement {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [timeZone, setTimeZone] = useState("");
  const [sweepSeconds, setSweepSeconds] = useState("");
  const [projectRoots, setProjectRoots] = useState("");
  const [piModel, setPiModel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [pickingVersion, setPickingVersion] = useState(false);
  const [syncState, setSyncState] = useState<VaultSyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** Null when no claude program was found. */
  const [engineUpdate, setEngineUpdate] = useState<EngineUpdateStatus | null | "loading">("loading");
  const [engineUpdateNote, setEngineUpdateNote] = useState<string | null>(null);
  /** Counts the failed status reads, so a failed read asks again. */
  const [engineReadFailures, setEngineReadFailures] = useState(0);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [status, setStatus] = useState<EvaStatus | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A failed load must reach the person, because every problem must reach the phone.
  const loadSettings = (): void => {
    setLoadError(null);
    api
      .settings()
      .then((loaded) => {
        setSettings(loaded);
        setTimeZone(loaded.config.timeZone ?? "");
        setSweepSeconds(String(loaded.config.sync.sweepSeconds));
        setProjectRoots(loaded.config.projectRoots.join("\n"));
        setPiModel(loaded.config.engines.pi.models.default ?? "");
      })
      .catch((error: unknown) => {
        setLoadError(errorText(error));
      });
  };

  useEffect(() => {
    const showProblem = (error: unknown): void => {
      setNotice(errorText(error));
    };
    api
      .status()
      .then((loaded) => {
        setStatus(loaded);
        setSyncState(loaded.vaultSync);
      })
      .catch(showProblem);
    api.updateStatus().then(setUpdate).catch(showProblem);
    api.setupState().then(setSetup).catch(showProblem);
    api.engineUpdateStatus().then(setEngineUpdate, () => {
      setEngineReadFailures((count) => count + 1);
    });
    loadSettings();
  }, []);

  // The engine update can wait for a long turn, then download for minutes. The page asks
  // until it ends, also after a reload or a failed read on a weak phone connection.
  useEffect(() => {
    if (engineUpdate === null || (engineUpdate !== "loading" && engineUpdate.phase === "idle")) return;
    const timer = setTimeout(() => {
      api.engineUpdateStatus().then(setEngineUpdate, () => {
        setEngineReadFailures((count) => count + 1);
      });
    }, statusPollMs);
    return () => {
      clearTimeout(timer);
    };
  }, [engineUpdate, engineReadFailures]);

  const remote = status?.remoteAccess ?? null;
  if (settings === null)
    return loadError === null ? (
      <div className="empty">Loading the settings…</div>
    ) : (
      <div className="empty" role="status">
        The settings did not load: {loadError} <button onClick={loadSettings}>Try again</button>
      </div>
    );
  const config = settings.config;

  /** A dropdown saves its own value at once. */
  const saveNow = async (change: Record<string, unknown>): Promise<void> => {
    let result: { restartNeeded: boolean };
    try {
      result = await api.saveSettings(change);
    } catch (error) {
      setNotice(errorText(error));
      return;
    }
    setNotice(result.restartNeeded ? "Saved. Press Restart Eva to use the new setting." : "Saved.");
    try {
      setSettings(await api.settings());
      setUpdate(await api.updateStatus());
    } catch (error) {
      setNotice(`Saved, but the page did not reload the settings: ${errorText(error)}`);
    }
  };

  const changeAppearance = (change: Partial<Appearance>): void => {
    const next = { ...appearance, ...change };
    setAppearance(next);
    saveAppearance(next);
  };

  /** Installs `version`, or what the update policy allows when it is undefined. */
  const updateNow = async (version?: string): Promise<void> => {
    setPickingVersion(false);
    setUpdateNote(version === undefined ? "Checking…" : `Installing ${version}…`);
    try {
      const status = await api.updateNow(version);
      setUpdate(status);
      setUpdateNote(null);
      if (status.phase === "restarting") {
        setUpdateNote("Eva restarts with the new version when no chat runs…");
        // The old Eva answers "restarting" until she stops; only the new one answers otherwise.
        const result = await waitForRestart((answer) => answer?.phase !== "restarting");
        setUpdateNote(
          result === "restarted"
            ? "Eva restarted with the new version."
            : result === "waiting"
              ? "Eva restarts with the new version when no chat runs."
              : "Eva did not answer after the update. Check her log.",
        );
      }
    } catch (error) {
      setUpdateNote(error instanceof Error ? error.message : String(error));
    }
  };

  /** Checks first, so the dialog lists the releases of now. */
  const pickVersion = async (): Promise<void> => {
    setUpdateNote("Checking…");
    try {
      setUpdate(await api.checkForUpdate());
      setUpdateNote(null);
      setPickingVersion(true);
    } catch (error) {
      setUpdateNote(error instanceof Error ? error.message : String(error));
    }
  };

  /** Starts `claude update`; an effect asks for its status until it ends. */
  const updateEngine = async (): Promise<void> => {
    setEngineUpdateNote(null);
    try {
      setEngineUpdate(await api.updateEngine());
    } catch (error) {
      setEngineUpdateNote(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Eva stops for a moment at a restart; the page asks again until she answers as the new Eva.
   * "waiting" means that the old Eva still answers at the end.
   */
  const waitForRestart = async (
    isNewEva: (answer: UpdateStatus | null) => boolean = () => true,
  ): Promise<"restarted" | "waiting" | "silent"> => {
    let answered = false;
    for (let attempt = 0; attempt < restartPollLimit; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, statusPollMs));
      try {
        const answer = await api.updateStatus();
        setUpdate(answer);
        if (isNewEva(answer)) return "restarted";
        answered = true;
      } catch {
        answered = false;
      }
    }
    return answered ? "waiting" : "silent";
  };

  /** Restarts Eva after a confirm that names the running chats, which the restart stops. */
  const restartNow = async (): Promise<void> => {
    try {
      const running = (await api.status()).busySessionIds.length;
      const warning =
        running === 0
          ? ""
          : `${String(running)} ${running === 1 ? "chat is" : "chats are"} running. A restart stops ${running === 1 ? "it" : "them"}. `;
      if (!window.confirm(`${warning}Restart Eva now?`)) return;
      await api.restart();
      setRestartNote("Eva restarts…");
      setRestartNote(
        (await waitForRestart()) === "restarted"
          ? "Eva restarted."
          : "Eva did not answer after the restart. Check her log.",
      );
    } catch (error) {
      setRestartNote(error instanceof Error ? error.message : String(error));
    }
  };

  const becomeHub = async (): Promise<void> => {
    try {
      setStatus(await api.becomeHub());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const syncNow = async (): Promise<void> => {
    setSyncing(true);
    try {
      setSyncState(await api.syncVault());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  /** Ends every device login, this browser's included. The token still works. */
  const logOutEveryDevice = async (): Promise<void> => {
    try {
      await api.logOutEveryDevice();
      await api.logout();
      onLoggedOut();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async (): Promise<void> => {
    const seconds = Number(sweepSeconds);
    if (!Number.isInteger(seconds) || seconds < 10) {
      setNotice("The sync interval must be a whole number of seconds, 10 or more.");
      return;
    }
    try {
      const result = await api.saveSettings({
        timeZone: timeZone.trim() === "" ? null : timeZone.trim(),
        sync: { sweepSeconds: seconds },
        projectRoots: projectRoots
          .split("\n")
          .map((root) => root.trim())
          .filter((root) => root.length > 0),
        engines: { pi: { models: { default: piModel.trim() === "" ? null : piModel.trim() } } },
      });
      setNotice(result.restartNeeded ? "Saved. Press Restart Eva to use the new settings." : "Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const identities = config.remoteAccess.allowedTailscaleIdentities;
  const found = (engine: string): boolean => setup === null || setup.engines.some((name) => name === engine);

  return (
    <div className="main">
      <div className="settings">
        <fieldset>
          <legend>Setup</legend>
          {status !== null && (
            <div className="check-row">
              <span style={{ flex: 1 }}>
                {status.role === "hub"
                  ? `This machine (${status.machine}) is the hub: it runs Telegram and the schedules.`
                  : `This machine (${status.machine}) is a satellite. The hub is ${status.hub ?? "unknown"}.`}
              </span>
              {status.role === "satellite" && (
                <button onClick={() => void becomeHub()}>Make this machine the hub</button>
              )}
            </div>
          )}

          <h3>GitHub</h3>
          <SecretField
            name="githubToken"
            label="GitHub token"
            saved={settings.secretsSet.githubToken}
            help="Eva's git commands use it for a private vault over HTTPS."
            check="github"
            onChanged={setNotice}
          />

          <h3>Vault</h3>
          <div>Folder: {config.vaultPath ?? "not configured. Run `eva setup` on this machine."}</div>
          <div>Repository: {setup?.vaultRemote ?? "no remote"}</div>
          <CheckRow name="vault" label="Test the vault repository" />
          <div className="check-row">
            <label style={{ flex: 1 }}>
              Fetch the vault&apos;s changes
              <select
                value={String(config.sync.pullIntervalMinutes)}
                onChange={(event) =>
                  void saveNow({
                    sync: { pullIntervalMinutes: event.target.value === "null" ? null : Number(event.target.value) },
                  })
                }
              >
                {pullChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={syncing} onClick={() => void syncNow()}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {syncState !== null && <VaultSyncView state={syncState} onState={setSyncState} />}
          <label>
            Vault save interval (seconds)
            <input inputMode="numeric" value={sweepSeconds} onChange={(event) => setSweepSeconds(event.target.value)} />
          </label>

          <h3>Telegram</h3>
          <SecretField
            name="telegramBotToken"
            label="Telegram bot token"
            saved={settings.secretsSet.telegramBotToken}
            help="Make a bot with @BotFather in Telegram, then paste its token."
            check="telegram"
            onChanged={setNotice}
          />
          <div className="hint">
            {setup === null
              ? ""
              : setup.telegram.paired
                ? "Telegram is paired with your chat."
                : setup.telegram.pairingCode !== null
                  ? `Telegram is not paired yet. Send ${setup.telegram.pairingCode} to your bot.`
                  : "Telegram is not set up: save a bot token, then restart Eva."}
          </div>

          <h3>Engines</h3>
          <label>
            Engine for new chats
            <select
              value={config.engines.default}
              onChange={(event) => void saveNow({ engines: { default: event.target.value } })}
            >
              {engineChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Claude Code model
            <select
              value={config.engines.claudeCode.defaultModel}
              onChange={(event) => void saveNow({ engines: { claudeCode: { defaultModel: event.target.value } } })}
            >
              {modelChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <SecretField
            name="claudeOauthToken"
            label="Claude Code token"
            saved={settings.secretsSet.claudeOauthToken}
            help="Run `claude setup-token` on any computer with your Claude subscription, then paste the token."
            check="claude-code"
            onChanged={setNotice}
          />
          {!found("claude-code") && <div className="hint">Eva did not find the claude program on this machine.</div>}
          <label>
            pi model, such as openai/gpt-5 (empty: pi&apos;s own default)
            <input value={piModel} onChange={(event) => setPiModel(event.target.value)} />
          </label>
          <div className="hint">
            {found("pi")
              ? "pi keeps its own login on this machine. To log in, run `pi`, then `/login`."
              : "Eva did not find the pi program on this machine."}
          </div>
          <CheckRow name="pi" label="Test pi" />

          <h3>Time and remote access</h3>
          <label>
            Time zone
            <input value={timeZone} placeholder="Europe/Madrid" onChange={(event) => setTimeZone(event.target.value)} />
          </label>
          {remote !== null && (
            <div>
              Phone access:{" "}
              {remote.url === null ? (remote.problem ?? "not available") : <a href={remote.url}>{remote.url}</a>}
            </div>
          )}
          <div>
            Tailscale accounts that may ask for a device login:{" "}
            {identities.length === 0 ? "Only the Tailscale account that owns this machine." : identities.join(", ")}
          </div>
          <div className="hint">
            A device login cannot change this list or the tokens. To change the list, run this on the machine, with
            every account that may ask:{" "}
            <code>
              eva settings set remoteAccess.allowedTailscaleIdentities &apos;[&quot;you@example.com&quot;]&apos;
            </code>
          </div>
        </fieldset>
        <fieldset>
          <legend>Updates</legend>
          <div>{update === null ? "This Eva cannot update herself." : describeUpdate(update)}</div>
          <div className="check-row">
            <label style={{ flex: 1 }}>
              Install updates automatically
              <select
                value={config.updates.frequency}
                onChange={(event) => void saveNow({ updates: { frequency: event.target.value } })}
              >
                {updateChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="check-row">
            <label style={{ flex: 1 }}>
              Eva installs by herself
              <select
                value={config.updates.install}
                onChange={(event) => void saveNow({ updates: { install: event.target.value } })}
              >
                {installChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {config.updates.install === "major" && (
            <div className="update-warning">
              A major update can break things that work today. With this choice, Eva installs it by herself.
            </div>
          )}
          <div className="check-row">
            <button disabled={update === null} onClick={() => void updateNow()}>
              Check and install
            </button>
            <button disabled={update === null || update.kind === "source"} onClick={() => void pickVersion()}>
              Update to a version…
            </button>
          </div>
          {update?.kind === "source" && (
            <div className="hint">This Eva runs from a git checkout, so she follows the main branch.</div>
          )}
          {updateNote !== null && <div role="status">{updateNote}</div>}
          {pickingVersion && update !== null && (
            <UpdateVersionDialog
              update={update}
              onInstall={(version) => void updateNow(version)}
              onClose={() => setPickingVersion(false)}
            />
          )}
          <div className="check-row">
            <span style={{ flex: 1 }} role="status">
              {engineUpdate === "loading"
                ? "Claude Code: reading the update status…"
                : engineUpdate === null
                  ? "No claude program was found."
                  : describeEngineUpdate(engineUpdate)}
            </span>
            <button
              disabled={engineUpdate === "loading" || engineUpdate?.phase !== "idle"}
              onClick={() => void updateEngine()}
            >
              Update Claude Code
            </button>
          </div>
          {engineUpdateNote !== null && <div role="status">{engineUpdateNote}</div>}
          <div className="check-row">
            <span style={{ flex: 1 }}>Restart Eva, for example after a settings change.</span>
            <button onClick={() => void restartNow()}>Restart Eva</button>
          </div>
          {restartNote !== null && <div role="status">{restartNote}</div>}
          <div className="chip">
            Eva installs an update only when no chat is running, then restarts. These settings live in your vault, so
            every machine uses them: the time zone, updates, vault fetch, engines, Google account and voice language.
            These stay on each machine: the tokens, the allowed Tailscale accounts, the trusted repository owners and
            Google access.
          </div>
        </fieldset>
        <fieldset>
          <legend>Appearance</legend>
          <label>
            Theme
            <select
              value={appearance.theme}
              onChange={(event) => changeAppearance({ theme: event.target.value as Appearance["theme"] })}
            >
              <option value="system">Use the system setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Density
            <select
              value={appearance.density}
              onChange={(event) => changeAppearance({ density: event.target.value as Appearance["density"] })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <div className="hint">This browser keeps its own theme and density.</div>
        </fieldset>
        <fieldset>
          <legend>Projects</legend>
          <label>
            Extra project folders (one per line)
            <textarea value={projectRoots} onChange={(event) => setProjectRoots(event.target.value)} />
          </label>
        </fieldset>
        {notice !== null && (
          // Sticky, so a phone shows the result of a control near the top of the page.
          <div className="settings-notice" role="status">
            <span>{notice}</span>
            <button aria-label="Close the notice" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}
        <div className="message-actions">
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
          <button onClick={() => void api.logout().then(onLoggedOut)}>Log out</button>
          <button onClick={() => void logOutEveryDevice()}>Log out every device</button>
        </div>
      </div>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
