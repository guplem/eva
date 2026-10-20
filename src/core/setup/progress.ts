/**
 * The setup progress list: each step done, missing or optional, with what to do. It reads what
 * Eva already knows (the checks behind the Test buttons, the saved secrets, the Tailscale state)
 * and keeps no list of its own. Pure, so the web page, `eva setup` and `eva status` share it.
 */
import type { CheckName } from "../checks.ts";
import type { EngineName } from "../../shared/engine-port.ts";
import type { RemoteAccess } from "../remote-access/remote-access.ts";
import { remoteAccessStep, setupSteps } from "../remote-access/steps.ts";

/** The last result of a Test, since Eva started. */
export interface CheckRecord {
  readonly ok: boolean;
  readonly detail: string;
  readonly at: string;
}

export interface ProgressInput {
  /** Each engine: whether its program was there at Eva's start, and whether it has a login. */
  readonly engines: readonly { readonly name: EngineName; readonly found: boolean; readonly loggedIn: boolean }[];
  readonly defaultEngine: EngineName;
  readonly vaultPath: string | null;
  readonly githubToken: boolean;
  /** Null when phone access is off on this machine. */
  readonly remoteAccess: RemoteAccess | null;
  /** How many browsers may open Eva with a device login. */
  readonly devices: number;
  readonly telegram: { readonly token: boolean; readonly paired: boolean };
  readonly google: boolean;
  readonly checks: Readonly<Partial<Record<CheckName, CheckRecord>>>;
}

export type ProgressKey = "engine" | "vault" | "remoteAccess" | "device" | "github" | "telegram" | "google";

export interface ProgressStep {
  readonly key: ProgressKey;
  readonly title: string;
  /** "optional": Eva works without it. */
  readonly state: "done" | "missing" | "optional";
  /** What is done, or what to do. */
  readonly detail: string;
  /** The check behind this step's Test button, or null. */
  readonly check: CheckName | null;
  readonly lastCheck: CheckRecord | null;
}

export function setupProgress(input: ProgressInput): ProgressStep[] {
  const make = (
    key: ProgressKey,
    title: string,
    state: ProgressStep["state"],
    detail: string,
    check: CheckName | null = null,
  ): ProgressStep => ({
    key,
    title,
    state,
    detail,
    check,
    lastCheck: check === null ? null : (input.checks[check] ?? null),
  });
  return [
    engineStep(input, make),
    // Before the vault: the GitHub login lists the repositories that the vault step picks from.
    input.githubToken
      ? make("github", "GitHub", "done", "The token is saved.", "github")
      : make(
          "github",
          "GitHub",
          "optional",
          "A vault on this computer alone, or a public one, needs no GitHub login.",
          "github",
        ),
    input.vaultPath === null
      ? make(
          "vault",
          "Your vault",
          "missing",
          "Your vault is the notebook of your notes. Pick it from your GitHub repositories in the vault step of Eva's page, or start a new one there.",
          "vault",
        )
      : make("vault", "Your vault", "done", `The vault is in ${input.vaultPath}.`, "vault"),
    remoteAccessProgress(input.remoteAccess, make),
    input.devices > 0
      ? make(
          "device",
          "Your devices",
          "done",
          `${input.devices === 1 ? "1 device" : `${String(input.devices)} devices`} can open Eva.`,
        )
      : make(
          "device",
          "Your devices",
          // With phone access off, the page on this computer may be the only one the person needs.
          input.remoteAccess === null ? "optional" : "missing",
          "Open Eva's page on your phone. It shows a short code: run `eva devices allow <code>` on Eva's computer.",
        ),
    telegramStep(input.telegram, make),
    input.google
      ? make("google", "Google", "done", "A Google account is set.", "google")
      : make("google", "Google", "optional", "Calendar, Drive, Contacts and Tasks.", "google"),
  ];
}

/** How many steps still need the person. */
export function missingSteps(steps: readonly ProgressStep[]): number {
  return steps.filter((step) => step.state === "missing").length;
}

/**
 * Why no chat can answer: a missing engine or vault, or a login that waits for a restart.
 * A chat on this machine alone needs no phone access.
 */
export type ChatBlocker = "engine" | "vault" | "restart";

/** The first missing step that stops every chat, or null. */
export function chatBlocker(steps: readonly ProgressStep[]): Exclude<ChatBlocker, "restart"> | null {
  for (const step of steps)
    if ((step.key === "engine" || step.key === "vault") && step.state === "missing") return step.key;
  return null;
}

type Make = (
  key: ProgressKey,
  title: string,
  state: ProgressStep["state"],
  detail: string,
  check?: CheckName | null,
) => ProgressStep;

function engineStep(input: ProgressInput, make: Make): ProgressStep {
  // The default engine first, so its check is the one that the Test runs.
  const ordered = [...input.engines].sort(
    (a, b) => Number(b.name === input.defaultEngine) - Number(a.name === input.defaultEngine),
  );
  const ready = ordered.find((engine) => engine.found && engine.loggedIn);
  if (ready !== undefined) return make("engine", "An AI engine", "done", `${ready.name} has a login.`, ready.name);
  if (!input.engines.some((engine) => engine.found))
    return make(
      "engine",
      "An AI engine",
      "missing",
      "Run `eva setup` on Eva's computer: it installs Claude Code and pi.",
      input.defaultEngine,
    );
  return make(
    "engine",
    "An AI engine",
    "missing",
    "For a Claude subscription, open Settings, AI engines, on Eva's page, and press Start the login under Claude Code. Or run `claude setup-token` on any computer with a browser, and paste the token in Settings. For another provider, run `pi` on Eva's computer and type /login.",
    input.defaultEngine,
  );
}

function remoteAccessProgress(access: RemoteAccess | null, make: Make): ProgressStep {
  const title = "Phone access (Tailscale)";
  if (access === null) return make("remoteAccess", title, "optional", "Phone access is off on this machine.");
  if (remoteAccessStep(access) === "ready")
    return make("remoteAccess", title, "done", `Eva opens at ${access.url ?? "her address"}.`);
  return make(
    "remoteAccess",
    title,
    "missing",
    setupSteps(access)
      .map((step) => step.text)
      .join(" "),
  );
}

function telegramStep(telegram: ProgressInput["telegram"], make: Make): ProgressStep {
  if (telegram.token && telegram.paired)
    return make("telegram", "Telegram", "done", "The bot talks to your chat.", "telegram");
  if (telegram.token)
    return make(
      "telegram",
      "Telegram",
      "optional",
      "Send the pairing code to your bot, so that it talks only to you.",
      "telegram",
    );
  return make("telegram", "Telegram", "optional", "A bot of your own lets you talk to Eva in Telegram.", "telegram");
}
