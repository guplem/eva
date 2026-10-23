/**
 * The instance home folder: where one Eva instance keeps its config, secrets, state
 * and logs. Each instance has a name, and its home is `eva-<name>` in the platform's config folder.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { googleAccessLevels } from "../google/google-access.ts";

/** The variable that names the instance of an `eva` command, as `--instance` does. */
export const instanceVariable = "EVA_INSTANCE";
/** The name that setup offers for the first instance on a computer. */
export const firstInstanceName = "eva";
const homePrefix = "eva-";
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nameMaxLength = 32;

export interface InstancesFolderInputs {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly userHome: string;
}

/** The folder that holds the home of each instance: the platform's config folder. */
export function instancesFolder(inputs: InstancesFolderInputs): string {
  if (inputs.platform === "win32") return inputs.environment["APPDATA"] ?? join(inputs.userHome, "AppData", "Roaming");
  return inputs.environment["XDG_CONFIG_HOME"] ?? join(inputs.userHome, ".config");
}

/** What is wrong with an instance name, or null for a good one. The name is part of a folder and a service name. */
export function instanceNameProblem(name: string): string | null {
  if (name.length <= nameMaxLength && namePattern.test(name)) return null;
  return `"${name}" is not a name for an Eva. Use up to ${String(nameMaxLength)} lower-case letters, digits and dashes, such as eva or ana.`;
}

/**
 * The name that setup offers for a new Eva: the computer user's name, made valid, so that two
 * people's Evas on one computer differ by default. A name already taken gets `-1`, `-2` and on.
 */
