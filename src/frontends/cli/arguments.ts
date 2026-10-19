/** Reads the `eva` command line. */
import type { EngineName, ModelAlias } from "../../shared/engine-port.ts";

export type CliCommand =
  | { readonly command: "run"; readonly instance: string | undefined }
  | { readonly command: "setup"; readonly instance: string | undefined; readonly nonInteractive: boolean }
  | { readonly command: "doctor"; readonly instance: string | undefined }
  | { readonly command: "status"; readonly instance: string | undefined }
  | { readonly command: "help"; readonly instance: string | undefined }
  | { readonly command: "version"; readonly instance: string | undefined }
  | {
      readonly command: "update";
      readonly instance: string | undefined;
      readonly checkOnly: boolean;
      /** A newer version to install past the update policy, or null. */
      readonly version: string | null;
    }
  | { readonly command: "sync"; readonly instance: string | undefined }
  | { readonly command: "hub"; readonly instance: string | undefined }
  | { readonly command: "link"; readonly instance: string | undefined }
  | {
      readonly command: "settings";
      readonly instance: string | undefined;
      readonly action: "list" | "get" | "set";
      readonly key?: string;
      readonly value?: string;
    }
  | { readonly command: "devices-allow"; readonly instance: string | undefined; readonly code: string }
  | { readonly command: "service-install"; readonly instance: string | undefined }
  | { readonly command: "supervise"; readonly instance: string | undefined }
  | { readonly command: "projects"; readonly instance: string | undefined; readonly query: string }
  | {
      readonly command: "work";
      readonly instance: string | undefined;
      readonly projectId: string;
      readonly request: string;
    }
  | {
      readonly command: "chat";
      readonly instance: string | undefined;
      readonly projectId?: string;
      readonly clone?: string;
      readonly model?: ModelAlias;
      readonly engine?: EngineName;
    }
  | { readonly command: "usage-error"; readonly message: string };

export const usageText = `Usage: eva [--instance <name>] [command]

Each Eva on this computer has a name. Without --instance or EVA_INSTANCE, eva asks which one, or uses the only one.

Commands:
  (none)            Run Eva in the foreground
  setup             Ask for each setting and write the config
      --non-interactive                  read the answers from EVA_* variables instead
  doctor            Check the tools that Eva uses
  status            Show the engines, the vault sync and the sessions
  chat              Talk to Eva in this terminal
      --project <id> [--clone <name>]   a Project chat instead of an Assistant chat
      --model <default|opus|sonnet|haiku>
      --engine <claude-code|pi>
  projects [words]  Search the projects
      status:<idea|active|paused|closed|any>  only projects with this status
      tag:<tag>                               only projects with this tag ("#<tag>" needs the quotes)
  work <project> <request>  Give work to a project: a Project chat in a free clone runs it
  service install   Start Eva by herself, and again after a crash (systemd on Linux, a logon task on Windows)
  supervise         Run Eva, and start her again after a crash (the Windows logon task runs this)
  update [version]  Install what the update policy allows, or a newer version, then restart Eva
      --check                            only look for a newer version
  sync              Bring the vault's remote changes in, then save and push this machine's changes
  hub               Make this machine the hub, which runs Telegram and the schedules
  link              Show the address that opens Eva on your phone and other computers
  settings          Show every setting; "(vault)" marks the settings that every machine shares
  settings get <key>          Show one setting, such as updates.frequency
  settings set <key> <value>  Change one setting, such as: settings set updates.frequency weekly
  devices allow <code>        Let in the browser that shows this code on Eva's page
  version           Show Eva's version
  help              Show this text
`;

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];
const engines: readonly EngineName[] = ["claude-code", "pi"];
/** Options that take no value. */
const switches: readonly string[] = ["--non-interactive", "--check"];
/** Options that take a value. */
const valueOptions: readonly string[] = ["--instance", "--project", "--clone", "--model", "--engine"];

export function parseArguments(argv: readonly string[]): CliCommand {
  const words: string[] = [];
  const options = new Map<string, string>();
  const switchesSeen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (switches.includes(word)) {
      switchesSeen.add(word);
    } else if (word.startsWith("--")) {
      if (!valueOptions.includes(word)) return usageError(`Unknown option ${word}.`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return usageError(`${word} needs a value.`);
      options.set(word.slice(2), value);
      index += 1;
    } else {
      words.push(word);
    }
  }
  const instance = options.get("instance");
  const [name, ...rest] = words;

  switch (name) {
    case undefined:
      return { command: "run", instance };
    case "setup":
      return { command: "setup", instance, nonInteractive: switchesSeen.has("--non-interactive") };
    case "doctor":
    case "status":
    case "help":
    case "version":
    case "sync":
    case "hub":
    case "link":
    case "supervise":
      return { command: name, instance };
    case "update":
      return updateCommand(instance, switchesSeen.has("--check"), rest);
    case "settings":
      return settingsCommand(instance, rest);
    case "devices":
      return rest[0] === "allow" && rest[1] !== undefined && rest.length === 2
        ? { command: "devices-allow", instance, code: rest[1] }
        : usageError("Use: eva devices allow <code>");
    case "projects":
      return { command: "projects", instance, query: rest.join(" ") };
    case "work": {
      const [projectId, ...request] = rest;
      if (projectId === undefined || request.length === 0) return usageError("Use: eva work <project> <request>");
      return { command: "work", instance, projectId, request: request.join(" ") };
    }
    case "service":
      return rest[0] === "install" ? { command: "service-install", instance } : usageError("Use: eva service install");
    case "chat": {
      const model = options.get("model");
      if (model !== undefined && !models.includes(model as ModelAlias)) return usageError(`Unknown model ${model}.`);
      const engine = options.get("engine");
      if (engine !== undefined && !engines.includes(engine as EngineName))
        return usageError(`Unknown engine ${engine}.`);
      const projectId = options.get("project");
      const clone = options.get("clone");
      return {
        command: "chat",
        instance,
        ...(projectId === undefined ? {} : { projectId }),
        ...(clone === undefined ? {} : { clone }),
        ...(model === undefined ? {} : { model: model as ModelAlias }),
        ...(engine === undefined ? {} : { engine: engine as EngineName }),
      };
    }
    default:
      return usageError(`Unknown command ${name}.`);
  }
}

function settingsCommand(instance: string | undefined, rest: readonly string[]): CliCommand {
  const [action, key, ...value] = rest;
  if (action === undefined) return { command: "settings", instance, action: "list" };
  if (action === "get" && key !== undefined && value.length === 0)
    return { command: "settings", instance, action, key };
  if (action === "set" && key !== undefined && value.length > 0)
    return { command: "settings", instance, action, key, value: value.join(" ") };
  return usageError("Use: eva settings, eva settings get <key>, or eva settings set <key> <value>");
}

function usageError(message: string): CliCommand {
  return { command: "usage-error", message };
}

function updateCommand(instance: string | undefined, checkOnly: boolean, rest: readonly string[]): CliCommand {
  const [word, ...extra] = rest;
  if (word === undefined) return { command: "update", instance, checkOnly, version: null };
  const version = word.replace(/^v/, "");
  if (extra.length > 0 || !/^\d+\.\d+\.\d+$/.test(version))
    return usageError("Use: eva update [version], such as 1.2.0");
  return { command: "update", instance, checkOnly, version };
}
