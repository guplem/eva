/**
 * The vault's encrypted files (#707): the vault password, the list of secret files, and each
 * removal from the list that waits for the person. Eva encrypts each secret file before it leaves
 * the machine, so the vault's remote never holds its plain text.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type VaultSecretsStatus } from "./api.ts";
import { ListSkeleton } from "./Loading.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card, errorText } from "./SettingsParts.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { NewPasswordForm, UnlockVaultForm } from "./VaultPasswordForms.tsx";

export function EncryptedFilesCard(): ReactElement {
  const [status, setStatus] = useState<VaultSecretsStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.vaultSecrets());
      setProblem(null);
    } catch (caught) {
      setProblem(errorText(caught));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change and shows the new state. A password form shows its own failure, so this throws. */
  const apply = async (change: () => Promise<VaultSecretsStatus>, done: string | null): Promise<void> => {
    setNote(null);
    setStatus(await change());
    setProblem(null);
    setNote(done);
  };

  /** The same for a button, which shows the failure in the card. */
  const act = async (change: () => Promise<VaultSecretsStatus>, done: string | null): Promise<boolean> => {
    try {
      await apply(change, done);
      return true;
    } catch (caught) {
      setProblem(errorText(caught));
      return false;
    }
  };

  const confirmRemovals = async (): Promise<boolean> => {
    let decrypted = 0;
    const done = await act(async () => {
      decrypted = (await api.confirmSecretRemovals(status?.waiting ?? [], status?.waitingFiles ?? [])).decrypted.length;
      return api.vaultSecrets();
    }, null);
    if (done) setNote(`Eva decrypted ${String(decrypted)} files. The vault sync sends them as they are now.`);
    return done;
  };

  return (
    <Card
      item="encrypted-files"
      icon="lock"
      title="Encrypted files"
      description="Eva encrypts each secret file of your vault, such as a key or a .env.local file, before it leaves this machine. The Files page opens them with the vault password."
    >
      {problem !== null && (
        <div role="alert" className="callout danger">
          {problem}
        </div>
      )}
      {note !== null && (
        <div role="status" className="callout">
          {note}
        </div>
      )}
      {status === null ? (
        problem === null && <ListSkeleton label="Loading the encrypted files…" rows={3} />
      ) : !status.hasKey ? (
        <NoPassword
          onSet={(password) =>
            apply(() => api.setVaultPassword(password), "The vault password is set. Eva encrypted the secret files.")
          }
        />
      ) : (
        <>
          {status.keyChanged && (
            <KeyChanged
              status={status}
              onUnlocked={() => void load()}
              onAccept={() => act(api.acceptVaultKey, "Eva uses the new key now.")}
            />
          )}
          <UnlockState
            status={status}
            onUnlocked={() => void load()}
            onLock={() => void act(api.lockVault, "This tab is locked.")}
          />
          <SecretPatterns
            key={`${status.added.join("\n")}|${status.defaults.map((each) => String(each.on)).join()}`}
            status={status}
            onSave={(added, off) => act(() => api.setSecretPatterns(added, off), "Eva saved the list.")}
          />
          {status.waiting.length > 0 && <WaitingRemovals status={status} onConfirm={confirmRemovals} />}
          {status.unlocked && !status.keyChanged && (
            <PasswordChanges
              onChange={(password) => apply(() => api.changeVaultPassword(password), "The vault password changed.")}
              onNewKey={(password) =>
                apply(
                  () => api.newVaultKey(password),
                  "Eva made a new key and encrypted every file again. Each device must unlock again.",
                )
              }
            />
          )}
        </>
      )}
    </Card>
  );
}

function NoPassword({ onSet }: { readonly onSet: (password: string) => Promise<void> }): ReactElement {
  return (
    <>
      <div role="status" className="callout warning">
        This vault has no password yet, so Eva keeps each secret file on this machine and syncs none of them. Set a
        password to encrypt them and sync them.
      </div>
      <NewPasswordForm
        label="New vault password"
        submitLabel="Set the password"
        onSubmit={async (password) => {
          await onSet(password);
        }}
      />
    </>
  );
}

function KeyChanged({
  status,
  onUnlocked,
  onAccept,
}: {
  readonly status: VaultSecretsStatus;
  readonly onUnlocked: () => void;
  readonly onAccept: () => Promise<boolean>;
}): ReactElement {
  return (
    <div role="alert" className="callout warning">
      <p>
        The vault's key changed on another machine. Eva encrypts no new secret file until you confirm the new key. If
        you did not make a new key, someone else may have: do not confirm it.
      </p>
      {status.unlocked ? (
        <SaveButton className="primary" onSave={onAccept}>
          Use the new key
        </SaveButton>
      ) : (
        <UnlockVaultForm hasKey={true} onUnlocked={onUnlocked} />
      )}
    </div>
  );
}