export function suggestedInstanceName(userName: string, taken: readonly string[]): string {
  const cleaned = userName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A number suffix needs room: the base keeps space for "-99".
  const base = cleaned.slice(0, nameMaxLength - 3).replace(/-+$/, "");
  const name = base === "" || instanceNameProblem(base) !== null ? firstInstanceName : base;
  if (!taken.includes(name)) return name;
  for (let number = 1; ; number += 1) {
    const candidate = `${name}-${String(number)}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function instanceHome(folder: string, name: string): string {
  return join(folder, `${homePrefix}${name}`);
}

/** The name of the instance in this home: the folder name without `eva-`. */
export function instanceNameOf(paths: HomePaths): string {
  const folder = basename(resolve(paths.root));
  return folder.startsWith(homePrefix) ? folder.slice(homePrefix.length) : folder;
}

/** The names of the instances in the folder, sorted. Setup writes `config.json`, so a home without it is no instance. */
export function listInstances(folder: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.startsWith(homePrefix))
    .map((entry) => entry.slice(homePrefix.length))
    .filter((name) => instanceNameProblem(name) === null && existsSync(homePaths(instanceHome(folder, name)).config))
    .sort();
}

export interface HomePaths {
  readonly root: string;
  readonly config: string;
  readonly secrets: string;
  /** The ids of the machine migrations that ran. */
  readonly migrationRecord: string;
  readonly lock: string;
  readonly stateFolder: string;
  readonly sessions: string;
  /** The whole input and output of the tool steps, one file per chat. */
  readonly stepDetails: string;
  readonly trust: string;
  readonly cloneOrigins: string;
  readonly schedulesState: string;
  readonly telegramState: string;
  /** The newest held-back release that Eva already announced. */
  readonly updatesState: string;
  /** The code that pairs the first Telegram chat; present only while no chat is paired. */
  readonly telegramPairingCode: string;
  /** Present while Eva runs; a start that finds it knows the last run ended uncleanly. */
  readonly runningMarker: string;
  readonly devices: string;
  /** The person's last known location, from their phone. Never in the vault. */
  readonly location: string;
  /** The devices that get Eva's alerts as web push notifications. */
  readonly pushSubscriptions: string;
  /** The GitHub account of the saved token, which gives the commit name and email. */
  readonly githubAccount: string;
  readonly logsFolder: string;
  readonly enginesFolder: string;
}

export function homePaths(root: string): HomePaths {
  const stateFolder = join(root, "state");
  return {
    root,
    config: join(root, "config.json"),
    secrets: join(root, "secrets.json"),
    migrationRecord: join(root, "migrations.json"),
    lock: join(root, "eva.lock"),
    stateFolder,
    sessions: join(stateFolder, "sessions.json"),
    stepDetails: join(stateFolder, "step-details"),
    trust: join(stateFolder, "trust.json"),
    cloneOrigins: join(stateFolder, "clone-origins.json"),
    schedulesState: join(stateFolder, "schedules-state.json"),
    telegramState: join(stateFolder, "telegram.json"),
    updatesState: join(stateFolder, "updates.json"),
    telegramPairingCode: join(stateFolder, "telegram-pairing-code.txt"),
    runningMarker: join(stateFolder, "running"),
    devices: join(stateFolder, "devices.json"),
    location: join(stateFolder, "location.json"),
    pushSubscriptions: join(stateFolder, "push-subscriptions.json"),
    githubAccount: join(stateFolder, "github-account.json"),
    logsFolder: join(root, "logs"),
    enginesFolder: join(root, "engines"),
  };
}

/** The engine login folders of an instance home. Each instance has its own, so one Eva never uses another's login (lesson 111). */
export interface EngineFolders {
  readonly claude: string;
  readonly piAgent: string;
  readonly gh: string;
  readonly git: string;
}

export function engineFolders(paths: HomePaths): EngineFolders {
  return {
    claude: join(paths.enginesFolder, "claude"),
    // Not `engines/pi`: pi reads `<agent folder>/prompts/` as templates, and Eva writes her prompts there.
    piAgent: join(paths.enginesFolder, "pi-agent"),
    gh: join(paths.enginesFolder, "gh"),
    git: join(paths.enginesFolder, "git"),
  };
}

/**
 * The global git config of an instance's agents. With `GIT_CONFIG_GLOBAL`, git reads only
 * this file, so it includes the person's own global config first. Then it resets the GitHub
 * helpers: without this, a push asks the OS user's helper and goes out as the first person.
 * Other hosts keep the person's helpers. The instance's commit identity comes after the include,
 * so it wins over the person's global name and email.
 */
export function engineGitConfig(
  environment: Readonly<Record<string, string | undefined>>,
  file: string,
  identity: CommitIdentity = { name: null, email: null },
): string {
  // Git expands `~/` in an include path itself, on Windows too.
  // An Eva started from this instance's own agent gets this file; including it again would loop.
  const fromEnvironment = environment["GIT_CONFIG_GLOBAL"];
  const ownGlobal =
    fromEnvironment === undefined || resolve(fromEnvironment) === resolve(file) ? undefined : fromEnvironment;
  const xdgConfig = environment["XDG_CONFIG_HOME"];
  const includes =
    ownGlobal !== undefined
      ? [ownGlobal]
      : [xdgConfig === undefined ? "~/.config/git/config" : join(xdgConfig, "git", "config"), "~/.gitconfig"];
  const quote = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return [
    "# Written by Eva at each start. Edits here get lost.",
    "[include]",
    ...includes.map((path) => `\tpath = ${quote(path)}`),
    '[credential "https://github.com"]',
    "\thelper =",
    "\thelper = !gh auth git-credential",
    ...(identity.name === null && identity.email === null ? [] : ["[user]"]),
    ...(identity.name === null ? [] : [`\tname = ${quote(identity.name)}`]),
    ...(identity.email === null ? [] : [`\temail = ${quote(identity.email)}`]),
    "",
  ].join("\n");
}

/** The name and email of an instance's commits. A null part leaves that part to git's own settings. */
export interface CommitIdentity {
  readonly name: string | null;
  readonly email: string | null;
}

/** The variables that point each engine at its folder. */
export function engineFolderVariables(folders: EngineFolders): Record<string, string> {
  return { CLAUDE_CONFIG_DIR: folders.claude, PI_CODING_AGENT_DIR: folders.piAgent, GH_CONFIG_DIR: folders.gh };
}

/** Creates the home and state folders, readable by the OS user only. Windows ignores the mode. */
export function createHomeFolders(paths: HomePaths): void {
  for (const folder of [paths.root, paths.stateFolder]) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    // mkdirSync leaves the mode of a folder that exists as it is: an older install made it with the default mode.
    chmodSync(folder, 0o700);
  }
}

const modelAliasSchema = z.enum(["default", "opus", "sonnet", "haiku"]);

export const configSchema = z.object({
  version: z.literal(1).default(1),
  vaultPath: z.string().min(1).nullable().default(null),
  /** This machine's name in `.eva/hub.json`. Null: the computer's host name. */
  machineName: z.string().min(1).nullable().default(null),
  port: z.number().int().min(1024).max(65535).default(7420),
  timeZone: z.string().min(1).nullable().default(null),
  projectRoots: z.array(z.string().min(1)).default([]),
  sync: z
    .object({
      enabled: z.boolean().default(true),
      sweepSeconds: z.number().int().min(10).default(60),
      /** Minutes between two fetches of the vault's remote. Null: only before each Assistant turn. */
      pullIntervalMinutes: z.number().int().min(1).nullable().default(5),
    })
    .default({ enabled: true, sweepSeconds: 60, pullIntervalMinutes: 5 }),
  updates: z
    .object({
      frequency: z.enum(["off", "hourly", "daily", "weekly"]).default("daily"),
      /** The largest step that Eva installs by herself: a fix, a feature, or a breaking change. */
      install: z.enum(["patch", "minor", "major"]).default("minor"),
    })
    .default({ frequency: "daily", install: "minor" }),
  engines: z
    .object({
      default: z.enum(["claude-code", "pi"]).default("claude-code"),
      claudeCode: z
        .object({
          executable: z.string().min(1).nullable().default(null),
          defaultModel: modelAliasSchema.default("default"),
          /** How Claude Code asks before a tool runs. `bypassPermissions` also skips Eva's own approvals. */
          permissionMode: z.enum(["auto", "bypassPermissions"]).default("auto"),
        })
        .default({ executable: null, defaultModel: "default", permissionMode: "auto" }),
      pi: z
        .object({
          /** The program that starts pi. Null: `pi` found on PATH. */
          executable: z.string().min(1).nullable().default(null),
          /**
           * The pi model for each of Eva's model names, such as `openai/gpt-5` for `opus`. A chat
           * keeps its model name (lesson 121); null: the `default` entry, then pi's own default.
           */
          models: z
            .object({
              default: z.string().min(1).nullable().default(null),
              opus: z.string().min(1).nullable().default(null),
              sonnet: z.string().min(1).nullable().default(null),
              haiku: z.string().min(1).nullable().default(null),
            })
            .default({ default: null, opus: null, sonnet: null, haiku: null }),
        })
        .default({ executable: null, models: { default: null, opus: null, sonnet: null, haiku: null } }),
    })
    .default({
      default: "claude-code",
      claudeCode: { executable: null, defaultModel: "default", permissionMode: "auto" },
      pi: { executable: null, models: { default: null, opus: null, sonnet: null, haiku: null } },
    }),
  telegram: z
    .object({
      allowedChatId: z.number().int().nullable().default(null),
      /** The person who paired the chat; in a group, only this person may act. */
      allowedUserId: z.number().int().nullable().default(null),
    })
    .default({ allowedChatId: null, allowedUserId: null }),
  trust: z
    .object({ trustedRepositoryOwners: z.array(z.string().min(1)).default([]) })
    .default({ trustedRepositoryOwners: [] }),
  /** The name and email of this Eva's commits. Null: the GitHub account's, then the computer user's git settings. */
  git: z
    .object({
      name: z.string().min(1).nullable().default(null),
      email: z.string().min(1).nullable().default(null),
    })
    .default({ name: null, email: null }),
  google: z
    .object({
      /** The Google account that the Google tools act for. Google stays off until it is set. */
      email: z.string().min(1).nullable().default(null),
      services: z
        .array(z.enum(["calendar", "drive", "contacts", "tasks", "gmail"]))
        .default(["calendar", "drive", "contacts", "tasks"]),
      /** The access level of each service. Every service starts read-only. */
      access: z
        .object({
          calendar: z.enum(googleAccessLevels.calendar).default("readonly"),
          drive: z.enum(googleAccessLevels.drive).default("readonly"),
          contacts: z.enum(googleAccessLevels.contacts).default("readonly"),
          tasks: z.enum(googleAccessLevels.tasks).default("readonly"),
          gmail: z.enum(googleAccessLevels.gmail).default("readonly"),
        })
        .default({
          calendar: "readonly",
          drive: "readonly",
          contacts: "readonly",
          tasks: "readonly",
          gmail: "readonly",
        }),
      /** The old single switch. Only the 2026-10-20 migration reads it. A save before that migration keeps it. */
      readOnly: z.boolean().optional(),
    })
    .default({
      email: null,
      services: ["calendar", "drive", "contacts", "tasks"],
      access: { calendar: "readonly", drive: "readonly", contacts: "readonly", tasks: "readonly", gmail: "readonly" },
    }),
  voice: z
    .object({
      /** A whisper.cpp model file. Voice notes stay off until it is set. */
      modelPath: z.string().min(1).nullable().default(null),
      vadModelPath: z.string().min(1).nullable().default(null),
      whisperExecutable: z.string().min(1).default("whisper-cli"),
      ffmpegExecutable: z.string().min(1).default("ffmpeg"),
      language: z.string().min(1).nullable().default(null),
    })
    .default({
      modelPath: null,
      vadModelPath: null,
      whisperExecutable: "whisper-cli",
      ffmpegExecutable: "ffmpeg",
      language: null,
    }),
  remoteAccess: z
    .object({
      /** Host names that reach this instance through `tailscale serve`, such as eva.example-tailnet.ts.net. */
      hostNames: z.array(z.string().min(1)).default([]),
      /** Empty: only the Tailscale account that owns this machine. */
      allowedTailscaleIdentities: z.array(z.string().min(1)).default([]),
      /** Publish the web UI in the tailnet with `tailscale serve` at start, when Tailscale runs. */
      tailscaleServe: z.boolean().default(true),
    })
    .default({ hostNames: [], allowedTailscaleIdentities: [], tailscaleServe: true }),
});

export type EvaConfig = z.infer<typeof configSchema>;

export const defaultConfig: EvaConfig = configSchema.parse({});

/** Checks a whole config. Throws an EvaError that names each bad field. */
export function parseConfig(value: unknown, source: string): EvaConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new EvaError("config_invalid", describeIssues(source, parsed.error));
  return parsed.data;
}

/** Loads `config.json`. A missing file means the defaults; an invalid file is an EvaError. */
export function loadConfig(paths: HomePaths): EvaConfig {
  const read = readJsonTolerant(paths.config);
  if (!read.ok && read.reason === "missing") return defaultConfig;
  if (!read.ok) throw new EvaError("config_invalid", `${paths.config} is not valid JSON.`);
  const parsed = configSchema.safeParse(read.value);
  if (!parsed.success) throw new EvaError("config_invalid", describeIssues(paths.config, parsed.error));
  return parsed.data;
}

export function saveConfig(paths: HomePaths, config: EvaConfig): void {
  writeFileAtomic(paths.config, JSON.stringify(config, null, 2) + "\n");
}

export const secretsSchema = z
  .object({
    telegramBotToken: z.string().min(1),
    claudeOauthToken: z.string().min(1),
    githubToken: z.string().min(1),
    localApiToken: z.string().min(1),
    googleOauthClientId: z.string().min(1),
    googleOauthClientSecret: z.string().min(1),
    /** The private key that signs web push requests (VAPID), as base64 PKCS #8. Eva makes it. */
    webPushPrivateKey: z.string().min(1),
  })
  .partial();

export type EvaSecrets = z.infer<typeof secretsSchema>;

/** Loads `secrets.json`. A missing file means no secrets. */
export function loadSecrets(paths: HomePaths): EvaSecrets {
  const read = readJsonTolerant(paths.secrets);
  if (!read.ok && read.reason === "missing") return {};
  if (!read.ok) throw new EvaError("config_invalid", `${paths.secrets} is not valid JSON.`);
  const parsed = secretsSchema.safeParse(read.value);
  if (!parsed.success) throw new EvaError("config_invalid", describeIssues(paths.secrets, parsed.error));
  return parsed.data;
}

/** Writes `secrets.json`, readable by the OS user only. */
export function saveSecrets(paths: HomePaths, secrets: EvaSecrets): void {
  writeFileAtomic(paths.secrets, JSON.stringify(secrets, null, 2) + "\n");
}

function describeIssues(file: string, error: z.ZodError): string {
  const details = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  return `${file} is invalid: ${details}`;
}
