/**
 * The instance home folder: where one Eva instance keeps its config, secrets, state
 * and logs (docs/plan.md §4.4).
 */
import { join } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

export interface HomeFolderInputs {
  readonly flag?: string;
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
  role: z.enum(["hub", "satellite"]).default("hub"),
  port: z.number().int().min(1024).max(65535).default(7420),
  timeZone: z.string().min(1).nullable().default(null),
  projectRoots: z.array(z.string().min(1)).default([]),
  sync: z
    .object({
      enabled: z.boolean().default(true),
      sweepSeconds: z.number().int().min(10).default(60),
    })
    .default({ enabled: true, sweepSeconds: 60 }),
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
    })
    .default({
      default: "claude-code",
      claudeCode: { executable: null, defaultModel: "default", ownConfigFolder: false },
    }),
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      allowedChatId: z.number().int().nullable().default(null),
    })
    .default({ enabled: false, allowedChatId: null }),
  trust: z
    .object({ trustedRepositoryOwners: z.array(z.string().min(1)).default([]) })
    .default({ trustedRepositoryOwners: [] }),
  remoteAccess: z
    .object({ allowedTailscaleIdentities: z.array(z.string().min(1)).default([]) })
    .default({ allowedTailscaleIdentities: [] }),
});

export type EvaConfig = z.infer<typeof configSchema>;
export type ModelAlias = z.infer<typeof modelAliasSchema>;

export const defaultConfig: EvaConfig = configSchema.parse({});

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
