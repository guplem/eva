/**
 * The four destinations of the nav rail and the tab bar, and their addresses. Each destination
 * has an address, so the back button and a reload work.
 */
import type { IconName } from "./icons.tsx";

export const destinations = [
  { id: "chats", label: "Chats", icon: "chat" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "schedules", label: "Schedules", icon: "clock" },
  { id: "settings", label: "Settings", icon: "gear" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

export type Destination = (typeof destinations)[number]["id"];

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
  return destinations.find((destination) => destination.id === name)?.id ?? "chats";
}
