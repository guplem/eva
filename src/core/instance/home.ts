/**
 * The instance home folder: where one Eva instance keeps its config, secrets, state
 * and logs (docs/plan.md §4.4).
 */
import { join } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

export interface HomeFolderInputs {
  readonly flag?: string | undefined;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly userHome: string;
}

/** `--home`, then `EVA_HOME`, then the platform's config folder. */
export function resolveHomeFolder(inputs: HomeFolderInputs): string {
  if (inputs.flag !== undefined) return inputs.flag;
  const fromEnvironment = inputs.environment["EVA_HOME"];
  if (fromEnvironment !== undefined) return fromEnvironment;
  if (inputs.platform === "win32") {
    return join(inputs.environment["APPDATA"] ?? join(inputs.userHome, "AppData", "Roaming"), "eva");
  }
  return join(inputs.environment["XDG_CONFIG_HOME"] ?? join(inputs.userHome, ".config"), "eva");
}

export interface HomePaths {
  readonly root: string;
  readonly config: string;
  readonly secrets: string;
  readonly lock: string;
  readonly stateFolder: string;
  readonly sessions: string;
  readonly trust: string;
  readonly schedulesState: string;
  readonly telegramState: string;
  readonly logsFolder: string;
  readonly enginesFolder: string;
}

export function homePaths(root: string): HomePaths {
  const stateFolder = join(root, "state");
  return {
    root,
    config: join(root, "config.json"),
    secrets: join(root, "secrets.json"),
    lock: join(root, "eva.lock"),
    stateFolder,
    sessions: join(stateFolder, "sessions.json"),
    trust: join(stateFolder, "trust.json"),
    schedulesState: join(stateFolder, "schedules-state.json"),
    telegramState: join(stateFolder, "telegram.json"),
    logsFolder: join(root, "logs"),
    enginesFolder: join(root, "engines"),
  };
}

const modelAliasSchema = z.enum(["default", "opus", "sonnet", "haiku"]);

const configSchema = z.object({
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
    .object({ frequency: z.enum(["off", "hourly", "daily", "weekly"]).default("daily") })
    .default({ frequency: "daily" }),
  engines: z
    .object({
      default: z.enum(["claude-code", "pi"]).default("claude-code"),
      claudeCode: z
        .object({
          executable: z.string().min(1).nullable().default(null),
          defaultModel: modelAliasSchema.default("default"),
          ownConfigFolder: z.boolean().default(false),
        })
        .default({ executable: null, defaultModel: "default", ownConfigFolder: false }),
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
      claudeCode: { executable: null, defaultModel: "default", ownConfigFolder: false },
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
  google: z
    .object({
      /** The Google account that the Google tools act for. Google stays off until it is set (plan §9). */
      email: z.string().min(1).nullable().default(null),
      services: z
        .array(z.enum(["calendar", "drive", "contacts", "tasks", "gmail"]))
        .default(["calendar", "drive", "contacts", "tasks"]),
      /** Start with read-only scopes (plan §9). */
      readOnly: z.boolean().default(true),
    })
    .default({ email: null, services: ["calendar", "drive", "contacts", "tasks"], readOnly: true }),
  voice: z
    .object({
      /** A whisper.cpp model file. Voice notes stay off until it is set (plan §9). */
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

const secretsSchema = z
  .object({
    telegramBotToken: z.string().min(1),
    claudeOauthToken: z.string().min(1),
    githubToken: z.string().min(1),
    localApiToken: z.string().min(1),
    googleOauthClientId: z.string().min(1),
    googleOauthClientSecret: z.string().min(1),
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
