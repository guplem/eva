/**
 * The Vault structure card (#773): the structure version that the vault follows, the newest one, what
 * it changes, and the button that starts the upgrade in a new chat. Only the hub upgrades the vault.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type VaultStructureView } from "./api.ts";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { startVaultUpgrade } from "./vault-upgrade-chat.ts";

export function VaultStructureCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const [structure, setStructure] = useState<VaultStructureView | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = context;

  useEffect(() => {
    api
      .vaultStructure()
      .then(setStructure)
      .catch((error: unknown) => notify(errorText(error)));
  }, [notify]);

  const upgrade = async (): Promise<void> => {
    setBusy(true);
    try {
      await startVaultUpgrade();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const available = structure !== null && structure.available > structure.current;
  return (
    <Card
      item="vault-structure"
      title="Vault structure"
      description="How the folders and notes of your vault are organized. An Eva update never changes it. When a new structure comes, you choose when Eva moves your notes to it, with you, in a chat."
      aside={
        structure === null ? undefined : (
          <span className={`pill ${available ? "warn" : "ok"}`}>{available ? "Update available" : "Up to date"}</span>
        )
      }
    >
      {structure === null ? (
        <ProgressBar label="Eva reads the vault…" />
      ) : (
        <>
          <p>
            {available
              ? `Your vault follows version ${String(structure.current)}. Version ${String(structure.available)} is available. ${structure.summary}`.trim()
              : `Your vault follows version ${String(structure.current)}, the newest structure.`}
          </p>
          {available && !structure.canUpgrade && (
            <div className="field-hint">Only the hub computer updates the vault structure. Open its page to start.</div>
          )}
          {available && (
            <div className="button-row">
              <button className="primary" disabled={!structure.canUpgrade || busy} onClick={() => void upgrade()}>
                Update the vault
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
