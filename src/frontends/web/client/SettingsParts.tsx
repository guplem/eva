/**
 * The parts that every Settings page shares: the page context, a card, a status mark, a command
 * with Copy, a Test row, a write-only secret field, and the vault sync state.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  api,
  type CheckResult,
  type EvaSetupState,
  type EvaStatus,
  type PageSecretName,
  type PublicSettings,
  type VaultSyncState,
} from "./api.ts";
import { CopyButton } from "./CopyButton.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { helpOfCard } from "./help-links.ts";
import { HelpLink } from "./HelpLink.tsx";
import { NoteConflicts } from "./NoteConflicts.tsx";
import { restartNote, type Note } from "./notes.ts";
import { SaveButton } from "./SaveButton.tsx";
import { cardId, type SettingsRoute } from "./settings-routes.ts";
import type { StepMark } from "./setup-summary.ts";
import { syncStateWords, syncStatusLabels } from "./status-overview.ts";

/** What each Settings page gets from the shell around it. */
export interface SettingsContext {
  readonly settings: PublicSettings;
  /** Null until it loads. */
  readonly setup: EvaSetupState | null;
  readonly status: EvaStatus | null;
  /** Saves a change at once, such as a dropdown's value. True when the save worked. */
  readonly saveNow: (change: Record<string, unknown>) => Promise<boolean>;
  /** Shows a note in the sticky notice at the bottom. */
  readonly notify: (note: Note) => void;
  /** Shows a note and reads the setup steps again, as after a token save. */
  readonly noteAndReload: (note: Note) => void;
  /** Reads the setup steps and the open problems again, as after a vault sync. */
  readonly reloadSetup: () => void;
  readonly reloadSettings: () => void;
  readonly setStatus: (status: EvaStatus) => void;
  /** Opens the restart question, which names the running chats. With no running chat, restarts Eva at once. */
  readonly askRestart: () => void;
  readonly navigate: (route: SettingsRoute) => void;
  readonly onLoggedOut: () => void;
}

/**
 * A titled block of settings. `item` is the id that search results and links scroll to.
 * `cardHelp` in help-links.ts uses the same id to add the "?".
 */
