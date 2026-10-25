/**
 * The destinations of the nav rail and the tab bar, and their addresses. Each destination
 * has an address, so the back button and a reload work.
 */
import type { IconName } from "./icons.tsx";

export const destinations = [
  { id: "chats", label: "Chats", icon: "chat" },
  { id: "projects", label: "Projects", icon: "briefcase" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "schedules", label: "Schedules", icon: "clock" },
  { id: "settings", label: "Settings", icon: "gear" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

/** The visor opens the notification center, so it has an address but no button of its own (#566). */
export const notificationCenter = "notifications";

export type Destination = (typeof destinations)[number]["id"] | typeof notificationCenter;

export function addressOf(destination: Destination): string {
  return `#/${destination}`;
}

/** The chat that the address names, as `#/chat/<id>`: Telegram links to a chat this way. */
export function linkedChatIdOf(hash: string): string | null {
  const match = /^#\/chat\/([^/]+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/**
 * The destination that the address opens. A chat link gives null: the mode of its chat decides.
 * A Settings section, such as `#/settings/remote-access`, opens Settings. Any other address opens Chats.
 */
export function destinationOf(hash: string): Destination | null {
  if (linkedChatIdOf(hash) !== null) return null;
  const name = /^#\/([^/]+)(\/|$)/.exec(hash)?.[1];
  if (name === notificationCenter) return notificationCenter;
  return destinations.find((destination) => destination.id === name)?.id ?? "chats";
}

/**
 * What a tap on Chats does while Chats is open. A phone hides the chat list, so the tap shows it.
 * A computer always shows the list, so the tap opens a new chat.
 */
export function chatsTapAgain(isPhone: boolean): "show-list" | "new-chat" {
  return isPhone ? "show-list" : "new-chat";
}
