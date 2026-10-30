/**
 * Eva's pi extension that hides the instruction files above a project folder (#702), with a fake
 * pi extension API. The prompts below copy the forms of pi 0.73.1 and pi 1.4's `buildSystemPrompt`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import evaContextFilter, {
  contextNoticePrefix,
  hideUpperContext,
  projectFolderVariable,
  type FilterContext,
  type FilterEvent,
  type FilterPi,
  type FilterResult,
} from "../../../../src/engines/pi/pi-context-filter.ts";
import * as extension from "../../../../src/engines/pi/pi-context-extension.ts";

interface ContextFile {
  readonly path: string;
  readonly content: string;
}

/** pi 0.73.1's prompt: its base text, then the context files, then the date and folder. */
function oldPrompt(files: readonly ContextFile[]): string {
  let prompt = "You are pi.";
  if (files.length > 0) {
    prompt += "\n\n# Project Context\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path, content } of files) prompt += `## ${path}\n\n${content}\n\n`;
  }
  return `${prompt}\nCurrent date: 2026-01-01\nCurrent working directory: /work`;
}

/** pi 1.4's prompt: sections in tags. */
function newPrompt(files: readonly ContextFile[]): string {
  const context = [
    "Project-specific instructions and guidelines:",
    ...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
  ].join("\n\n");
  const sections = ["You are pi."];
  if (files.length > 0) sections.push(`<project_context>\n${context}\n</project_context>`);
  sections.push("<cwd>\n/work\n</cwd>");
  return sections.join("\n\n");
}

const global = { path: "/eva/engines/pi-agent/AGENTS.md", content: "Global rule." };
const vaultMap = { path: "/vault/AGENTS.md", content: "Vault map." };
const project = { path: "/vault/Projects/example-app/AGENTS.md", content: "Project rule." };
const repository = { path: "/vault/Projects/example-app/repos/clone-0/AGENTS.md", content: "Clone rule." };
const projectFolder = "/vault/Projects/example-app";

/** pi's prompt options, with a copy of the list, since the extension changes the list in place. */
function options(files: readonly ContextFile[]): { contextFiles: ContextFile[] } {
  return { contextFiles: [...files] };
}

class FakeExtensionApi implements FilterPi {
  readonly handlers: ((event: FilterEvent, context: FilterContext) => Promise<FilterResult>)[];

  constructor() {
    this.handlers = [];
  }

  on(
    _event: "before_agent_start",
    handler: (event: FilterEvent, context: FilterContext) => Promise<FilterResult>,
  ): void {
    this.handlers.push(handler);
  }
}

afterEach(() => {
  Reflect.deleteProperty(process.env, projectFolderVariable);
  // The extension keeps the folder for a second load in the same process. Each test starts with none.
  Reflect.deleteProperty(globalThis, Symbol.for("eva.projectFolder"));
});

describe("hideUpperContext, pi 0.73.1", () => {
  test("removes each file above the project folder, and keeps the project's files and pi's global file", () => {
    const files = [global, vaultMap, project, repository];
    const promptOptions = options(files);
    const { prompt, problem } = hideUpperContext(oldPrompt(files), promptOptions, projectFolder, posix);
    expect(prompt).toBe(oldPrompt([global, project, repository]));
    expect(promptOptions.contextFiles).toEqual([global, project, repository]);
    expect(problem).toBeNull();
  });

  test("drops the Project Context header when no file is left", () => {
    expect(hideUpperContext(oldPrompt([vaultMap]), options([vaultMap]), projectFolder, posix).prompt).toBe(
      oldPrompt([]),
    );
  });

  test("keeps the prompt as it is when no file is above the project folder", () => {
    const files = [global, project];
    expect(hideUpperContext(oldPrompt(files), options(files), projectFolder, posix)).toEqual({
      prompt: oldPrompt(files),
      problem: null,
    });
  });

  test("on Windows, the comparison ignores case and the kind of separator", () => {
    const winMap = { path: "d:/data/example/vault/AGENTS.md", content: "Vault map." };
    const winProject = {
      path: "D:\\Data\\Example\\Vault\\Projects\\example-app\\AGENTS.md",
      content: "Project rule.",
    };
    const files = [winMap, winProject];
    const { prompt } = hideUpperContext(
      oldPrompt(files),
      options(files),
      "D:\\Data\\Example\\Vault\\Projects\\example-app",
      win32,
    );
    expect(prompt).toBe(oldPrompt([winProject]));
  });

  test("a folder whose child is named `..notes` is still above a project inside that child", () => {
    const map = { path: "/data/AGENTS.md", content: "Vault map." };
    expect(hideUpperContext(oldPrompt([map]), options([map]), "/data/..notes/Projects/example-app", posix).prompt).toBe(
      oldPrompt([]),
    );
  });

  test("a folder with nearly the same name as the project's parent is not above it", () => {
    const sibling = { path: "/vault/Projects-old/AGENTS.md", content: "Other rule." };
    const files = [sibling, project];
    expect(hideUpperContext(oldPrompt(files), options(files), projectFolder, posix).prompt).toBe(oldPrompt(files));
  });
});