export function Card({
  item,
  title,
  description,
  icon,
  aside,
  children,
}: {
  readonly item?: string;
  /** A round icon at the left of the title. */
  readonly icon?: IconName;
  readonly title: string;
  readonly description?: ReactNode;
  /** Such as a status pill, at the right of the title. */
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  const help = helpOfCard(item);
  return (
    <section className="card" id={item === undefined ? undefined : cardId(item)} aria-label={title}>
      <header className="card-header">
        {icon !== undefined && (
          <span className="card-icon">
            <Icon name={icon} />
          </span>
        )}
        <div className="card-heading">
          {help === null ? (
            <h2>{title}</h2>
          ) : (
            // The "?" sits by the title, so a wide aside, such as a button, keeps its room on a phone.
            <div className="card-title-row">
              <h2>{title}</h2>
              <HelpLink topic={help} place={title} />
            </div>
          )}
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

/** A round mark: a green check, an amber "!", a red "x" or a grey plus. The label names it for a screen reader. */
export function StatusIcon({
  state,
  size = "medium",
  label = stateLabels[state],
}: {
  readonly state: StepMark;
  readonly size?: "medium" | "large";
  /** A word that fits the page better, such as "Partly done". */
  readonly label?: string;
}): ReactElement {
  const name = iconOfMark[state];
  return (
    <span className={`status-icon ${state} ${size}`} role="img" aria-label={label}>
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
  return (
    <div className="command-line">
      <code>{command}</code>
      <CopyButton text={command} name={`Copy ${command}`} />
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
      <button
        aria-label={label}
        disabled={result === "running"}
        aria-busy={result === "running"}
        onClick={() => void run()}
      >
        {result === "running" && <ButtonSpinner />}
        {result === "running" ? "Testing…" : "Test"}
      </button>
      {result === "running" && (
        <div className="check-wait">
          <ProgressBar label={`${label.replace(/^Test /, "Testing ")}…`} />
        </div>
      )}
      <span
        role="status"
        className={result === null || result === "running" ? "" : `check-result ${resultClass(result)}`}
      >
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
  readonly onChanged: (note: Note) => void;
  /** After a save that worked, as when a login card shows as logged in again. */
  readonly onSaved?: () => void;
}

/**
 * A secret goes one way: the page sends it, and never gets it back. The field empties after a
 * save, and the line above it says only whether one is saved.
 */
export function SecretField({ name, label, saved, help, check, onChanged, onSaved }: SecretFieldProps): ReactElement {
  const [value, setValue] = useState("");
  const [isSaved, setIsSaved] = useState(saved);
  // The page loads the settings again after a save elsewhere on it.
  useEffect(() => {
    setIsSaved(saved);
  }, [saved]);
  const save = async (): Promise<boolean> => {
    try {
      await api.saveSecret(name, value);
      setValue("");
      setIsSaved(true);
      onSaved?.();
      onChanged(
        restartNote(
          check === undefined
            ? `Saved the ${label}. Press Restart Eva to use it in chats.`
            : `Saved the ${label}. Test uses it now. Press Restart Eva to use it in chats and sync.`,
        ),
      );
      return true;
    } catch (error) {
      onChanged(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  useLeaveGuard(value.trim() !== "", save);
  const remove = async (): Promise<void> => {
    if (!window.confirm(`Remove the ${label}?`)) return;
    try {
      await api.removeSecret(name);
      setIsSaved(false);
      onChanged(restartNote(`Removed the ${label}. Press Restart Eva to stop using it.`));
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
        <SaveButton className="primary" aria-label={`Save the ${label}`} disabled={value.trim() === ""} onSave={save}>
          Save
        </SaveButton>
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

// Offline and a conflict wait for the network or the person, so only an error is red.
const syncMarks: Readonly<Record<VaultSyncState["status"], StepMark>> = {
  ok: "done",
  offline: "missing",
  conflict: "missing",
  error: "failed",
  skipped: "optional",
};

const withheldReasons: Readonly<Record<VaultSyncState["withheldFiles"][number]["reason"], string>> = {
  secret: "looks like a secret",
  too_large: "larger than 50 MB",
  no_vault_key: "a secret file: set a vault password first",
  vault_key_changed: "a secret file: the vault's key changed",
  not_decryptable: "encrypted, but someone changed it",
  env_has_secret: "a .env with a key: move it to .env.local",
};

/** The last sync result, a conflict with its picks included, and the files that the secret scan held back. */
export function VaultSyncView({
  state,
  onState,
  autoSync,
}: {
  state: VaultSyncState;
  onState: (state: VaultSyncState) => void;
  autoSync?: boolean | undefined;
}): ReactElement {
  const label = syncStatusLabels[state.status];
  return (
    <section className="sync-state" aria-label="Vault sync">
      <div className="secret-state">
        <span className={`pill ${syncMarks[state.status]}`}>{label}</span>
        <span>Vault sync: {syncStateWords(state)}</span>
      </div>
      <div className="field-hint">
        Last commit: {formatTime(state.lastCommitAt)}. Last push: {formatTime(state.lastPushAt)}.
      </div>
      {autoSync === false && (
        <div className="callout warning">Automatic sync is off. Press Sync now to send your notes.</div>
      )}
      {state.status === "conflict" && <NoteConflicts state={state} onState={onState} />}
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

/** A date arrives from JSON as text. */
function formatTime(value: Date | string | null): string {
  return value === null ? "none since Eva started" : new Date(value).toLocaleString();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A choice list. */
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
  hint,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly { readonly value: T; readonly label: string; readonly icon?: IconName }[];
  readonly hint?: string;
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {hint !== undefined && <span className="field-hint">{hint}</span>}
      <div className="choice-chips" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            // A chip in a form must never send the form.
            type="button"
            className="choice-chip"
            aria-pressed={choice.value === value}
            onClick={() => onChange(choice.value)}
          >
            {choice.value === value && <Icon name="check" className="choice-tick" />}
            {choice.icon !== undefined && <Icon name={choice.icon} />}
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
