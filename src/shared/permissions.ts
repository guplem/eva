/**
 * What Eva lets an engine do, in plain words for Settings. Each engine adapter writes its own
 * words next to the code that enforces them, so the page and the behavior change together.
 * The core adds the engine name to each description.
 */

/** The kinds of chat whose rules differ. A model call has no tools, so it is not one. */
export type PermissionChat = "assistant" | "trusted-project" | "untrusted-project";

export interface ChatPermissions {
  readonly chat: PermissionChat;
  /** Actions that run with no question. */
  readonly runs: readonly string[];
  /** Actions that wait for the person's yes or no. */
  readonly asks: readonly string[];
  /** Actions that never run. */
  readonly blocks: readonly string[];
  /** One more fact about this kind of chat, or null. */
  readonly note: string | null;
}

/** The person's own rules in one engine settings file. */
export interface PersonPermissionRules {
  /** `machine`: this instance's engine folder, for every chat. `vault`: the vault, for Assistant chats. */
  readonly place: "machine" | "vault";
  /** Absolute on the machine. Relative to the vault for a vault file. */
  readonly file: string;
  /** `missing` and `invalid` hold no rules. */
  readonly state: "ok" | "missing" | "invalid";
  readonly allow: readonly string[];
  readonly ask: readonly string[];
  readonly deny: readonly string[];
}

export interface EnginePermissions {
  /** The mode that the running engine uses, or null when the engine has no modes. `value` is the stored setting. */
  readonly mode: { readonly value: string; readonly words: string } | null;
  readonly chats: readonly ChatPermissions[];
  /** Null: the engine has no permission rules of its own, as pi. */
  readonly personRules: readonly PersonPermissionRules[] | null;
}

/** What an engine needs to find the person's own rules. */
export interface PermissionContext {
  readonly vaultFolder: string | null;
  /** The environment of the engine's own runs, such as its config folder. It holds no secret. */
  readonly environment: Readonly<Record<string, string>>;
}
