/**
 * The pi extension that hides from a Project chat each instruction file above its project folder,
 * such as the vault's map, so the chat does not know that it runs inside Eva (#702). pi reads
 * every `AGENTS.md` from its start folder up to the root of the disk. Its `--no-context-files`
 * would also drop pi's global file, and its `--append-system-prompt` would replace the person's
 * own `APPEND_SYSTEM.md`. So this extension takes pi's own prompt and removes only those files.
 *
 * pi loads this file as text with `-e` (see pi-context-extension.ts), so it imports nothing but
 * Node modules. The prompt form is pi 0.73.1's `buildSystemPrompt`. When the form differs, the
 * extension tells the person, since a vault file could then reach the chat.
 */
import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";

/** The variable that names the project folder. pi-context-extension.ts holds the same name for Eva. */
export const projectFolderVariable = "EVA_PROJECT_FOLDER";

/**
 * Starts each problem line that this extension sends to pi's RPC client with `notify`, so Eva's pi
 * adapter shows it in the chat. pi-context-extension.ts holds the same text.
 */
export const contextNoticePrefix = "eva-context-notice:";

const nativePath = process.platform === "win32" ? win32 : posix;

const contextHeader = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";

/** The part of pi's `before_agent_start` event that this extension reads. */
export interface FilterEvent {
  readonly systemPrompt: string;
  readonly systemPromptOptions?: { readonly contextFiles?: unknown };
}

/** The part of pi's extension context that this extension uses. */
export interface FilterContext {
  readonly ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

/** A new prompt for the turn, or nothing to keep pi's own. */
export type FilterResult = { readonly systemPrompt: string } | undefined;

/** The part of pi's extension API that this extension uses. */
export interface FilterPi {
  on(event: "before_agent_start", handler: (event: FilterEvent, context: FilterContext) => Promise<FilterResult>): void;
}

/**
 * Where the folder stays once the variable is gone. pi loads the extension again in the same
 * process when it reloads its resources or opens another session, and the filter must stay on.
 */
const folderSlot = Symbol.for("eva.projectFolder");

export default function evaContextFilter(pi: FilterPi): void {
  const slots = globalThis as Record<symbol, string | undefined>;
  // Read once and deleted, so pi's shell tool never sees the variable.
  const projectFolder = process.env[projectFolderVariable] ?? slots[folderSlot];
  Reflect.deleteProperty(process.env, projectFolderVariable);
  if (projectFolder === undefined || projectFolder === "") return;
  slots[folderSlot] = projectFolder;
  pi.on("before_agent_start", (event, context) => {
    const { prompt, problem } = hideUpperContext(
      event.systemPrompt,
      event.systemPromptOptions?.contextFiles,
      projectFolder,
    );
    if (problem !== null) context.ui.notify(`${contextNoticePrefix}${problem}`, "error");
    return Promise.resolve(prompt === event.systemPrompt ? undefined : { systemPrompt: prompt });
  });
}

/**
 * pi's prompt with no file of a folder above the project folder. A problem says why a file may
 * still be in it. pi's global file lives in Eva's engine folder, not above a project, so it stays.
 */
export function hideUpperContext(
  systemPrompt: string,
  contextFiles: unknown,
  projectFolder: string,
  path: typeof posix = nativePath,
): { readonly prompt: string; readonly problem: string | null } {
  if (!Array.isArray(contextFiles)) {
    return { prompt: systemPrompt, problem: "Eva could not check which instruction files pi loaded." };
  }
  const project = canonical(projectFolder, path);
  let prompt = systemPrompt;
  let missing = false;
  let shown = 0;
  for (const file of contextFiles as unknown[]) {
    const { path: filePath, content } = (file ?? {}) as { path?: unknown; content?: unknown };
    if (typeof filePath !== "string" || typeof content !== "string") {
      missing = true;
      continue;
    }
    if (!isAbove(canonical(path.dirname(filePath), path), project, path)) {
      shown += 1;
      continue;
    }
    const block = `## ${filePath}\n\n${content}\n\n`;
    if (prompt.includes(block)) prompt = prompt.replace(block, "");
    else missing = true;
  }
  if (missing) {
    return {
      prompt,
      problem: "Eva could not hide every instruction file of the vault from this chat: pi's prompt has a new form.",
    };
  }
  if (shown === 0) prompt = prompt.replace(contextHeader, "");
  return { prompt, problem: null };
}

/** The real path when it exists. Windows paths ignore case, so they compare in lower case. */
function canonical(folder: string, path: typeof posix): string {
  let real = path.resolve(folder);
  try {
    real = path.resolve(realpathSync(folder));
  } catch {
    // A path of another system, as in a test, or a folder that is gone.
  }
  return path.sep === "\\" ? real.toLowerCase() : real;
}

/** True when the project is inside the folder. A child named `..notes` is still inside. */
function isAbove(folder: string, project: string, path: typeof posix): boolean {
  const relative = path.relative(folder, project);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
