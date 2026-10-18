/**
 * Starts the Telegram bot of a running Eva. Telegram runs on the hub instance only (lesson 56),
 * whenever it has a bot token, so the bot starts or stops when the hub moves.
 */
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import type { Eva } from "../../core/eva.ts";
import type { MachineRole } from "../../core/instance/hub.ts";
import { loadSecrets, type HomePaths } from "../../core/settings/home.ts";
import { changeSettings, loadSettings } from "../../core/settings/settings.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import { HttpTelegramApi, type TelegramApi } from "./telegram-api.ts";
import { TelegramBot } from "./telegram-bot.ts";

export interface TelegramStartOptions {
  readonly paths: HomePaths;
  readonly eva: Eva;
  readonly logger?: Logger;
  /** A line for the person at the console. */
  readonly writeLine: (line: string) => void;
  /** The Bot API for a token. Default: Telegram itself. */
  readonly api?: (token: string) => TelegramApi;
}

/** Starts the bot when a bot token is saved, with a pairing code while no chat is paired. Null without a token. */
export function startTelegram(options: TelegramStartOptions): TelegramBot | null {
  const { paths } = options;
  const config = loadSettings(paths).config;
  const token = loadSecrets(paths).telegramBotToken;
  if (token === undefined) return null;
  let pairingCode = "";
  if (config.telegram.allowedChatId === null) {
    pairingCode = `EVA-${randomBytes(4).toString("hex").toUpperCase()}`;
    writeFileAtomic(paths.telegramPairingCode, pairingCode);
    options.writeLine(`Telegram is not paired yet. Send ${pairingCode} to your bot.`);
  }
  const bot = new TelegramBot({
    api: options.api?.(token) ?? new HttpTelegramApi({ token }),
    eva: options.eva,
    statePath: paths.telegramState,
    allowedChatId: config.telegram.allowedChatId,
    allowedUserId: config.telegram.allowedUserId,
    pairingCode,
    onPaired: (chatId, userId) => {
      changeSettings(paths, { telegram: { allowedChatId: chatId, allowedUserId: userId } });
      rmSync(paths.telegramPairingCode, { force: true });
      options.logger?.log("info", "Telegram paired.");
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.eva.transcribe === null ? {} : { transcribe: options.eva.transcribe }),
  });
  void bot.run();
  return bot;
}

interface StoppableBot {
  stop(): Promise<void>;
}

/** Keeps a bot running while this machine is the hub, and none while it is a satellite. */
export class HubTelegram {
  private readonly start: () => StoppableBot | null;
  private bot: StoppableBot | null;
  private readonly unsubscribe: () => void;

  constructor(eva: Eva, start: () => StoppableBot | null) {
    this.start = start;
    this.bot = null;
    void this.follow(eva.role());
    this.unsubscribe = eva.onRoleChange((role) => {
      void this.follow(role);
    });
  }

  /** Stops the bot, if one runs, and stops following the role. */
  async stop(): Promise<void> {
    this.unsubscribe();
    const running = this.bot;
    this.bot = null;
    await running?.stop();
  }

  private async follow(role: MachineRole): Promise<void> {
    if (role === "hub" && this.bot === null) {
      this.bot = this.start();
    } else if (role === "satellite" && this.bot !== null) {
      const stopping = this.bot;
      this.bot = null;
      await stopping.stop();
    }
  }
}
