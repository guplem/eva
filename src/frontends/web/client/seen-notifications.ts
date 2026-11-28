/**
 * Closes the notifications of the chats that the person saw (#1136). An answer that they read on a
 * computer otherwise stays in the notification list of the phone. A closed page cannot close a
 * notification, and a push that shows nothing can cost the permission of the device. So the page
 * closes them when it reads the list of chats: at each change while it runs, and when it opens.
 */
import { hasUnseenTurns, type UnseenFacts } from "./branch-path.ts";

/** The notifications that this device shows. A test passes its own. */
export interface NotificationShelf {
  readonly shown: () => Promise<readonly { readonly tag: string; readonly close: () => void }[]>;
}

/** What the list of chats says about one chat. */
export type SeenChat = UnseenFacts & { readonly id: string; readonly running: boolean };

/** The tag of each notification of a chat, as `chat-notifications.ts` in the core makes it. */
const chatTag = "chat:";

/**
 * `chats` must come from a fresh read: an old list would close the notification of a new answer.
 * A chat that works keeps its notification. Its approval may wait, and it shares the tag. A read
 * from before the end of the turn also says that the chat works, and it does not know the answer.
 */
export async function closeSeenNotifications(chats: readonly SeenChat[], shelf: NotificationShelf): Promise<void> {
  try {
    const byId = new Map(chats.map((chat) => [chat.id, chat]));
    for (const notification of await shelf.shown()) {
      if (!notification.tag.startsWith(chatTag)) continue;
      const chat = byId.get(notification.tag.slice(chatTag.length));
      if (chat === undefined || (!chat.running && !hasUnseenTurns(chat))) notification.close();
    }
  } catch {
    // A notification that stays costs the person one tap.
  }
}
