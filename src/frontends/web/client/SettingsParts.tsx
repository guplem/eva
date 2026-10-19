/**
 * The parts that every Settings page shares: the page context, a card, a status mark, a command
 * with Copy, a Test row, a write-only secret field, and the vault sync state.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  api,
  type CheckResult,
  type ConflictChoice,
  type EvaSetupState,
  type EvaStatus,
  type PageSecretName,
  type PublicSettings,
  type VaultConflict,
  type VaultSyncState,
} from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { cardId, type SettingsRoute } from "./settings-routes.ts";
import type { StepMark } from "./setup-summary.ts";

/** What each Settings page gets from the shell around it. */
export interface SettingsContext {
  readonly settings: PublicSettings;
  /** Null until it loads. */
  readonly setup: EvaSetupState | null;
  readonly status: EvaStatus | null;
  /** Saves a change at once, such as a dropdown's value. True when the save worked. */
  readonly saveNow: (change: Record<string, unknown>) => Promise<boolean>;
  /** Shows a note in the sticky notice at the bottom. */
  readonly notify: (note: string) => void;
  /** Shows a note and reads the setup steps again, as after a token save. */
  readonly noteAndReload: (note: string) => void;
  readonly reloadSettings: () => void;
  readonly setStatus: (status: EvaStatus) => void;
  /** Opens the restart question, which names the running chats. */
  readonly askRestart: () => void;
  readonly navigate: (route: SettingsRoute) => void;
  readonly onLoggedOut: () => void;
}

/** A titled block of settings. `item` gives it the id that search results and links scroll to. */
export function Card({
  item,
  title,
  description,
  aside,
  children,
}: {
  readonly item?: string;
  readonly title: string;
  readonly description?: ReactNode;
  /** Such as a status pill, at the right of the title. */
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section className="card" id={item === undefined ? undefined : cardId(item)} aria-label={title}>
      <header className="card-header">
        <div className="card-heading">
          <h2>{title}</h2>
          {description !== undefined && <p className="card-description">{description}</p>}
        </div>
        {aside}
      </header>
      {children !== undefined && <div className="card-body">{children}</div>}
    </section>
  );
}

const stateLabels: Readonly<Record<StepMark, string>> = {
  done: "Done",
  missing: "Needs you",
  optional: "Optional",
  failed: "Failed",
};

// The marks of the EVE design: a step to do shows `alert`, and an optional step matches its "Add" button.
const iconOfMark: Readonly<Record<StepMark, IconName>> = {
  done: "check",
  missing: "alert",
  optional: "plus",
  failed: "x",
};

/** The result of a test: a named mark, so a screen reader also hears whether it passed. */
export function TestMark({ ok, detail }: { readonly ok: boolean; readonly detail: string }): ReactElement {
  return (
    <>
      <Icon name={ok ? "check" : "x"} label={ok ? "Passed" : "Failed"} /> {detail}
    </>
  );
}

/** A round mark: a green check, a red "!", a red "x" or a grey plus. The label names it for a screen reader. */
export function StatusIcon({
  state,
  size = "medium",
}: {
  readonly state: StepMark;
  readonly size?: "medium" | "large";
}): ReactElement {
  const name = iconOfMark[state];
  return (
    <span className={`status-icon ${state} ${size}`} role="img" aria-label={stateLabels[state]}>
      <Icon name={name} />
    </span>
  );
}

export function StatusPill({ state }: { readonly state: StepMark }): ReactElement {
  return <span className={`pill ${state}`}>{stateLabels[state]}</span>;
}

/** Text from the core marks a command with backticks; the page shows it as code. */
export function RichText({ text }: { readonly text: string }): ReactElement {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

/** A command to type on a computer, with a Copy button, so a person never retypes it. */
export function CommandLine({ command }: { readonly command: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  // The clipboard exists only on a secure page; a page through a plain http host name has none.
  const canCopy = typeof navigator.clipboard !== "undefined";
  return (
    <div className="command-line">
      <code>{command}</code>
      {canCopy && (
        <button
          className="ghost"
          aria-label={`Copy ${command}`}
          onClick={() => {
            navigator.clipboard
              .writeText(command)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          <Icon name="copy" />
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

/** A numbered list of what to do. Each step is short, so a person who is new to this can follow it. */
export function Steps({ children }: { readonly children: ReactNode }): ReactElement {
  return <ol className="guide-steps">{children}</ol>;
}

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
      <span className="check-label">{label}</span>
      <button aria-label={label} disabled={result === "running"} onClick={() => void run()}>
        {result === "running" ? "Testing…" : "Test"}
      </button>
      <span
        role="status"
        className={result === null ? "" : result === "running" ? "check-result" : `check-result ${resultClass(result)}`}
      >
        {result === "running" && "Testing…"}
        {result !== null && result !== "running" && <TestMark ok={result.ok} detail={result.detail} />}
      </span>
    </div>
  );
}

function resultClass(result: CheckResult): string {
  return result.ok ? "ok" : "failed";
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
      onChanged(
        check === undefined
          ? `Saved the ${label}. Press Restart Eva to use it in chats.`
          : `Saved the ${label}. Test uses it now. Press Restart Eva to use it in chats and sync.`,
      );
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
    <div className="secret-field">
      <div className="secret-state">
        <span className={`pill ${isSaved ? "done" : "optional"}`}>{isSaved ? "Saved" : "Not saved"}</span>
        <span>{isSaved ? `A ${label} is saved.` : `No ${label} is saved.`}</span>
      </div>
      <div className="field-hint">{help}</div>
      <div className="inline-form">
        <input
          type="password"
          autoComplete="off"
          aria-label={label}
          placeholder={isSaved ? "Paste a new one to replace it" : "Paste it here"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          className="primary"
          aria-label={`Save the ${label}`}
          disabled={value.trim() === ""}
          onClick={() => void save()}
        >
          Save
        </button>
        {isSaved && (
          <button className="ghost danger" aria-label={`Remove the ${label}`} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {check !== undefined && <CheckRow name={check} label={`Test the ${label}`} />}
    </div>
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
      <div className="secret-state">
        <span
          className={`pill ${state.status === "ok" ? "done" : state.status === "skipped" ? "optional" : "missing"}`}
        >
          {label}
        </span>
        <span>Vault sync: {state.lastError === null ? label : `${label}: ${state.lastError}`}</span>
      </div>
      <div className="field-hint">
        Last commit: {formatTime(state.lastCommitAt)}. Last push: {formatTime(state.lastPushAt)}.
      </div>
      {state.status === "conflict" && <VaultConflicts state={state} onState={onState} />}
      {state.withheldFiles.length > 0 && (
        <div className="callout warning">
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
    <div className="callout danger">
      <p className="field-hint">
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
              <div className="field-hint">Keep theirs leaves this machine&apos;s edit in git&apos;s stash.</div>
            )}
            <div className="button-row" role="group" aria-label={conflict.path}>
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

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A choice list that saves at once. */
export function SelectField<T extends string>({
  label,
  value,
  choices,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly hint?: ReactNode;
}): ReactElement {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {hint !== undefined && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** A choice of few values as a row of chips that saves at once. The pressed chip is the current value. */
export function ChoiceChips<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly { readonly value: T; readonly label: string; readonly icon?: IconName }[];
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="choice-chips" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            className="choice-chip"
            aria-pressed={choice.value === value}
            onClick={() => onChange(choice.value)}
          >
            {choice.icon !== undefined && <Icon name={choice.icon} />}
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