function UnlockState({
  status,
  onUnlocked,
  onLock,
}: {
  readonly status: VaultSecretsStatus;
  readonly onUnlocked: () => void;
  readonly onLock: () => void;
}): ReactElement | null {
  // A changed key asks for the unlock in its own warning.
  if (status.keyChanged && !status.unlocked) return null;
  if (!status.unlocked) return <UnlockVaultForm hasKey={true} onUnlocked={onUnlocked} />;
  return (
    <div className="button-row">
      <span className="status-pill done">This tab is unlocked</span>
      <button className="ghost" onClick={onLock}>
        Lock
      </button>
    </div>
  );
}

function SecretPatterns({
  status,
  onSave,
}: {
  readonly status: VaultSecretsStatus;
  readonly onSave: (added: readonly string[], off: readonly string[]) => Promise<boolean>;
}): ReactElement {
  const savedOff = status.defaults.filter((each) => !each.on).map((each) => each.pattern);
  const savedAdded = status.added.join("\n");
  const [off, setOff] = useState<readonly string[]>(savedOff);
  const [added, setAdded] = useState(savedAdded);
  const lines = added
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const changed = lines.join("\n") !== savedAdded || [...off].sort().join("\n") !== [...savedOff].sort().join("\n");
  const save = (): Promise<boolean> => onSave(lines, off);
  useLeaveGuard(changed, save);
  return (
    <div className="unlock-form">
      <span className="field-label">Secret files that Eva encrypts</span>
      <ul className="secret-patterns" aria-label="Default secret files">
        {status.defaults.map(({ pattern }) => {
          const on = !off.includes(pattern);
          return (
            <li key={pattern}>
              <code>{pattern}</code>
              <button
                className="toggle"
                role="switch"
                aria-checked={on}
                aria-label={`Encrypt ${pattern}`}
                onClick={() => setOff(on ? [...off, pattern] : off.filter((each) => each !== pattern))}
              />
            </li>
          );
        })}
      </ul>
      <label className="field">
        <span className="field-label">Your own patterns, one per line, as in a .gitignore file</span>
        <textarea
          value={added}
          placeholder={"Life/Health/**\n*.kdbx"}
          spellCheck={false}
          onChange={(event) => setAdded(event.target.value)}
        />
      </label>
      <small className="field-hint">
        A new pattern encrypts its files at once. A pattern that you take out keeps its files encrypted until you
        confirm it below.
      </small>
      <div className="save-bar">
        <SaveButton className="primary" disabled={!changed} onSave={save}>
          Save the list
        </SaveButton>
      </div>
    </div>
  );
}

function WaitingRemovals({
  status,
  onConfirm,
}: {
  readonly status: VaultSecretsStatus;
  readonly onConfirm: () => Promise<boolean>;
}): ReactElement {
  return (
    <div role="status" className="callout warning">
      <p>
        These patterns still apply, though the list no longer asks for them. When you confirm, Eva decrypts their files,
        and the vault's remote gets the plain text.
      </p>
      <ul aria-label="Patterns that wait">
        {status.waiting.map((pattern) => (
          <li key={pattern}>
            <code>{pattern}</code>
          </li>
        ))}
      </ul>
      {/* An agent can copy encrypted files under such a name, so the person sees each file before it opens. */}
      {status.waitingFiles.length === 0 ? (
        <p>No encrypted file matches them now.</p>
      ) : (
        <>
          <p>Eva decrypts these files:</p>
          <ul aria-label="Files that Eva decrypts">
            {status.waitingFiles.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {status.unlocked ? (
        <SaveButton className="danger" onSave={onConfirm}>
          Confirm and decrypt
        </SaveButton>
      ) : (
        <p>Unlock this tab above to confirm.</p>
      )}
    </div>
  );
}

function PasswordChanges({
  onChange,
  onNewKey,
}: {
  readonly onChange: (password: string) => Promise<void>;
  readonly onNewKey: (password: string) => Promise<void>;
}): ReactElement {
  return (
    <details className="secret-password-changes">
      <summary>Change the password</summary>
      <NewPasswordForm
        label="New vault password"
        submitLabel="Change the password"
        onSubmit={async (password) => {
          await onChange(password);
        }}
      />
      <p className="field-hint">
        If the old password leaked, make a new key instead. Eva then encrypts every file again, and the old password
        opens nothing new. Old commits still open with the old password.
      </p>
      <NewPasswordForm
        label="Password of the new key"
        submitLabel="Make a new key"
        onSubmit={async (password) => {
          if (!window.confirm("Make a new key? Every device must unlock again.")) return;
          await onNewKey(password);
        }}
      />
    </details>
  );
}
