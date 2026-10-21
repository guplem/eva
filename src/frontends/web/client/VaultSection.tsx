/**
 * The vault page: where the notes live and their repository, how and when Eva syncs them,
 * and the other folders of this machine where Eva looks for projects.
 */
import { useState, type ReactElement } from "react";
import { api, type EvaStatus, type VaultSyncState } from "./api.ts";
import { Card, CheckRow, errorText, RichText, VaultSyncView, type SettingsContext } from "./SettingsParts.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { VaultChooser, VaultPush } from "./VaultChooser.tsx";

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
      <ProjectFoldersCard context={context} />
    </>
  );
}

export function VaultFolderCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const folder = context.settings.config.vaultPath;
  // The step reads the files, so it sees a vault that the page cloned before the restart.
  const step = context.setup?.progress.find((each) => each.key === "vault");
  const ready = step === undefined ? folder !== null : step.state === "done";
  return (
    <Card
      item="vault-folder"
      title="Vault folder and repository"
      description="Your vault is the folder of your notes. Eva keeps a copy in a git repository, so each machine shares it."
    >
      {!ready ? (
        <VaultChooser context={context} />
      ) : folder === null ? (
        <div className="callout warning callout-action">
          <span>
            <RichText text={step?.detail ?? ""} /> Eva uses it after a restart.
          </span>
          <button className="primary" onClick={context.askRestart}>
            Restart now
          </button>
        </div>
      ) : (
        <dl className="facts">
          <dt>Folder</dt>
          <dd>{folder}</dd>
          <dt>Repository</dt>
          <dd>{context.setup?.vaultRemote ?? "no remote"}</dd>
        </dl>
      )}
      {context.setup?.vaultNeedsPush === true && <VaultPush context={context} />}
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
      // A sync can end a problem, and the notice at the top must follow.
      context.reloadSetup();
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setSyncing(false);
    }
  };

  const saveInterval = async (): Promise<boolean> => {
    const seconds = Number(sweepSeconds);
    if (!Number.isInteger(seconds) || seconds < 10) {
      context.notify("The sync interval must be a whole number of seconds, 10 or more.");
      return false;
    }
    return context.saveNow({ sync: { sweepSeconds: seconds } });
  };

  return (
    <Card item="vault-sync" title="Sync" description="Eva saves your notes and fetches the changes of other machines.">
      {shown !== null && (
        <VaultSyncView
          state={shown}
          // An older Eva sends no field: the notice shows only for false. With no vault, nothing waits.
          autoSync={config.vaultPath === null ? true : (context.status as Partial<EvaStatus> | null)?.vaultAutoSync}
          onState={(state) => {
            setSyncState(state);
            context.reloadSetup();
          }}
        />
      )}
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
        <SaveButton className="primary" disabled={sweepSeconds === savedSeconds} onSave={saveInterval}>
          Save the interval
        </SaveButton>
      </div>
    </Card>
  );
}

/** The folders are paths on this machine, so they live in the machine's settings, not in the vault. */
function ProjectFoldersCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const savedRoots = context.settings.config.projectRoots.join("\n");
  const [projectRoots, setProjectRoots] = useState(savedRoots);

  const save = async (): Promise<void> => {
    await context.saveNow({
      projectRoots: projectRoots
        .split("\n")
        .map((root) => root.trim())
        .filter((root) => root.length > 0),
    });
  };

  return (
    <Card
      item="project-folders"
      title="Project folders"
      description="Eva finds projects in your vault. She also looks in these folders on this machine."
    >
      <label className="field">
        <span className="field-label">Extra project folders (one per line)</span>
        <textarea value={projectRoots} onChange={(event) => setProjectRoots(event.target.value)} />
      </label>
      <div className="save-bar">
        <button className="primary" disabled={projectRoots === savedRoots} onClick={() => void save()}>
          Save the folders
        </button>
      </div>
    </Card>
  );
}