describe("hideUpperContext, pi 1.4", () => {
  test("takes the hidden files out of pi's list, and leaves the text to pi, which builds it again", () => {
    const files = [global, vaultMap, project];
    const promptOptions = options(files);
    const original = newPrompt(files);
    expect(hideUpperContext(original, promptOptions, projectFolder, posix)).toEqual({
      prompt: original,
      problem: null,
    });
    expect(promptOptions.contextFiles).toEqual([global, project]);
  });
});

describe("hideUpperContext, a form that Eva does not know", () => {
  test("with no list of files, drops the whole project context and says so", () => {
    for (const prompt of [oldPrompt([vaultMap, project]), newPrompt([vaultMap, project])]) {
      const result = hideUpperContext(prompt, undefined, projectFolder, posix);
      expect(result.prompt).not.toContain("Vault map.");
      expect(result.prompt).toContain("You are pi.");
      expect(result.problem).not.toBeNull();
    }
  });

  test("with a hidden file in neither known form, drops the whole project context and says so", () => {
    const changedForm = oldPrompt([project]).replace("You are pi.", `You are pi.\n\n${vaultMap.content}`);
    const result = hideUpperContext(changedForm, options([vaultMap, project]), projectFolder, posix);
    expect(result.prompt).not.toContain("Project rule.");
    expect(result.problem).not.toBeNull();
  });

  test("a file that pi describes in another way is hidden too", () => {
    const promptOptions = { contextFiles: [{ name: "AGENTS.md" }, project] as unknown[] };
    const result = hideUpperContext(newPrompt([project]), promptOptions, projectFolder, posix);
    expect(promptOptions.contextFiles).toEqual([project]);
    expect(result.problem).not.toBeNull();
  });
});

describe("the extension", () => {
  const notices: string[] = [];
  const context = { ui: { notify: (message: string) => notices.push(message) } };
  afterEach(() => {
    notices.length = 0;
  });

  function loaded(): FakeExtensionApi {
    process.env[projectFolderVariable] = projectFolder;
    const pi = new FakeExtensionApi();
    evaContextFilter(pi);
    return pi;
  }

  test("reads the project folder once and deletes it, so pi's shell tool never sees it", async () => {
    const pi = loaded();
    expect(process.env[projectFolderVariable]).toBeUndefined();
    const files = [vaultMap, project];
    const result = await pi.handlers[0]?.(
      { systemPrompt: oldPrompt(files), systemPromptOptions: options(files) },
      context,
    );
    expect(result).toEqual({ systemPrompt: oldPrompt([project]) });
    expect(notices).toEqual([]);
  });

  test("in pi 1.4, whose prompt is a getter over the list, keeps pi's own prompt and forces none", async () => {
    const promptOptions = options([vaultMap, project]);
    // pi 1.4 renders `systemPrompt` from the options each time a handler reads it.
    const event = {
      get systemPrompt(): string {
        return newPrompt(promptOptions.contextFiles);
      },
      systemPromptOptions: promptOptions,
    };
    const result = await loaded().handlers[0]?.(event, context);
    expect(result).toBeUndefined();
    expect(event.systemPrompt).toBe(newPrompt([project]));
    expect(notices).toEqual([]);
  });

  test("sends a problem to the chat with its own prefix", async () => {
    await loaded().handlers[0]?.({ systemPrompt: oldPrompt([]) }, context);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.startsWith(contextNoticePrefix)).toBe(true);
  });

  test("drops the whole project context and says so when its own code fails", async () => {
    const failing = {
      get contextFiles(): unknown {
        throw new Error("pi changed its options");
      },
    };
    const result = await loaded().handlers[0]?.(
      { systemPrompt: newPrompt([vaultMap]), systemPromptOptions: failing },
      context,
    );
    expect(result?.systemPrompt).not.toContain("Vault map.");
    expect(notices).toHaveLength(1);
  });

  test("stays on when pi loads it again in the same process, after the variable is gone", () => {
    loaded();
    const again = new FakeExtensionApi();
    evaContextFilter(again);
    expect(again.handlers).toHaveLength(1);
  });

  test("does nothing in a chat with no project folder, such as an Assistant chat", () => {
    const pi = new FakeExtensionApi();
    evaContextFilter(pi);
    expect(pi.handlers).toEqual([]);
  });

  test("the text that pi loads is this file, with the same names", () => {
    expect(extension.contextExtensionSource).toBe(
      readFileSync(join(import.meta.dir, "../../../../src/engines/pi/pi-context-filter.ts"), "utf8"),
    );
    expect(extension.projectFolderVariable).toBe(projectFolderVariable);
    expect(extension.contextNoticePrefix).toBe(contextNoticePrefix);
  });
});
