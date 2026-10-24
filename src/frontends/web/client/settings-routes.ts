/**
 * The map of the Settings pages: each section, its address and the entries that the search finds.
 * Pure, so a test covers the addresses and the search without a browser.
 */
import type { ProgressStep } from "./api.ts";

export type SectionId =
  "setup" | "engines" | "vault" | "connections" | "trust" | "access" | "personalize" | "updates" | "developer";

export interface SettingsSection {
  readonly id: SectionId;
  readonly title: string;
  /** One line under the title on the home page. */
  readonly summary: string;
  /** The setup steps that this section finishes. Their states color the section on the home page. */
  readonly steps: readonly ProgressStep["key"][];
}

export const settingsSections: readonly SettingsSection[] = [
  { id: "setup", title: "Setup", summary: "See what is done, and finish each step.", steps: [] },
  {
    id: "engines",
    title: "AI engines",
    summary: "Claude Code and pi: logins, models and tests.",
    steps: ["engine"],
  },
  {
    id: "vault",
    title: "Vault and sync",
    summary: "Your notes, their repository, the sync and the project folders.",
    steps: ["vault"],
  },
  {
    id: "connections",
    title: "Connections",
    summary: "GitHub, Telegram and Google.",
    steps: ["github", "telegram", "google"],
  },
  {
    id: "trust",
    title: "Trusted repositories",
    summary: "The GitHub accounts and repositories whose hooks may run.",
    steps: [],
  },
  {
    id: "access",
    title: "Access",
    summary: "Phone access with Tailscale, devices and this machine.",
    steps: ["remoteAccess", "device"],
  },
  {
    id: "personalize",
    title: "Personalize",
    summary: "Theme, sounds, Eva's rules, time zone and chat names.",
    steps: [],
  },
  {
    id: "updates",
    title: "Updates",
    summary: "The versions of Eva and her tools, the updates, and a restart.",
    steps: [],
  },
  {
    id: "developer",
    title: "Development",
    summary: "Report a problem, and see the design parts.",
    steps: [],
  },
];

/** The item of the Development section that opens the design reference page instead of a card. */
export const designReferenceItem = "design";

/** The section that holds each setup step's controls. */
export function sectionOfStep(step: ProgressStep["key"]): SectionId {
  return settingsSections.find((section) => section.steps.includes(step))?.id ?? "setup";
}

/**
 * A place in Settings. In the Setup section, `item` is a step key and opens that step's page.
 * In another section, `item` is the id of a card, and the page scrolls to it.
 */
export interface SettingsRoute {
  readonly section: SectionId | null;
  readonly item: string | null;
}

export const settingsHome: SettingsRoute = { section: null, item: null };

const prefix = "#/settings";

export function isSettingsHash(hash: string): boolean {
  return hash === prefix || hash.startsWith(`${prefix}/`);
}

/** An unknown section opens the home page, so an old link never shows an empty page. */
export function parseSettingsHash(hash: string): SettingsRoute {
  if (!isSettingsHash(hash)) return settingsHome;
  const [section, item] = hash.slice(prefix.length + 1).split("/");
  const known = settingsSections.find((each) => each.id === section);
  if (known === undefined) return settingsHome;
  return { section: known.id, item: item === undefined || item === "" ? null : decodeURIComponent(item) };
}

/**
 * True when a move between two addresses keeps the same Settings page open, such as a link
 * to a card on it. Each form on the page then keeps its typed values.
 */
export function sameSettingsPage(from: string, to: string): boolean {
  const first = parseSettingsHash(from);
  const second = parseSettingsHash(to);
  if (!isSettingsHash(from) || !isSettingsHash(to) || first.section === null) return false;
  if (first.section !== second.section) return false;
  // A setup step and the design reference are pages of their own, not cards.
  return first.section === "setup" || first.section === "developer" ? first.item === second.item : true;
}

export function settingsHash(route: SettingsRoute): string {
  if (route.section === null) return prefix;
  return route.item === null
    ? `${prefix}/${route.section}`
    : `${prefix}/${route.section}/${encodeURIComponent(route.item)}`;
}

/** The page one level up: a step or a card goes to its section, and a section goes home. */
export function parentRoute(route: SettingsRoute): SettingsRoute {
  if (route.item !== null) return { section: route.section, item: null };
  return settingsHome;
}

export interface SearchEntry {
  /** The card's id in the page, or the setup step's key. */
  readonly item: string;
  readonly section: SectionId;
  readonly title: string;
  /** Other words that a person may type to find it. */
  readonly words: string;
}

