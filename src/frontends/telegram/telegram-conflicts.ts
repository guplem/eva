/** /conflicts and its buttons: a version pick for each vault note that conflicts, from the phone. */
import type { Eva } from "../../core/eva.ts";
import { OfferStore } from "../../core/files/vault-files.ts";
import type { ConflictChoice, ConflictResolution } from "../../core/vault/vault-sync.ts";
import { describeSync } from "../cli/client.ts";
import type { TelegramSender } from "./telegram-sender.ts";

/** At most this many conflict messages per /conflicts: more is hard to follow on a phone. */
const conflictListLimit = 10;
/** The letter of each pick in the button data, which Telegram limits to 64 bytes. */
const pickLetters = { m: "mine", t: "theirs", b: "both" } as const satisfies Record<string, ConflictChoice>;
const pickLabels: Readonly<Record<ConflictChoice, string>> = {
  mine: "Keep mine",
  theirs: "Keep theirs",
  both: "Keep both",
};

export interface TelegramConflictsOptions {
  readonly eva: Eva;
  readonly sender: TelegramSender;
  /** The file of the ids behind the conflict buttons, apart from the file offers. */
  readonly offersPath: string;
}

export class TelegramConflicts {
  private readonly eva: Eva;
  private readonly sender: TelegramSender;
  private readonly conflictOffers: OfferStore;

  constructor(options: TelegramConflictsOptions) {
    this.eva = options.eva;
    this.sender = options.sender;
    this.conflictOffers = new OfferStore(options.offersPath);
  }

  /** /conflicts: one message per conflicted note, each with the three picks. */
  async list(chatId: number, topicId: number | null): Promise<void> {
    const { state, conflicts } = await this.eva.vaultConflicts();
    if (conflicts.length === 0) {
      await this.sender.send(
        chatId,
        topicId,
        state.status === "error" ? describeSync(state) : "The vault has no conflict.",
      );
      return;
    }
    const plural = conflicts.length === 1 ? "note conflicts" : "notes conflict";
    await this.sender.send(
      chatId,
      topicId,
      `${String(conflicts.length)} ${plural}. "Mine" is this machine's version, "theirs" is the remote's. "Keep both" keeps mine and puts theirs in a copy beside the note. Git keeps both versions either way.`,
    );
    // A committed conflict keeps its picked notes in the list, so the notes that wait for a pick come first.
    const waitingFirst = [...conflicts].sort((a, b) => Number(a.picked !== null) - Number(b.picked !== null));
    for (const conflict of waitingFirst.slice(0, conflictListLimit)) {
      const id = this.conflictOffers.idFor(conflict.path);
      const what =
        conflict.kind === "committed"
          ? "changed here and on the remote."
          : "has an edit here that clashes with the remote. Keep theirs leaves this machine's edit in git's stash.";
      const picked = conflict.picked === null ? "" : ` Picked: ${pickLabels[conflict.picked].toLowerCase()}.`;
      await this.sender.send(chatId, topicId, `${conflict.path} ${what}${picked}`, {
        inline_keyboard: [
          Object.entries(pickLetters).map(([letter, choice]) => ({
            text: pickLabels[choice],
            callback_data: `c:${id}:${letter}`,
          })),
        ],
      });
    }
    if (conflicts.length > conflictListLimit)
      await this.sender.send(chatId, topicId, `Pick these first, then send /conflicts for the other notes.`);
  }

  async pick(chatId: number, topicId: number | null, id: string, letter: string): Promise<void> {
    const path = this.conflictOffers.pathFor(id);
    const choice = Object.entries(pickLetters).find(([key]) => key === letter)?.[1];
    if (path === null || choice === undefined) {
      await this.sender.send(chatId, topicId, "That note has no conflict anymore. Send /conflicts to see the list.");
      return;
    }
    const result = await this.eva.resolveVaultConflict(path, choice);
    await this.sender.send(chatId, topicId, describePick(path, choice, result));
  }
}

/** The answer to a conflict button: what Eva did, and what is left. */
function describePick(path: string, choice: ConflictChoice, result: ConflictResolution): string {
  if (!result.found) {
    return result.state.status !== "ok" && result.state.lastError !== null
      ? describeSync(result.state)
      : "That note has no conflict anymore. Send /conflicts to see the list.";
  }
  const done = `${pickLabels[choice]}: ${path}.`;
  const waiting = result.conflicts.filter((conflict) => conflict.picked === null).length;
  if (waiting > 0)
    return `${done} ${String(waiting)} more ${waiting === 1 ? "note waits" : "notes wait"} for a pick: send /conflicts.`;
  return result.state.status === "ok" ? `${done} The vault syncs again.` : `${done} ${describeSync(result.state)}`;
}
