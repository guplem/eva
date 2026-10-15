/** Reads the `eva` command line (docs/plan.md §8.1). */
import type { EngineName, ModelAlias } from "../../shared/engine-port.ts";

export type CliCommand =
  | { readonly command: "run"; readonly home: string | undefined }
  | { readonly command: "setup"; readonly home: string | undefined; readonly nonInteractive: boolean }
  | { readonly command: "doctor"; readonly home: string | undefined }
  | { readonly command: "status"; readonly home: string | undefined }
  | { readonly command: "help"; readonly home: string | undefined }
  | { readonly command: "version"; readonly home: string | undefined }
  | { readonly command: "update"; readonly home: string | undefined }
  | { readonly command: "service-install"; readonly home: string | undefined }
  | { readonly command: "projects"; readonly home: string | undefined; readonly query: string }
  | {
      readonly command: "work";
      readonly home: string | undefined;
      readonly projectId: string;
      readonly request: string;
    }
  | {
      readonly command: "chat";
      readonly home: string | undefined;
      readonly projectId?: string;
      readonly clone?: string;
      readonly model?: ModelAlias;
      readonly engine?: EngineName;
    }
  | { readonly command: "usage-error"; readonly message: string };

export const usageText = `Usage: eva [--home <folder>] [command]

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
  work <project> <request>  Give work to a project: a Project chat in a free clone runs it
  service install   Start Eva by itself (systemd on Linux, a logon task on Windows)
  update            Replace this executable with the latest signed release
  version           Show Eva's version
  help              Show this text
`;

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];
const engines: readonly EngineName[] = ["claude-code", "pi"];
/** Options that take no value. */
const switches: readonly string[] = ["--non-interactive"];

export function parseArguments(argv: readonly string[]): CliCommand {
  const words: string[] = [];
  const options = new Map<string, string>();
  const switchesSeen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (switches.includes(word)) {
      switchesSeen.add(word);
    } else if (word.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return usageError(`${word} needs a value.`);
      options.set(word.slice(2), value);
      index += 1;
    } else {
      words.push(word);
    }
  }
  const home = options.get("home");
  const [name, ...rest] = words;

  switch (name) {
    case undefined:
      return { command: "run", home };
    case "setup":
      return { command: "setup", home, nonInteractive: switchesSeen.has("--non-interactive") };
    case "doctor":
    case "status":
    case "help":
    case "version":
    case "update":
      return { command: name, home };
    case "projects":
      return { command: "projects", home, query: rest.join(" ") };
    case "work": {
      const [projectId, ...request] = rest;
      if (projectId === undefined || request.length === 0) return usageError("Use: eva work <project> <request>");
      return { command: "work", home, projectId, request: request.join(" ") };
    }
    case "service":
      return rest[0] === "install" ? { command: "service-install", home } : usageError("Use: eva service install");
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
        home,
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

function usageError(message: string): CliCommand {
  return { command: "usage-error", message };
}
