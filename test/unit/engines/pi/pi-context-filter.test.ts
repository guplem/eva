/**
 * Eva's pi extension that hides the instruction files above a project folder (#702), with a fake
 * pi extension API. The prompts below copy the form of pi 0.73.1's `buildSystemPrompt`.
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

/** The prompt that pi builds: its base text, then the context files, then the date and folder. */
function piPrompt(files: readonly ContextFile[]): string {
  let prompt = "You are pi.";
  if (files.length > 0) {
    prompt += "\n\n# Project Context\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path, content } of files) prompt += `## ${path}\n\n${content}\n\n`;
  }
  return `${prompt}\nCurrent date: 2026-01-01\nCurrent working directory: /work`;
}

const global = { path: "/eva/engines/pi-agent/AGENTS.md", content: "Global rule." };
const vaultMap = { path: "/vault/AGENTS.md", content: "Vault map." };
const project = { path: "/vault/Projects/example-app/AGENTS.md", content: "Project rule." };
const repository = { path: "/vault/Projects/example-app/repos/clone-0/AGENTS.md", content: "Clone rule." };
const projectFolder = "/vault/Projects/example-app";

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
});

describe("hideUpperContext", () => {
  test("removes each file above the project folder, and keeps the project's files and pi's global file", () => {
    const files = [global, vaultMap, project, repository];
    const { prompt, problem } = hideUpperContext(piPrompt(files), files, projectFolder, posix);
    expect(prompt).toBe(piPrompt([global, project, repository]));
    expect(problem).toBeNull();
  });

  test("drops the Project Context header when no file is left", () => {
    const { prompt } = hideUpperContext(piPrompt([vaultMap]), [vaultMap], projectFolder, posix);
    expect(prompt).toBe(piPrompt([]));
  });

  test("keeps the prompt as it is when no file is above the project folder", () => {
    const files = [global, project];
    expect(hideUpperContext(piPrompt(files), files, projectFolder, posix)).toEqual({
      prompt: piPrompt(files),
      problem: null,
    });
  });

  test("a hidden file that the prompt does not show as pi did is a problem for the person", () => {
    const changedForm = piPrompt([project]).replace("You are pi.", `You are pi.\n\n${vaultMap.content}`);
    const { problem } = hideUpperContext(changedForm, [vaultMap, project], projectFolder, posix);
    expect(problem).toContain("vault");
  });

  test("a list of files that pi does not give is a problem, and the prompt stays as it is", () => {
    const original = piPrompt([vaultMap]);
    const { prompt, problem } = hideUpperContext(original, undefined, projectFolder, posix);
    expect(prompt).toBe(original);
    expect(problem).not.toBeNull();
  });

  test("on Windows, the comparison ignores case and the kind of separator", () => {
    const winMap = { path: "d:/data/example/vault/AGENTS.md", content: "Vault map." };
    const winProject = {
      path: "D:\\Data\\Example\\Vault\\Projects\\example-app\\AGENTS.md",
      content: "Project rule.",
    };
    const files = [winMap, winProject];
    const { prompt } = hideUpperContext(
      piPrompt(files),
      files,
      "D:\\Data\\Example\\Vault\\Projects\\example-app",
      win32,
    );
    expect(prompt).toBe(piPrompt([winProject]));
  });

  test("a folder with nearly the same name as the project's parent is not above it", () => {
    const sibling = { path: "/vault/Projects-old/AGENTS.md", content: "Other rule." };
    const files = [sibling, project];
    expect(hideUpperContext(piPrompt(files), files, projectFolder, posix).prompt).toBe(piPrompt(files));
  });
});

describe("the extension", () => {
  test("reads the project folder once and deletes it, so pi's shell tool never sees it", async () => {
    process.env[projectFolderVariable] = projectFolder;
    const pi = new FakeExtensionApi();
    evaContextFilter(pi);
    expect(process.env[projectFolderVariable]).toBeUndefined();
    const handler = pi.handlers[0];
    if (handler === undefined) throw new Error("The extension registered no handler.");
    const notices: string[] = [];
    const context = { ui: { notify: (message: string) => notices.push(message) } };
    const files = [vaultMap, project];
    const result = await handler(
      { systemPrompt: piPrompt(files), systemPromptOptions: { contextFiles: files } },
      context,
    );
    expect(result).toEqual({ systemPrompt: piPrompt([project]) });
    expect(notices).toEqual([]);
  });

  test("sends a problem to the chat with its own prefix", async () => {
    process.env[projectFolderVariable] = projectFolder;
    const pi = new FakeExtensionApi();
    evaContextFilter(pi);
    const notices: string[] = [];
    const context = { ui: { notify: (message: string) => notices.push(message) } };
    await pi.handlers[0]?.({ systemPrompt: piPrompt([]) }, context);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.startsWith(contextNoticePrefix)).toBe(true);
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
