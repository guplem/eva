/** Starts a vault upgrade in a new Assistant chat (#773). The Vault structure card and the notification's action share it. */
import { vaultUpgradeRequest } from "../../../core/vault/upgrade-request.ts";
import { api } from "./api.ts";
import { goTo } from "./back-layers.ts";

export async function startVaultUpgrade(): Promise<void> {
  const chat = await api.newAssistantChat();
  await api.send(chat.id, vaultUpgradeRequest);
  goTo(`#/chat/${encodeURIComponent(chat.id)}`);
}
