/**
 * Settings: Setup, Updates, Projects and Appearance, with a Test
 * button for each part. The two dropdowns save at once; Eva uses them without a restart.
 */
import { useEffect, useState, type ReactElement } from "react";
import { describeEngineUpdate, describeSync, describeUpdate } from "../../cli/client.ts";
import {
  api,
  type CheckResult,
  type EngineUpdateStatus,
  type EvaStatus,
  type PublicSettings,
  type UpdateStatus,
} from "./api.ts";

const checks: readonly { name: string; label: string }[] = [
  { name: "vault", label: "Vault repository" },
  { name: "engine", label: "Claude Code" },
  { name: "github", label: "GitHub (gh)" },
  { name: "telegram", label: "Telegram bot" },
];

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

const statusPollMs = 3_000;
const restartPollLimit = 60;

export function SettingsView({ onLoggedOut }: { onLoggedOut: () => void }): ReactElement {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult | "running">>({});
  const [timeZone, setTimeZone] = useState("");
  const [sweepSeconds, setSweepSeconds] = useState("");
  const [projectRoots, setProjectRoots] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  /** Null when no claude program was found. */
  const [engineUpdate, setEngineUpdate] = useState<EngineUpdateStatus | null | "loading">("loading");
  const [engineUpdateNote, setEngineUpdateNote] = useState<string | null>(null);
  /** Counts the failed status reads, so a failed read asks again. */
  const [engineReadFailures, setEngineReadFailures] = useState(0);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [status, setStatus] = useState<EvaStatus | null>(null);

  useEffect(() => {
    void api.status().then(setStatus);
    void api.updateStatus().then(setUpdate);
    api.engineUpdateStatus().then(setEngineUpdate, () => {
      setEngineReadFailures((count) => count + 1);
    });
    void api.settings().then((loaded) => {
      setSettings(loaded);
      setTimeZone(loaded.config.timeZone ?? "");
      setSweepSeconds(String(loaded.config.sync.sweepSeconds));
      setProjectRoots(loaded.config.projectRoots.join("\n"));
    });
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
  if (settings === null) return <div className="empty">Loading the settings…</div>;

  const runCheck = async (name: string): Promise<void> => {
    setResults((current) => ({ ...current, [name]: "running" }));
    const result = await api.check(name);
    setResults((current) => ({ ...current, [name]: result }));
  };

  /** A dropdown saves its own value at once. */
  const saveNow = async (change: Record<string, unknown>): Promise<void> => {
    try {
      await api.saveSettings(change);
      setSettings(await api.settings());
      setUpdate(await api.updateStatus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const updateNow = async (): Promise<void> => {
    setUpdateNote("Checking…");
    try {
      const status = await api.updateNow();
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
    setSyncNote("Syncing…");
    try {
      setSyncNote(describeSync(await api.syncVault()));
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : String(error));
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
      await api.saveSettings({
        timeZone: timeZone.trim() === "" ? null : timeZone.trim(),
        sync: { sweepSeconds: seconds },
        projectRoots: projectRoots
          .split("\n")
          .map((root) => root.trim())
          .filter((root) => root.length > 0),
      });
      setNotice("Saved. Press Restart Eva to use the new settings.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="main">
      <div className="settings">
        <fieldset>
          <legend>Setup</legend>
          <div>Vault folder: {settings.config.vaultPath ?? "not configured"}</div>
          {remote !== null && (
            <div>
              Phone access:{" "}
              {remote.url === null ? (remote.problem ?? "not available") : <a href={remote.url}>{remote.url}</a>}
            </div>
          )}
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
          {checks.map((check) => {
            const result = results[check.name];
            return (
              <div key={check.name} className="check-row">
                <span style={{ flex: 1 }}>{check.label}</span>
                {result === "running" && <span>Testing…</span>}
                {result !== undefined && result !== "running" && (
                  <span className={result.ok ? "ok" : "failed"}>
                    {result.ok ? "✓" : "✗"} {result.detail}
                  </span>
                )}
                <button onClick={() => void runCheck(check.name)}>Test</button>
              </div>
            );
          })}
          <div className="chip">
            Secrets saved:{" "}
            {Object.entries(settings.secretsSet)
              .filter(([, set]) => set)
              .map(([name]) => name)
              .join(", ") || "none"}
            . Change them with `eva setup`.
          </div>
          <label>
            Time zone
            <input value={timeZone} placeholder="Europe/Madrid" onChange={(event) => setTimeZone(event.target.value)} />
          </label>
          <div className="check-row">
            <label style={{ flex: 1 }}>
              Fetch the vault's changes
              <select
                value={String(settings.config.sync.pullIntervalMinutes)}
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
            <button onClick={() => void syncNow()}>Sync now</button>
          </div>
          {syncNote !== null && <div role="status">{syncNote}</div>}
          <label>
            Vault save interval (seconds)
            <input inputMode="numeric" value={sweepSeconds} onChange={(event) => setSweepSeconds(event.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Updates</legend>
          <div>{update === null ? "This Eva cannot update herself." : describeUpdate(update)}</div>
          <div className="check-row">
            <label style={{ flex: 1 }}>
              Install updates automatically
              <select
                value={settings.config.updates.frequency}
                onChange={(event) => void saveNow({ updates: { frequency: event.target.value } })}
              >
                {updateChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={update === null} onClick={() => void updateNow()}>
              Update now
            </button>
          </div>
          {updateNote !== null && <div role="status">{updateNote}</div>}
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
            Eva installs an update only when no chat is running, then restarts. The time zone, updates, vault fetch,
            engines, the Google account and the voice language live in your vault, so every machine uses them. The
            security settings (allowed Tailscale accounts, trusted repository owners, Google access) stay on each
            machine.
          </div>
        </fieldset>
        <fieldset>
          <legend>Projects</legend>
          <label>
            Extra project folders (one per line)
            <textarea value={projectRoots} onChange={(event) => setProjectRoots(event.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Appearance</legend>
          <div className="chip">Eva follows your system's light or dark theme.</div>
        </fieldset>
        {notice !== null && <div role="status">{notice}</div>}
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
