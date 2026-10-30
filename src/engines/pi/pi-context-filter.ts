/**
 * The pi extension that hides from a Project chat each instruction file above its project folder,
 * such as the vault's map, so the chat does not know that it runs inside Eva (#702). pi reads
 * every `AGENTS.md` from its start folder up to the root of the disk. Its `--no-context-files`
 * would also drop pi's global file. Its `--append-system-prompt` would replace the person's own
 * `APPEND_SYSTEM.md`. So this extension takes pi's own list of files and removes only those.
 *
 * pi 1.4 builds its prompt again from the list after this event. pi 0.73.1 does not, so the
 * extension also cuts each file's block out of 0.73.1's text. When neither form fits, or the
 * extension fails, it drops the whole project context and tells the person: a vault file must
 * never reach the chat with no word.
 *
 * pi loads this file as text with `-e` (see pi-context-extension.ts), so it imports nothing but
 * Node modules.
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

/** pi 0.73.1's header of the project context. */
const oldContextHeader = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";

/** The prompt options of pi's `before_agent_start` event. pi 1.4 lets a handler change them. */
export interface FilterOptions {
  contextFiles?: unknown;
}

/** The part of pi's `before_agent_start` event that this extension reads. */
export interface FilterEvent {
  readonly systemPrompt: string;
  readonly systemPromptOptions?: FilterOptions;
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

const newFormProblem =
  "Eva could not hide the vault's instructions from this chat in the usual way, so it dropped them all.";

export default function evaContextFilter(pi: FilterPi): void {
  const slots = globalThis as Record<symbol, string | undefined>;
  // Read once and deleted, so pi's shell tool never sees the variable.
  const projectFolder = process.env[projectFolderVariable] ?? slots[folderSlot];
  Reflect.deleteProperty(process.env, projectFolderVariable);
  if (projectFolder === undefined || projectFolder === "") return;
  slots[folderSlot] = projectFolder;
  // Every path hidden so far. pi 0.73.1 keeps an old base prompt after the list changes, so a later
  // prompt in the same process can still hold a file that the list no longer names.
  const hiddenPaths = new Set<string>();
  pi.on("before_agent_start", (event, context) => {
    // In pi 1.4 this is a getter that renders the prompt again from the list. A changed prompt
    // must be compared with this first read, or the old prompt would become a forced one.
    const before = event.systemPrompt;
    let result: { readonly prompt: string; readonly problem: string | null };
    try {
      result = hideUpperContext(before, event.systemPromptOptions, projectFolder, nativePath, hiddenPaths);
      // The prompt that pi will send: pi 1.4 renders it from the changed list, so read it again.
      const sent = result.prompt === before ? event.systemPrompt : result.prompt;
      if ([...hiddenPaths].some((path) => showsFile(sent, path))) {
        result = { prompt: withoutProjectContext(sent), problem: newFormProblem };
      }
    } catch {
      // pi reports a handler's error only in its log, so the person would never hear of it.
      result = { prompt: withoutProjectContext(before), problem: newFormProblem };
    }
    if (result.problem !== null) context.ui.notify(`${contextNoticePrefix}${result.problem}`, "error");
    return Promise.resolve(result.prompt === before ? undefined : { systemPrompt: result.prompt });
  });
}

/** True when the prompt still shows the file, in pi 0.73.1's form or in pi 1.4's. */
function showsFile(prompt: string, path: string): boolean {
  return prompt.includes(`## ${path}\n`) || prompt.includes(`<project_instructions path="${path}">`);
}

/**
 * pi's prompt with no file of a folder above the project folder, and the same files out of pi's
 * list. A problem says that Eva dropped the whole project context. pi's global file lives in Eva's
 * engine folder, not above a project, so it stays.
 */
export function hideUpperContext(
  systemPrompt: string,
  options: FilterOptions | undefined,
  projectFolder: string,
  path: typeof posix = nativePath,
  hiddenPaths = new Set<string>(),
): { readonly prompt: string; readonly problem: string | null } {
  const files = options?.contextFiles;
  if (!Array.isArray(files)) return { prompt: withoutProjectContext(systemPrompt), problem: newFormProblem };
  const project = canonical(projectFolder, path);
  const hidden = (files as unknown[]).filter((file) => {
    const { path: filePath, content } = (file ?? {}) as { path?: unknown; content?: unknown };
    // A file that pi describes in another way is hidden too: Eva cannot tell where it comes from.
    if (typeof filePath !== "string" || typeof content !== "string") return true;
    return isAbove(canonical(path.dirname(filePath), path), project, path);
  });
  for (const file of hidden) {
    const filePath = (file as { path?: unknown } | null)?.path;
    if (typeof filePath === "string") hiddenPaths.add(filePath);
  }
  if (hidden.length === 0) return { prompt: systemPrompt, problem: null };
  // pi 1.4 builds the prompt again from this list. pi 0.73.1 uses it when it builds a new base prompt.
  for (let index = files.length - 1; index >= 0; index -= 1) {
    if (hidden.includes(files[index])) files.splice(index, 1);
  }
  let prompt = systemPrompt;
  for (const file of hidden) {
    const { path: filePath, content } = file as { path: unknown; content: unknown };
    const oldBlock = `## ${String(filePath)}\n\n${String(content)}\n\n`;
    const newBlock = `<project_instructions path="${String(filePath)}">\n${String(content)}\n</project_instructions>`;
    if (prompt.includes(oldBlock)) prompt = prompt.replace(oldBlock, "");
    else if (!prompt.includes(newBlock)) {
      return { prompt: withoutProjectContext(systemPrompt), problem: newFormProblem };
    }
  }
  if (files.length === 0) prompt = prompt.replace(oldContextHeader, "");
  return { prompt, problem: null };
}

/** The prompt with no project context at all, in pi 1.4's form or in pi 0.73.1's. */
function withoutProjectContext(prompt: string): string {
  // From the first opening tag to the last closing tag: a file's own text can hold a closing tag.
  const open = prompt.indexOf("<project_context>");
  const close = prompt.lastIndexOf("</project_context>");
  const newForm =
    open === -1 || close < open
      ? prompt
      : prompt.slice(0, open).trimEnd() + prompt.slice(close + "</project_context>".length);
  const start = newForm.indexOf(oldContextHeader);
  if (start === -1) return newForm;
  const end = newForm.indexOf("\nCurrent date:", start);
  return end === -1 ? newForm.slice(0, start) : newForm.slice(0, start) + newForm.slice(end);
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
