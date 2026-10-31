/**
 * Asks for the vault password, so this tab can open the vault's encrypted files (#707). The Files
 * page and Settings use it. Each unlock holds for this tab only, for 8 hours at most.
 */
import { useState, type ReactElement, type SyntheticEvent } from "react";
import { minimumPasswordLength, newPasswordProblem } from "../../../shared/vault-unlock.ts";
import { api } from "./api.ts";
import { ButtonSpinner } from "./Loading.tsx";

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
      <label htmlFor="vault-password">Vault password</label>
      <div className="inline-form">
        <input
          id="vault-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setProblem(null);
          }}
        />
        <button className="primary" type="submit" disabled={busy || password === ""}>
          Unlock
        </button>
      </div>
      <small className="field-hint">This tab can then open encrypted files for 8 hours, until you lock it.</small>
      {problem !== null && (
        <span role="alert" className="callout danger">
          {problem}
        </span>
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
  readonly onSubmit: (password: string) => Promise<void>;
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
      await onSubmit(password);
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
        <span role="alert" className="callout danger">
          {problem}
        </span>
      )}
      <div className="button-row">
        <button className="primary" type="submit" disabled={busy || password === "" || again === ""}>
          {busy && <ButtonSpinner />}
          {submitLabel}
        </button>
      </div>
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
  return (
    <>
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">The same password again</span>
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => onAgain(event.target.value)}
        />
      </label>
      <small className="field-hint">
        At least {minimumPasswordLength} characters. Eva encrypts your secret files with it. Nobody can recover a lost
        password: keep it in a password manager.
      </small>
    </>
  );
}
