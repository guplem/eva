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

/**
 * The notification center has an address but no button in the main navigation. The bell of the
 * home page opens it (#761). Telegram and web push link to it.
 */
export const notificationCenter = "notifications";

export type Destination = (typeof destinations)[number]["id"] | typeof notificationCenter;

/** A badge of the main navigation. The visible part is only the number: the hidden words say what it counts. */
export interface NavBadge {
  readonly count: number;
  readonly words: string;
  /** `warn`: something waits for the person. `news`: something new to read. */
  readonly tone: "warn" | "news";
}

/**
 * The badges of the main navigation. A waiting approval wins on Chats, as in the chat list: it
 * stops a turn. Then the unread chats show, on Chats and on Projects (#614).
 */
export function navBadges(input: {
  readonly approvals: number;
  readonly setupMissing: number;
  readonly unreadChats: number;
  readonly unreadProjectChats: number;
}): Partial<Record<Destination, NavBadge>> {
  const unread = (count: number): string => (count === 1 ? "unread chat" : "unread chats");
  const badges: Partial<Record<Destination, NavBadge>> = {};
  if (input.approvals > 0) {
    const waits = input.approvals === 1 ? "approval waits" : "approvals wait";
    const also = input.unreadChats > 0 ? `, ${String(input.unreadChats)} ${unread(input.unreadChats)}` : "";
    badges.chats = { count: input.approvals, words: waits + also, tone: "warn" };
  } else if (input.unreadChats > 0) {
    badges.chats = { count: input.unreadChats, words: unread(input.unreadChats), tone: "news" };
  }
  if (input.unreadProjectChats > 0) {
    badges.projects = { count: input.unreadProjectChats, words: unread(input.unreadProjectChats), tone: "news" };
  }
  if (input.setupMissing > 0) badges.settings = { count: input.setupMissing, words: "to set up", tone: "warn" };
  return badges;
}

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

/** The New chat page of Chats, as `#/chats/new`. A chat id is a UUID, so it is never "new". */
export const newChatPageId = "new";

/** The open chat of Chats, as `#/chats/<id>`. Null for `#/chats`: the newest chat opens. */
export function assistantChatIdOf(hash: string): string | null {
  const match = /^#\/chats\/([^/]+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

export function assistantChatAddressOf(chatId: string | null): string {
  return chatId === null ? addressOf("chats") : `${addressOf("chats")}/${encodeURIComponent(chatId)}`;
}

/** The home page that the visor opens: the New chat page, with Eva and her widgets (#761). */
export const homeAddress = assistantChatAddressOf(newChatPageId);

/**
 * The button of the main navigation that shows as the current page. The home page belongs to the
 * visor, not to Chats. The notification center has no button.
 */
export function currentNavButton(
  current: Destination,
  homeShown: boolean,
): Exclude<Destination, typeof notificationCenter> | "visor" | null {
  if (current === notificationCenter) return null;
  return current === "chats" && homeShown ? "visor" : current;
}

/** A page of Projects. Each page has an address, so Back goes from a chat to its project, then to the list. */
export type ProjectRoute =
  | { readonly kind: "list" }
  /** The statistics of the projects, on their own page, so a phone shows them too (#878). */
  | { readonly kind: "stats" }
  | { readonly kind: "project" | "details" | "setup"; readonly projectId: string }
  | { readonly kind: "chat"; readonly projectId: string; readonly chatId: string };

/** Any address that names no page of Projects opens the list. */
export function projectRouteOf(hash: string): ProjectRoute {
  // A project id starts with its year, so no project has the id "stats".
  if (hash === `${addressOf("projects")}/stats`) return { kind: "stats" };
  const match = /^#\/projects\/([^/]+)(?:\/(details|setup|chat\/([^/]+)))?$/.exec(hash);
  const projectId = match?.[1];
  if (match === null || projectId === undefined) return { kind: "list" };
  const id = decodeURIComponent(projectId);
  if (match[3] !== undefined) return { kind: "chat", projectId: id, chatId: decodeURIComponent(match[3]) };
  if (match[2] === "details" || match[2] === "setup") return { kind: match[2], projectId: id };
  return { kind: "project", projectId: id };
}

export function projectAddressOf(route: ProjectRoute): string {
  if (route.kind === "list") return addressOf("projects");
  if (route.kind === "stats") return `${addressOf("projects")}/stats`;
  const project = `${addressOf("projects")}/${encodeURIComponent(route.projectId)}`;
  if (route.kind === "project") return project;
  if (route.kind === "chat") return `${project}/chat/${encodeURIComponent(route.chatId)}`;
  return `${project}/${route.kind}`;
}

/**
 * The open schedule of Schedules, as `#/schedules/<id>`, and its edit page, as `#/schedules/<id>/edit`.
 * A null id, as for `#/schedules`, shows the list and today.
 */
export interface ScheduleRoute {
  readonly scheduleId: string | null;
  readonly edit: boolean;
}

export function scheduleRouteOf(hash: string): ScheduleRoute {
  const match = /^#\/schedules\/([^/]+)(\/edit)?$/.exec(hash);
  if (match?.[1] === undefined) return { scheduleId: null, edit: false };
  return { scheduleId: decodeURIComponent(match[1]), edit: match[2] !== undefined };
}

export function scheduleAddressOf(scheduleId: string | null, edit = false): string {
  if (scheduleId === null) return addressOf("schedules");
  return `${addressOf("schedules")}/${encodeURIComponent(scheduleId)}${edit ? "/edit" : ""}`;
}
