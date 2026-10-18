/** /update and its buttons: what the policy allows, and any newer version picked by hand, from the phone. */
import type { Eva } from "../../core/eva.ts";
import { describeRelease, describeUpdate } from "../cli/client.ts";
import { buttonsPerMessage } from "./telegram-files.ts";
import { splitForTelegram } from "./telegram-format.ts";
import { messageLimit, type TelegramSender } from "./telegram-sender.ts";

export interface TelegramUpdatesOptions {
  readonly eva: Eva;
  readonly sender: TelegramSender;
}

export class TelegramUpdates {
  private readonly eva: Eva;
  private readonly sender: TelegramSender;

  constructor(options: TelegramUpdatesOptions) {
    this.eva = options.eva;
    this.sender = options.sender;
  }

  /**
   * /update: checks, then offers an Install button for what the policy allows, and one button
   * for each newer version, so the person can go past the policy. It installs nothing by itself.
   */
  async offer(chatId: number, topicId: number | null): Promise<void> {
    await this.sender.send(chatId, topicId, "Checking for updates…");
    const update = await this.eva.checkForUpdate();
    if (update === null) {
      await this.sender.send(chatId, topicId, "This Eva cannot update herself.");
      return;
    }
    // While an update runs, a button could only start a second one.
    const buttons =
      update.phase !== "idle"
        ? []
        : [
            ...(update.target === null ? [] : [{ text: `Install ${update.target}`, callback_data: "u:next:go" }]),
            ...update.releases.map((release) => ({
              text: `${release.version} (${release.level})`,
              callback_data: `u:${release.version}`,
            })),
          ];
    const rows = buttons.slice(0, buttonsPerMessage).map((button) => [button]);
    await this.sender.send(
      chatId,
      topicId,
      update.releases.length === 0 || rows.length === 0
        ? describeUpdate(update)
        : `${describeUpdate(update)}\n\n${update.target === null ? "Pick" : "Install now, or pick"} a version to see what it brings:`,
      rows.length === 0 ? undefined : { inline_keyboard: rows },
    );
  }

  /** A version button: what the jump to it brings, breaking changes first, and an Install button. */
  async show(chatId: number, topicId: number | null, version: string): Promise<void> {
    const update = this.eva.updateStatus();
    const text = update === null ? null : describeRelease(update, version);
    if (text === null) {
      await this.sender.send(chatId, topicId, `${version} is not a newer release. Send /update to check again.`);
      return;
    }
    const parts = splitForTelegram(text, messageLimit);
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      await this.sender.send(
        chatId,
        topicId,
        part,
        last ? { inline_keyboard: [[{ text: `Install ${version}`, callback_data: `u:${version}:go` }]] } : undefined,
      );
    }
  }
}
