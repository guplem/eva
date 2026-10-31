/**
 * Asks for the vault password, so this tab can open the vault's encrypted files (#707). The Files
 * page and Settings use it. Each unlock holds for this tab only, for 8 hours at most.
 */
import { useState, type ReactElement, type SyntheticEvent } from "react";
import { api } from "./api.ts";

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