export const searchEntries: readonly SearchEntry[] = [
  { item: "engine", section: "setup", title: "Set up an AI engine", words: "step login token claude pi" },
  { item: "vault", section: "setup", title: "Set up your vault", words: "step notes folder" },
  { item: "remoteAccess", section: "setup", title: "Set up phone access", words: "step tailscale mobile" },
  { item: "device", section: "setup", title: "Allow your devices", words: "step phone code login" },
  { item: "github", section: "setup", title: "Connect GitHub", words: "step login browser token git code" },
  { item: "telegram", section: "setup", title: "Connect Telegram", words: "step bot chat" },
  { item: "google", section: "setup", title: "Connect Google", words: "step calendar drive gmail mail" },
  {
    item: "default-engine",
    section: "engines",
    title: "New chats",
    words:
      "default claude pi model smart balanced fast opus sonnet haiku effort reasoning permissions mode auto bypass",
  },
  {
    item: "permissions",
    section: "engines",
    title: "What Eva may do",
    words: "permissions advanced allow ask deny block rules approval auto bypass safety",
  },
  { item: "claude-code", section: "engines", title: "Claude Code", words: "token login setup-token" },
  { item: "pi", section: "engines", title: "pi", words: "model openai gpt provider login" },
  { item: "vault-folder", section: "vault", title: "Vault folder and repository", words: "notes remote git test" },
  { item: "vault-sync", section: "vault", title: "Vault sync", words: "fetch pull push conflict interval save" },
  { item: "project-folders", section: "vault", title: "Project folders", words: "roots projects extra" },
  {
    item: "template-alignment",
    section: "vault",
    title: "Template alignment",
    words: "skills update template version merge",
  },
  {
    item: "github",
    section: "connections",
    title: "GitHub login",
    words: "git login browser token private repository https code",
  },
  {
    item: "commit-identity",
    section: "connections",
    title: "Commit name and email",
    words: "git author signature user",
  },
  { item: "telegram", section: "connections", title: "Telegram bot", words: "token botfather pairing chat" },
  {
    item: "google",
    section: "connections",
    title: "Google",
    words: "calendar drive contacts tasks gmail mail oauth client",
  },
  {
    item: "own-account",
    section: "trust",
    title: "Your GitHub account",
    words: "trust hooks login own repositories",
  },
  {
    item: "trusted-owners",
    section: "trust",
    title: "Trusted repository owners",
    words: "trust hooks settings mcp github accounts organizations allowlist",
  },
  {
    item: "trust-answers",
    section: "trust",
    title: "Saved trust answers",
    words: "trust hooks ask again allow deny forget repositories",
  },
  { item: "remote-access", section: "access", title: "Phone access", words: "tailscale address qr phone url" },
  { item: "devices", section: "access", title: "Devices", words: "browsers log out this browser remove lost phone" },
  { item: "location", section: "access", title: "Your location", words: "weather place gps telegram live home" },
  {
    item: "notifications",
    section: "access",
    title: "Notifications on this device",
    words: "push alerts notify phone closed telegram answers replies schedules approvals background",
  },
  { item: "machine", section: "access", title: "This machine", words: "hub satellite telegram schedules" },
  { item: "accounts", section: "access", title: "Allowed Tailscale accounts", words: "identities device login" },
  {
    item: "appearance",
    section: "personalize",
    title: "Appearance",
    words:
      "theme dark light density compact colour color seed files view columns folder finder explorer long file names cut ellipsis truncate smart real project title date",
  },
  {
    item: "assistant-rules",
    section: "personalize",
    title: "Eva's rules",
    words: "system prompt personality instructions behaviour behavior assistant.md restore default",
  },
  {
    item: "sounds",
    section: "personalize",
    title: "Sounds and vibration",
    words:
      "sound audio volume mute quiet loud effects chirp style palette coin orbit fluent kalimba halo aurora crystal pulse blocks eve haptic haptics vibrate vibration buzz phone",
  },
  { item: "time-zone", section: "personalize", title: "Time zone", words: "clock schedules" },
  { item: "chat-names", section: "personalize", title: "Chat names", words: "rules title rename" },
  {
    item: "versions",
    section: "updates",
    title: "Versions",
    words:
      "version eva claude code pi git bun tools installed update engine latest voice notes audio microphone ffmpeg whisper",
  },
  {
    item: "eva-updates",
    section: "updates",
    title: "Eva updates",
    words: "version release install automatic changelog notes",
  },
  { item: "restart", section: "updates", title: "Restart Eva", words: "reload stop start" },
  { item: "report-problem", section: "developer", title: "Report a problem", words: "bug issue github idea feedback" },
  {
    item: designReferenceItem,
    section: "developer",
    title: "Design reference",
    words: "colours colors palette components theme architecture",
  },
];

/** Where a setting lives: the vault goes to every machine, and the browser keeps its own. */
export type SettingHome = "vault" | "machine" | "browser";

