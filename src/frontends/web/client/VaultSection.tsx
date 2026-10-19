/** The vault page: where the notes live and their repository, then how and when Eva syncs them. */
import { useState, type ReactElement } from "react";
import { api, type VaultSyncState } from "./api.ts";
import {
  Card,
  CheckRow,
  CommandLine,
  errorText,
  Steps,
  VaultSyncView,
  type SettingsContext,
} from "./SettingsParts.tsx";

const pullChoices: readonly { value: string; label: string }[] = [
  { value: "null", label: "Only before each Assistant turn" },
  { value: "1", label: "Every minute" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
];

export function VaultSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <VaultFolderCard context={context} />
      <VaultSyncCard context={context} />
    </>
  );
}

export function VaultFolderCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const folder = context.settings.config.vaultPath;
  return (
    <Card
      item="vault-folder"
      title="Vault folder and repository"
      description="Your vault is the folder of your notes. Eva keeps a copy in a git repository, so each machine shares it."
    >
      {folder === null ? (
        <Steps>
          <li>
            On Eva&apos;s computer, open a terminal and run:
            <CommandLine command="eva setup" />
          </li>
          <li>Pick your vault, or make a new one. Eva clones it for you.</li>
          <li>Come back here and press Test.</li>
        </Steps>
      ) : (
        <dl className="facts">
          <dt>Folder</dt>
          <dd>{folder}</dd>
          <dt>Repository</dt>
          <dd>{context.setup?.vaultRemote ?? "no remote"}</dd>
        </dl>
      )}
      <CheckRow name="vault" label="Test the vault repository" />
    </Card>
  );
}

function VaultSyncCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  /** Null until a sync or a pick here: the status, which may load after this card, shows until then. */
  const [syncState, setSyncState] = useState<VaultSyncState | null>(null);
  const shown = syncState ?? context.status?.vaultSync ?? null;
  const [syncing, setSyncing] = useState(false);
  const savedSeconds = String(config.sync.sweepSeconds);
  const [sweepSeconds, setSweepSeconds] = useState(savedSeconds);

  const syncNow = async (): Promise<void> => {
    setSyncing(true);
    try {
      setSyncState(await api.syncVault());
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setSyncing(false);
    }
  };

  const saveInterval = async (): Promise<void> => {
    const seconds = Number(sweepSeconds);
    if (!Number.isInteger(seconds) || seconds < 10) {
      context.notify("The sync interval must be a whole number of seconds, 10 or more.");
      return;
    }
    await context.saveNow({ sync: { sweepSeconds: seconds } });
  };

  return (
    <Card item="vault-sync" title="Sync" description="Eva saves your notes and fetches the changes of other machines.">
      {shown !== null && <VaultSyncView state={shown} onState={setSyncState} />}
      <div className="inline-form">
        <label className="field grow">
          <span className="field-label">Fetch the vault&apos;s changes</span>
          <select
            value={String(config.sync.pullIntervalMinutes)}
            onChange={(event) =>
              void context.saveNow({
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
      <div className="inline-form">
        <label className="field grow">
          <span className="field-label">Vault save interval (seconds)</span>
          <input inputMode="numeric" value={sweepSeconds} onChange={(event) => setSweepSeconds(event.target.value)} />
        </label>
        <button className="primary" disabled={sweepSeconds === savedSeconds} onClick={() => void saveInterval()}>
          Save the interval
        </button>
      </div>
    </Card>
  );
}
