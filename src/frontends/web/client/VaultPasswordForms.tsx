/**
 * Asks for the vault password, so this tab can open the vault's encrypted files (#707). The Files
 * page and Settings use it. Each unlock holds for this device's tab only, for 8 hours at most.
 */
import { useId, useState, type ReactElement, type SyntheticEvent } from "react";
import { minimumPasswordLength, newPasswordProblem } from "../../../shared/vault-unlock.ts";
import { api } from "./api.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

export function UnlockVaultForm({
  hasKey,
  onUnlocked,
}: {
  readonly hasKey: boolean;
  readonly onUnlocked: () => void;
}): ReactElement {
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Two forms can show at once, so each one names its own field and hint.
  const id = useId();
  if (!hasKey)
    return (
      <div role="status" className="callout">
        This vault has no password yet. Set one in Settings, on the Vault page.
      </div>
    );
  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="unlock-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`${id}-password`}>Vault password</label>
      <div className="inline-form">
        <input
          id={`${id}-password`}
          type="password"
          autoComplete="current-password"
          aria-describedby={`${id}-hint`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setProblem(null);
          }}
        />
        <button className="primary" type="submit" aria-busy={busy} disabled={busy || password === ""}>
          {busy && <ButtonSpinner />}
          Unlock
        </button>
      </div>
      {busy && <ProgressBar label="Eva checks the password…" />}
      <small id={`${id}-hint`} className="field-hint">
        This tab can then open encrypted files for 8 hours, until you lock it.
      </small>
      {problem !== null && (
        <div role="alert" className="callout danger">
          {problem}
        </div>
      )}
    </form>
  );
}

/**
 * Asks for a new vault password twice, so a typing mistake cannot lock the files away. Eva cannot
 * recover a lost password, so the form says so.
 */
export function NewPasswordForm({
  label,
  submitLabel,
  onSubmit,
}: {
  readonly label: string;
  readonly submitLabel: string;
  /** True when done. False keeps the typed passwords, such as when the person cancels a question. */
  readonly onSubmit: (password: string) => Promise<boolean>;
}): ReactElement {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = newPasswordProblem(password, again);
    setProblem(found);
    if (found !== null) return;
    setBusy(true);
    try {
      if (!(await onSubmit(password))) return;
      setPassword("");
      setAgain("");
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="unlock-form" aria-label={label} onSubmit={(event) => void submit(event)}>
      <NewPasswordFields
        label={label}
        password={password}
        again={again}
        onPassword={(value) => {
          setPassword(value);
          setProblem(null);
        }}
        onAgain={(value) => {
          setAgain(value);
          setProblem(null);
        }}
      />
      {problem !== null && (
        <div role="alert" className="callout danger">
          {problem}
        </div>
      )}
      <div className="button-row">
        <button className="primary" type="submit" aria-busy={busy} disabled={busy || password === "" || again === ""}>
          {busy && <ButtonSpinner />}
          {submitLabel}
        </button>
      </div>
      {busy && <ProgressBar label="Eva makes the key…" />}
    </form>
  );
}

/** The two fields of a new vault password and their hint, for a form that sends more than the password. */
export function NewPasswordFields({
  label,
  password,
  again,
  onPassword,
  onAgain,
}: {
  readonly label: string;
  readonly password: string;
  readonly again: string;
  readonly onPassword: (password: string) => void;
  readonly onAgain: (again: string) => void;
}): ReactElement {
  const hint = useId();
  return (
    <>
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          type="password"
          autoComplete="new-password"
          aria-describedby={hint}
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">The same password again</span>
        <input
          type="password"
          autoComplete="new-password"
          aria-describedby={hint}
          value={again}
          onChange={(event) => onAgain(event.target.value)}
        />
      </label>
      <small id={hint} className="field-hint">
        At least {minimumPasswordLength} characters. Eva encrypts your secret files with it. Nobody can recover a lost
        password: keep it in a password manager.
      </small>
    </>
  );
}