export interface SettingPlace {
  readonly title: string;
  readonly home: SettingHome;
  /** The dotted config keys. A secret, such as a token, has none: it lives in `secrets.json`. */
  readonly keys: readonly string[];
  /** The card that changes it, or null when no page does yet. */
  readonly link: { readonly section: SectionId; readonly item: string } | null;
}

/** A card with parts in two homes, such as Claude Code's model and token, has a row for each part. */
export const settingPlaces: readonly SettingPlace[] = [
  { title: "Time zone", home: "vault", keys: ["timeZone"], link: { section: "personalize", item: "time-zone" } },
  {
    title: "Vault sync timing",
    home: "vault",
    keys: ["sync.sweepSeconds", "sync.pullIntervalMinutes"],
    link: { section: "vault", item: "vault-sync" },
  },
  { title: "Eva updates", home: "vault", keys: ["updates"], link: { section: "updates", item: "eva-updates" } },
  {
    title: "Engine for new chats",
    home: "vault",
    keys: ["engines.default"],
    link: { section: "engines", item: "default-engine" },
  },
  {
    title: "Model and effort for new chats",
    home: "vault",
    keys: ["engines.defaultModel", "engines.defaultEffort"],
    link: { section: "engines", item: "default-engine" },
  },
  {
    title: "Claude Code permission mode",
    home: "machine",
    keys: ["engines.claudeCode.permissionMode"],
    link: { section: "engines", item: "default-engine" },
  },
  { title: "pi models", home: "vault", keys: ["engines.pi.models"], link: { section: "engines", item: "pi" } },
  { title: "Google account", home: "vault", keys: ["google.email"], link: { section: "connections", item: "google" } },
  { title: "Eva's rules", home: "vault", keys: [], link: { section: "personalize", item: "assistant-rules" } },
  { title: "Chat names", home: "vault", keys: [], link: { section: "personalize", item: "chat-names" } },
  { title: "The hub machine", home: "vault", keys: [], link: { section: "access", item: "machine" } },
  { title: "Voice note language", home: "vault", keys: ["voice.language"], link: null },
  { title: "Claude Code login", home: "machine", keys: [], link: { section: "engines", item: "claude-code" } },
  { title: "pi login", home: "machine", keys: [], link: { section: "engines", item: "pi" } },
  { title: "GitHub login", home: "machine", keys: [], link: { section: "connections", item: "github" } },
  {
    title: "Commit name and email",
    home: "machine",
    keys: ["git.name", "git.email"],
    link: { section: "connections", item: "commit-identity" },
  },
  {
    title: "Telegram bot",
    home: "machine",
    keys: ["telegram.allowedChatId", "telegram.allowedUserId"],
    link: { section: "connections", item: "telegram" },
  },
  {
    title: "Google access",
    home: "machine",
    keys: ["google.access", "google.services"],
    link: { section: "connections", item: "google" },
  },
  { title: "Vault folder", home: "machine", keys: ["vaultPath"], link: { section: "vault", item: "vault-folder" } },
  {
    title: "Project folders",
    home: "machine",
    keys: ["projectRoots"],
    link: { section: "vault", item: "project-folders" },
  },
  {
    title: "Phone access",
    home: "machine",
    keys: ["remoteAccess.hostNames", "remoteAccess.tailscaleServe"],
    link: { section: "access", item: "remote-access" },
  },
  {
    title: "This machine's name",
    home: "machine",
    keys: ["machineName"],
    link: { section: "access", item: "machine" },
  },
  { title: "Devices", home: "machine", keys: [], link: { section: "access", item: "devices" } },
  {
    title: "Allowed Tailscale accounts",
    home: "machine",
    keys: ["remoteAccess.allowedTailscaleIdentities"],
    link: { section: "access", item: "accounts" },
  },
  {
    title: "Trusted repository owners",
    home: "machine",
    keys: ["trust.trustedRepositoryOwners"],
    link: { section: "trust", item: "trusted-owners" },
  },
  { title: "Saved trust answers", home: "machine", keys: [], link: { section: "trust", item: "trust-answers" } },
  { title: "Appearance", home: "browser", keys: [], link: { section: "personalize", item: "appearance" } },
  { title: "Sounds and vibration", home: "browser", keys: [], link: { section: "personalize", item: "sounds" } },
];

/** Every typed word must appear in the entry's title, its words or its section's title. */
export function searchSettings(query: string): SearchEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return [];
  return searchEntries.filter((entry) => {
    const section = settingsSections.find((each) => each.id === entry.section)?.title ?? "";
    const text = `${entry.title} ${entry.words} ${section}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The element id of a card, so a search result and a step link can scroll to it. */
export function cardId(item: string): string {
  return `setting-${item}`;
}
