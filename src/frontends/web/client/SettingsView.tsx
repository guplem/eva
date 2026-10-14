/** Settings (mockups/settings.png): Setup, Projects, Schedules and Appearance, with a Test button for each part. */
import { useEffect, useState, type ReactElement } from "react";
import { api, type CheckResult, type PublicSettings } from "./api.ts";
import { SchedulesPanel } from "./SchedulesPanel.tsx";

const checks: readonly { name: string; label: string }[] = [
  { name: "vault", label: "Vault repository" },
  { name: "engine", label: "Claude Code" },
  { name: "github", label: "GitHub (gh)" },
  { name: "telegram", label: "Telegram bot" },
];

export function SettingsView({ onLoggedOut }: { onLoggedOut: () => void }): ReactElement {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult | "running">>({});
  const [timeZone, setTimeZone] = useState("");
  const [sweepSeconds, setSweepSeconds] = useState("");
  const [projectRoots, setProjectRoots] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void api.settings().then((loaded) => {
      setSettings(loaded);
      setTimeZone(loaded.config.timeZone ?? "");
      setSweepSeconds(String(loaded.config.sync.sweepSeconds));
      setProjectRoots(loaded.config.projectRoots.join("\n"));
    });
  }, []);

  if (settings === null) return <div className="empty">Loading the settings…</div>;

  const runCheck = async (name: string): Promise<void> => {
    setResults((current) => ({ ...current, [name]: "running" }));
    const result = await api.check(name);
    setResults((current) => ({ ...current, [name]: result }));
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
      setNotice("Saved. Restart Eva to use the new settings.");
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
          <label>
            Vault sync interval (seconds)
            <input inputMode="numeric" value={sweepSeconds} onChange={(event) => setSweepSeconds(event.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Projects</legend>
          <label>
            Extra project folders (one per line)
            <textarea value={projectRoots} onChange={(event) => setProjectRoots(event.target.value)} />
          </label>
        </fieldset>
        <SchedulesPanel />
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
        </div>
      </div>
    </div>
  );
}
