/**
 * /link and its buttons: the address, or the Tailscale setup steps with a button for each step
 * that Eva can do. Before Tailscale works, this chat is the only way from the phone to Eva.
 */
import type { Eva } from "../../core/eva.ts";
import type { RemoteAccess } from "../../core/remote-access/remote-access.ts";
import { actionLabel, describeAccess, remoteAccessStep, setupSteps } from "../../core/remote-access/steps.ts";
import type { TelegramSender } from "./telegram-sender.ts";

const installPollMs = 3_000;
/** The Windows installer can wait for a person at the machine; the watcher's own run ends at 15 minutes. */
const installWaitLimitMs = 16 * 60_000;

export interface TelegramRemoteAccessOptions {
  readonly eva: Eva;
  readonly sender: TelegramSender;
  /** Waits between two reads of the install, and returns early when the bot stops. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
}

export class TelegramRemoteAccess {
  private readonly options: TelegramRemoteAccessOptions;

  constructor(options: TelegramRemoteAccessOptions) {
    this.options = options;
  }

  /** The address, or the setup steps with a button for each step that Eva can do. */
  async show(chatId: number, topicId: number | null, access: RemoteAccess | null): Promise<void> {
    const localUrl = this.options.eva.status().localUrl;
    const actions =
      access === null ? [] : setupSteps(access).flatMap((step) => (step.action === null ? [] : [step.action]));
    const buttons = actions.map((action) => ({ text: actionLabel(action), callback_data: `t:${action}` }));
    await this.options.sender.send(
      chatId,
      topicId,
      describeAccess({ remoteAccess: access, localUrl }).join("\n"),
      buttons.length === 0 ? undefined : { inline_keyboard: [buttons] },
    );
  }

  /**
   * A button press. The bot runs it apart from its poll loop: an install takes minutes, and
   * `tailscale up` waits for its link.
   */
  async run(chatId: number, topicId: number | null, action: "install" | "sign_in"): Promise<void> {
    const eva = this.options.eva;
    const send = (text: string): Promise<number | null> => this.options.sender.send(chatId, topicId, text);
    const before = eva.status().remoteAccess;
    if (before === null) {
      await send("Phone access is off on this machine.");
      return;
    }
    // A second tap must not start a second wait, which would post a second answer.
    if ((before.busy ?? null) !== null) {
      await send("Eva is on it already. Send /link in a moment to see the result.");
      return;
    }
    if (action === "sign_in") {
      // The sign-in starts before the first message, so a second tap during the send finds it busy.
      const signedIn = eva.signInToTailscale();
      await send("Asking Tailscale for a sign-in link…");
      await this.show(chatId, topicId, await signedIn);
      return;
    }
    // A tap on an old message: the install step may be over, or Eva may not install here.
    if (before.canInstall !== true || remoteAccessStep(before) !== "install") {
      await this.show(chatId, topicId, before);
      return;
    }
    eva.installTailscale();
    await send("Installing Tailscale… Eva answers here when it ends.");
    await this.show(chatId, topicId, await this.waitForInstall());
  }

  /** Waits until the install ends, reading the status as the web page does. */
  private async waitForInstall(): Promise<RemoteAccess | null> {
    for (let waited = 0; waited < installWaitLimitMs && !this.options.stopped(); waited += installPollMs) {
      const access = this.options.eva.status().remoteAccess;
      if (access?.busy !== "installing") return access;
      await this.options.sleep(installPollMs);
    }
    return this.options.eva.status().remoteAccess;
  }
}
