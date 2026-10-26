/**
 * The details that a tap on a notification shows (#599). The words of an alert say what happened,
 * but use Eva's own terms. These words say what that kind of notification means, for a person who
 * never read Eva's code. Each topic is picked from the key, never from the text.
 */
import type { HistoryEntry } from "../../../core/alerts/notification-history.ts";

export interface NotificationTopic {
  readonly title: string;
  readonly meaning: string;
}

const scheduleWords =
  "A schedule is a task that Eva runs by herself at set times, from .eva/schedules.json in your vault.";

/** By the part of the key before the first colon: the part after it names one schedule, engine or store. */
const topics: Readonly<Record<string, NotificationTopic>> = {
  vault_sync: {
    title: "Vault sync",
    meaning:
      "Your vault is the folder of your notes. Eva copies it to and from its git remote, such as GitHub: she sends your changes there and brings in the changes from your other devices. This entry says that the sync stopped, or that it works again.",
  },
  update: {
    title: "Eva updates",
    meaning: "Eva checks for new versions of herself and installs them. This entry is about such a check or install.",
  },
  update_held_back: {
    title: "New Eva version",
    meaning:
      "A new version of Eva is out. Your update policy tells Eva not to install it by herself, so you choose when. To see what it brings, open Settings, Updates.",
  },
  engine_update: {
    title: "Claude Code update",
    meaning:
      "Claude Code is the AI program that runs your chats. Eva keeps it up to date. This entry is about such an update.",
  },
  engine_login: {
    title: "AI engine login",
    meaning:
      "Each chat runs on an AI engine, such as Claude Code, with your own login. When the login expires, the engine refuses each chat until you log in again in Settings, AI engines.",
  },
  default_engine: {
    title: "AI engine program",
    meaning: "Chats need the program of your default AI engine on this computer. This entry says whether Eva finds it.",
  },
  default_engine_restart: {
    title: "Restart needed",
    meaning: "Eva found a newly installed AI engine program. Chats use it only after Eva restarts.",
  },
  schedule: {
    title: "Schedule run",
    meaning: `${scheduleWords} This entry says that a run failed, or that the runs work again.`,
  },
  schedule_card: {
    title: "Schedule check",
    meaning: [
      scheduleWords,
      "When a schedule is new, turned on or changed, Eva first shows you a setup card with all its fields.",
      "In the web app, you confirm the card. In Telegram, the card counts when it reaches you.",
      "Anyone who can change your vault could add a schedule, so this check makes sure that you see each schedule before it runs.",
      "Until the card reaches you, the schedule does not run.",
      "After that, Eva says that the schedule no longer waits.",
    ].join(" "),
  },
  template_alignment: {
    title: "Vault template",
    meaning:
      "Eva gives each vault some standard files, such as skills. When Eva has a new version of a file that you changed, she asks which version to keep.",
  },
  vault_ahead: {
    title: "Vault from a newer Eva",
    meaning:
      "A newer Eva changed the format of your vault, or Eva cannot read the vault's record of these changes, .eva/migrations.json. Until you update Eva or repair the file, Eva does not change the vault's settings, schedules or hub. Chats and the vault sync go on.",
  },
  machine_ahead: {
    title: "Files from a newer Eva",
    meaning: "A newer Eva upgraded the files of this computer, so this older Eva leaves them as they are.",
  },
  migration_failed: {
    title: "File upgrade failed",
    meaning:
      "After an update, Eva upgrades the format of her files. One upgrade failed. Eva keeps the files as they were, and tries again at the next start.",
  },
  unclean_exit: {
    title: "Unexpected stop",
    meaning:
      "Eva stopped with no normal shutdown, for example after a crash, a kill or a power loss, and then started again. The log shows what happened before.",
  },
  telegram_poll: {
    title: "Telegram connection",
    meaning:
      "Eva reads your Telegram messages through your Telegram bot. This entry says that Eva could not reach Telegram, or that she can again.",
  },
};

const otherTopic: NotificationTopic = {
  title: "Notification",
  meaning: "Eva wrote this about her own work. The message says what happened.",
};

export function notificationTopic(key: string): NotificationTopic {
  // A relayed key is `machine:<machine>:<key>`: the other computer's own key follows its name.
  const relayed = /^machine:([^:]+):(.+)$/.exec(key);
  if (relayed !== null) {
    const [, machine = "", inner = ""] = relayed;
    const topic = notificationTopic(inner);
    if (topic === otherTopic) return otherTopic;
    return {
      title: `On ${machine}: ${topic.title}`,
      meaning: `Another computer, ${machine}, reports this. Fix it in Eva on ${machine}. ${topic.meaning}`,
    };
  }
  return topics[kindOf(key)] ?? otherTopic;
}

function kindOf(key: string): string {
  return key.split(":")[0] ?? "";
}

/** Keys that Eva sends once and never keeps open, so no later entry says that they ended. */
const oneOffKinds = new Set(["unclean_exit", "migration_failed", "machine_ahead"]);

/** Every entry of the same problem, newest first by `seq` (lesson 83). */
export function sameProblemEntries(entries: readonly HistoryEntry[], key: string): HistoryEntry[] {
  return entries.filter((entry) => entry.key === key).sort((first, second) => second.seq - first.seq);
}

/**
 * Whether the problem of an entry is still open. Null for news, which is no problem, and for a
 * one-off problem: it is never open, but that does not make it solved.
 */
export function entryState(entry: HistoryEntry, openKeys: ReadonlySet<string>): "open" | "solved" | null {
  if (entry.level === "news" || oneOffKinds.has(kindOf(entry.key))) return null;
  return openKeys.has(entry.key) ? "open" : "solved";
}
