/** The small parts of the settings page: a Test row, a write-only secret field, and the vault sync state. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  api,
  type CheckResult,
  type ConflictChoice,
  type PageSecretName,
  type VaultConflict,
  type VaultSyncState,
} from "./api.ts";

/**
 * One Test button and its result. The check runs on the server, with the saved settings. The
 * label also names the button: a screen reader cannot tell five buttons called "Test" apart.
 */
export function CheckRow({ name, label }: { name: string; label: string }): ReactElement {
  const [result, setResult] = useState<CheckResult | "running" | null>(null);
  const run = async (): Promise<void> => {
    setResult("running");
    try {
      setResult(await api.check(name));
    } catch (error) {
      setResult({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="check-row">
      <span style={{ flex: 1 }}>{label}</span>
      <span role="status" className={result === null || result === "running" ? "" : result.ok ? "ok" : "failed"}>
        {result === "running" && "Testing…"}
        {result !== null && result !== "running" && `${result.ok ? "✓" : "✗"} ${result.detail}`}
      </span>
      <button aria-label={label} onClick={() => void run()}>
        Test
      </button>
    </div>
  );
}

interface SecretFieldProps {
  readonly name: PageSecretName;
  /** Such as "GitHub token"; it names the field and its buttons. */
  readonly label: string;
  readonly saved: boolean;
  readonly help: ReactNode;
  /** The check that tests the saved secret. Absent: no Test row, as for a secret that needs a second one. */
  readonly check?: string;
  readonly onChanged: (note: string) => void;
}

/**
 * A secret goes one way: the page sends it, and never gets it back. The field empties after a
 * save, and the line above it says only whether one is saved.
 */
export function SecretField({ name, label, saved, help, check, onChanged }: SecretFieldProps): ReactElement {
  const [value, setValue] = useState("");
  const [isSaved, setIsSaved] = useState(saved);
  // The page loads the settings again after a save elsewhere on it.
  useEffect(() => {
    setIsSaved(saved);
  }, [saved]);
  const save = async (): Promise<void> => {
    try {
      await api.saveSecret(name, value);
      setValue("");
      setIsSaved(true);
      onChanged(`Saved the ${label}. Test uses it now. Press Restart Eva to use it in chats and sync.`);
    } catch (error) {
      onChanged(error instanceof Error ? error.message : String(error));
    }
  };
  const remove = async (): Promise<void> => {
    if (!window.confirm(`Remove the ${label}?`)) return;
    try {
      await api.removeSecret(name);
      setIsSaved(false);
      onChanged(`Removed the ${label}. Press Restart Eva to stop using it.`);
    } catch (error) {
      onChanged(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <div className="hint">
        {isSaved ? `A ${label} is saved.` : `No ${label} is saved.`} {help}
      </div>
      <div className="check-row">
        <input
          type="password"
          autoComplete="off"
          aria-label={label}
          placeholder={isSaved ? "Paste a new one to replace it" : "Paste it here"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button aria-label={`Save the ${label}`} disabled={value.trim() === ""} onClick={() => void save()}>
          Save
        </button>
        {isSaved && (
          <button aria-label={`Remove the ${label}`} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {check !== undefined && <CheckRow name={check} label={`Test the ${label}`} />}
    </>
  );
}

const statusLabels: Readonly<Record<VaultSyncState["status"], string>> = {
  ok: "Up to date",
  offline: "Offline",
  conflict: "Conflict",
  error: "Error",
  skipped: "Skipped",
};

const withheldReasons: Readonly<Record<VaultSyncState["withheldFiles"][number]["reason"], string>> = {
  secret: "looks like a secret",
  too_large: "larger than 50 MB",
};

/** The last sync result, a conflict with its picks included, and the files that the secret scan held back. */
export function VaultSyncView({
  state,
  onState,
}: {
  state: VaultSyncState;
  onState: (state: VaultSyncState) => void;
}): ReactElement {
  const label = statusLabels[state.status];
  return (
    <section className="sync-state" aria-label="Vault sync">
      <div>Vault sync: {state.lastError === null ? label : `${label}: ${state.lastError}`}</div>
      <div className="hint">
        Last commit: {formatTime(state.lastCommitAt)}. Last push: {formatTime(state.lastPushAt)}.
      </div>
      {state.status === "conflict" && <VaultConflicts state={state} onState={onState} />}
      {state.withheldFiles.length > 0 && (
        <div>
          These files stay out of the vault&apos;s commits. Move the secret out of the file, or make it smaller:
          <ul>
            {state.withheldFiles.map((file) => (
              <li key={file.path}>
                {file.path} ({withheldReasons[file.reason]})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const pickLabels: Readonly<Record<ConflictChoice, string>> = {
  mine: "Keep mine",
  theirs: "Keep theirs",
  both: "Keep both",
};

/**
 * Each conflicted note with its three picks. The list loads again when the sync state changes,
 * so a sync that brings a new conflict shows it. The last pick pushes, and the new state goes up.
 */
function VaultConflicts({
  state,
  onState,
}: {
  state: VaultSyncState;
  onState: (state: VaultSyncState) => void;
}): ReactElement {
  const [conflicts, setConflicts] = useState<readonly VaultConflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The disabled buttons show only after a render, so two quick taps could send two picks.
  const picking = useRef(false);

  const load = (): void => {
    api
      .vaultConflicts()
      .then((report) => {
        setConflicts(report.conflicts);
        // The conflict can end elsewhere: a sync on another path, or a fix by hand. The parent then shows the new state.
        if (report.state.status !== "conflict") onState(report.state);
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : String(error)));
  };
  useEffect(load, [state.lastError, state.lastCommitAt]);

  const pick = async (path: string, choice: ConflictChoice): Promise<void> => {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    setNote(null);
    try {
      const result = await api.resolveVaultConflict(path, choice);
      if (result.found) {
        setConflicts(result.conflicts);
        onState(result.state);
      } else {
        // A refused pick (an Assistant turn runs) keeps the list, so the person can pick again.
        setNote(result.state.lastError ?? "That note has no conflict anymore.");
        load();
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      picking.current = false;
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="hint">
        &quot;Mine&quot; is this machine&apos;s version, &quot;theirs&quot; is the remote&apos;s. &quot;Keep both&quot;
        keeps mine and puts theirs in a copy beside the note. Git keeps both versions either way.
      </p>
      {conflicts === null && note === null && <div>Loading the conflicts…</div>}
      {conflicts?.length === 0 && <div>No note conflicts now.</div>}
      <ul>
        {conflicts?.map((conflict) => (
          <li key={conflict.path}>
            {conflict.path}
            {conflict.picked !== null && ` (picked: ${pickLabels[conflict.picked].toLowerCase()})`}
            {conflict.kind === "uncommitted" && (
              <div className="hint">Keep theirs leaves this machine&apos;s edit in git&apos;s stash.</div>
            )}
            <div className="check-row" role="group" aria-label={conflict.path}>
              {(["mine", "theirs", "both"] as const).map((choice) => (
                <button
                  key={choice}
                  disabled={busy}
                  aria-label={`${pickLabels[choice]}: ${conflict.path}`}
                  onClick={() => void pick(conflict.path, choice)}
                >
                  {pickLabels[choice]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {note !== null && <div role="alert">{note}</div>}
    </div>
  );
}

/** A date arrives from JSON as text. */
function formatTime(value: Date | string | null): string {
  return value === null ? "none since Eva started" : new Date(value).toLocaleString();
}
