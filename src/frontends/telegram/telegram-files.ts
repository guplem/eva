/** Files between Telegram and the vault: downloads of received files, and uploads of vault files (lessons 72, 124). */
import { readFileSync } from "node:fs";
import { OfferStore, resolveSendableFile } from "../../core/files/vault-files.ts";
import type { TelegramApi } from "./telegram-api.ts";
import { threadOf, type TelegramFile } from "./telegram-messages.ts";
import type { TelegramSender } from "./telegram-sender.ts";

/** Telegram lets a bot download at most 20 MB. */
const maxDownloadBytes = 20 * 1024 * 1024;
/** Telegram refuses a keyboard of more than 100 buttons. */
export const buttonsPerMessage = 50;

export interface TelegramFilesOptions {
  readonly api: TelegramApi;
  readonly sender: TelegramSender;
  /** The vault folder now, or null when no vault is configured. */
  readonly vaultPath: () => string | null;
  /** An error for the chat, with the secrets removed. */
  readonly describeError: (error: unknown) => string;
  /** The file of the offered files' button ids. */
  readonly offersPath: string;
}

export class TelegramFiles {
  private readonly options: TelegramFilesOptions;
  private readonly offers: OfferStore;

  constructor(options: TelegramFilesOptions) {
    this.options = options;
    this.offers = new OfferStore(options.offersPath);
  }

  /** Downloads a file that a message holds. Returns null, after a sentence in the chat, when it fails. */
  async download(chatId: number, topicId: number | null, file: TelegramFile): Promise<Uint8Array | null> {
    if ((file.file_size ?? 0) > maxDownloadBytes) {
      await this.options.sender.send(chatId, topicId, "Telegram lets Eva download files up to 20 MB only.");
      return null;
    }
    try {
      const described = await this.options.api.call<{ file_path?: string }>("getFile", { file_id: file.file_id });
      if (described.file_path === undefined) throw new Error("Telegram gave no file path");
      return await this.options.api.download(described.file_path);
    } catch (error) {
      await this.options.sender.send(
        chatId,
        topicId,
        `The file could not be downloaded: ${this.options.describeError(error)}`,
      );
      return null;
    }
  }

  /** Uploads a vault file, after the path check; a refused or failed file gets a sentence (lesson 72). */
  async sendVaultFile(chatId: number, topicId: number | null, requested: string): Promise<void> {
    const vaultPath = this.options.vaultPath();
    const file = vaultPath === null ? null : resolveSendableFile(vaultPath, requested);
    if (file?.ok !== true) {
      await this.options.sender.send(chatId, topicId, file?.reason ?? "No vault is configured.");
      return;
    }
    try {
      await this.options.api.upload(
        "sendDocument",
        { chat_id: chatId, ...threadOf(topicId) },
        { field: "document", name: file.name, bytes: new Uint8Array(readFileSync(file.path)) },
      );
    } catch (error) {
      await this.options.sender.send(
        chatId,
        topicId,
        `Telegram did not take ${file.relativePath}: ${this.options.describeError(error)}`,
      );
    }
  }

  /** Offered files become buttons; nothing uploads until a press (lesson 124). */
  async offerFiles(chatId: number, topicId: number | null, paths: readonly string[]): Promise<void> {
    const vaultPath = this.options.vaultPath();
    const buttons: { text: string; callback_data: string }[] = [];
    for (const requested of paths) {
      const file = vaultPath === null ? null : resolveSendableFile(vaultPath, requested);
      if (file?.ok !== true) {
        await this.options.sender.send(chatId, topicId, file?.reason ?? "No vault is configured.");
        continue;
      }
      buttons.push({ text: file.name, callback_data: `f:${this.offers.idFor(file.relativePath)}` });
    }
    for (let start = 0; start < buttons.length; start += buttonsPerMessage) {
      await this.options.sender.send(chatId, topicId, "Files you can open:", {
        inline_keyboard: buttons.slice(start, start + buttonsPerMessage).map((button) => [button]),
      });
    }
  }

  /** The press of an offered file's button: the upload, or a sentence when the offer is gone. */
  async sendOffered(chatId: number, topicId: number | null, offerId: string): Promise<void> {
    const path = this.offers.pathFor(offerId);
    if (path === null) await this.options.sender.send(chatId, topicId, "That file is no longer available.");
    else await this.sendVaultFile(chatId, topicId, path);
  }
}
