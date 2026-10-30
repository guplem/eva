import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComposerMenu,
  savedPromptsFolder,
  textActionsFolder,
} from "../../../../src/core/composer-menu/composer-menu.ts";
import { ModelCalls } from "../../../../src/core/model-calls/model-calls.ts";
import { templateParts } from "../../../../src/core/vault/vault-template.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function vault(): string {
  const folder = mkdtempSync(join(tmpdir(), "eva-composer-menu-"));
  folders.push(folder);
  return folder;
}

function menu(vaultPath: string, script?: FakeTurnScript): { menu: ComposerMenu; engine: FakeEngine } {
  const engine = new FakeEngine(script);
  const modelCalls = new ModelCalls({ engines: [engine], environment: {}, redact: (text) => text, timeoutMs: 5_000 });
  return { engine, menu: new ComposerMenu({ vaultPath, modelCalls }) };
}

function put(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("the composer menu files (#661)", () => {
  test("a vault with no folders has an empty menu", () => {
    expect(menu(vault()).menu.list()).toEqual({ textActions: [], savedPrompts: [] });
  });

  test("it reads each file as one item, by name, with the model of the header", () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "---\nmodel: sonnet\n---\nFix the spelling.\n");
    put(join(textActionsFolder(root), "Shorter.md"), "Make it shorter.\n");
    put(join(textActionsFolder(root), "notes.txt"), "Not an action.");
    put(join(savedPromptsFolder(root), "Summary.md"), "Summarize what we did.\n");
    expect(menu(root).menu.list()).toEqual({
      textActions: [
        { name: "Polish", model: "sonnet", prompt: "Fix the spelling." },
        { name: "Shorter", model: "haiku", prompt: "Make it shorter." },
      ],
      savedPrompts: [{ name: "Summary", text: "Summarize what we did." }],
    });
  });

  test("a header with an unknown model reads as the fast model", () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "---\nmodel: huge\n---\nFix it.");
    expect(menu(root).menu.list().textActions).toEqual([{ name: "Polish", model: "haiku", prompt: "Fix it." }]);
  });

  test("it saves, renames and removes a text action", () => {
    const root = vault();
    const { menu: composer } = menu(root);
    composer.saveTextAction({ name: "Polish", model: "opus", prompt: "Fix it." });
    expect(readFileSync(join(textActionsFolder(root), "Polish.md"), "utf-8")).toBe(
      "---\nmodel: opus\n---\n\nFix it.\n",
    );
    composer.saveTextAction({ name: "Clean", previousName: "Polish", model: "haiku", prompt: "Clean it." });
    expect(existsSync(join(textActionsFolder(root), "Polish.md"))).toBe(false);
    expect(composer.list().textActions).toEqual([{ name: "Clean", model: "haiku", prompt: "Clean it." }]);
    composer.removeTextAction("Clean");
    expect(composer.list().textActions).toEqual([]);
  });

  test("it saves and removes a saved prompt", () => {
    const root = vault();
    const { menu: composer } = menu(root);
    composer.savePrompt({ name: "Summary", text: "Summarize it." });
    expect(readFileSync(join(savedPromptsFolder(root), "Summary.md"), "utf-8")).toBe("Summarize it.\n");
    composer.removePrompt("Summary");
    expect(composer.list().savedPrompts).toEqual([]);
  });

  test("a name that is no file name, or that another item has, is refused", () => {
    const { menu: composer } = menu(vault());
    for (const name of ["", "  ", "../Polish", "a/b", ".hidden", "x".repeat(61)]) {
      expect(() => composer.savePrompt({ name, text: "Hi" })).toThrow(EvaError);
    }
    composer.savePrompt({ name: "Summary", text: "One" });
    composer.savePrompt({ name: "Other", text: "Two" });
    expect(() => composer.savePrompt({ name: "Summary", previousName: "Other", text: "Two" })).toThrow("already");
  });

  test("the template brings Polish and Summary in the same folders", () => {
    const root = vault();
    for (const [path, text] of Object.entries(templateParts)) put(join(root, path), text);
    const list = menu(root).menu.list();
    expect(list.textActions.map((action) => action.name)).toEqual(["Polish"]);
    expect(list.textActions[0]?.model).toBe("haiku");
    expect(list.savedPrompts.map((prompt) => prompt.name)).toEqual(["Summary"]);
  });
});

describe("a text action run (#661)", () => {
  test("it sends only the text and the action's prompt, on the chat's engine with the action's model", async () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "---\nmodel: sonnet\n---\nFix the spelling.");
    const { menu: composer, engine } = menu(root, (request) => FakeEngine.answer(request, "  Hello, world.\n"));
    expect(
      await composer.runTextAction({ name: "Polish", engine: "claude-code", text: "helo  wrld if a < b" }),
    ).toEqual({ ok: true, text: "Hello, world." });
    const request = engine.requests[0];
    expect(request?.model).toBe("sonnet");
    expect(request?.prompt).toContain("Fix the spelling.");
    // The text goes as it is: a `<` in code must come back as a `<`.
    expect(request?.prompt).toContain("<text>\nhelo  wrld if a < b\n</text>");
    expect(request?.appendSystemPrompt).toContain("only");
  });

  test("an answer wrapped in the text block loses the wrapper", async () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "Fix it.");
    const { menu: composer } = menu(root, (request) => FakeEngine.answer(request, "<text>\nFixed.\n</text>"));
    expect(await composer.runTextAction({ name: "Polish", engine: "claude-code", text: "fixd" })).toEqual({
      ok: true,
      text: "Fixed.",
    });
  });

  test("an empty answer fails with a reason", async () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "Fix it.");
    const { menu: composer } = menu(root, (request) => FakeEngine.answer(request, "  "));
    expect(await composer.runTextAction({ name: "Polish", engine: "claude-code", text: "Hi" })).toMatchObject({
      ok: false,
    });
  });
});

describe("the composer menu fixes after review (#661)", () => {
  test("a case-only rename keeps one file with the new name", () => {
    const root = vault();
    const { menu: composer } = menu(root);
    composer.savePrompt({ name: "summary", text: "One" });
    composer.savePrompt({ name: "Summary", previousName: "summary", text: "One" });
    expect(composer.list().savedPrompts).toEqual([{ name: "Summary", text: "One" }]);
  });

  test("a rename onto a name that differs only in case from another item is refused", () => {
    const { menu: composer } = menu(vault());
    composer.savePrompt({ name: "Summary", text: "One" });
    composer.savePrompt({ name: "Other", text: "Two" });
    expect(() => composer.savePrompt({ name: "SUMMARY", previousName: "Other", text: "Two" })).toThrow("already");
  });

  test("a file that a person named by hand can still be renamed and removed", () => {
    const root = vault();
    put(join(savedPromptsFolder(root), "Plan .md"), "Plan it.");
    const { menu: composer } = menu(root);
    composer.savePrompt({ name: "Plan", previousName: "Plan ", text: "Plan it." });
    expect(composer.list().savedPrompts).toEqual([{ name: "Plan", text: "Plan it." }]);
    put(join(savedPromptsFolder(root), "Odd .md"), "x");
    composer.removePrompt("Odd ");
    expect(composer.list().savedPrompts.map((prompt) => prompt.name)).toEqual(["Plan"]);
  });

  test("a Windows device name is refused", () => {
    const { menu: composer } = menu(vault());
    for (const name of ["CON", "nul", "Com1", "LPT9"]) {
      expect(() => composer.savePrompt({ name, text: "Hi" })).toThrow(EvaError);
    }
  });

  test("a header after a byte order mark still names the model", () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "﻿---\nmodel: opus\n---\nFix it.");
    expect(menu(root).menu.list().textActions).toEqual([{ name: "Polish", model: "opus", prompt: "Fix it." }]);
  });

  test("a save into a vault that a newer Eva migrated fails with vault_ahead", () => {
    const root = vault();
    put(
      join(root, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    const { menu: composer } = menu(root);
    expect(() => composer.savePrompt({ name: "Summary", text: "Hi" })).toThrow("9.0.0");
    expect(() => composer.removePrompt("Summary")).toThrow("9.0.0");
  });

  test("an empty box and a missing action throw codes that the page tells apart", async () => {
    const root = vault();
    put(join(textActionsFolder(root), "Polish.md"), "Fix it.");
    const { menu: composer } = menu(root);
    const codeOf = (run: Promise<unknown>): Promise<string> =>
      run.then(
        () => "none",
        (error: unknown) => (isEvaError(error) ? error.code : "other"),
      );
    expect(await codeOf(composer.runTextAction({ name: "Polish", engine: "claude-code", text: " " }))).toBe(
      "menu_item_invalid",
    );
    expect(await codeOf(composer.runTextAction({ name: "Gone", engine: "claude-code", text: "Hi" }))).toBe(
      "file_not_found",
    );
  });
});

describe("two hand-made files that differ only in case (#661)", () => {
  test("a rename of one onto the other's name is refused, so no text is lost", () => {
    if (process.platform !== "linux") return;
    const root = vault();
    put(join(savedPromptsFolder(root), "summary.md"), "Small");
    put(join(savedPromptsFolder(root), "Summary.md"), "Big");
    const { menu: composer } = menu(root);
    expect(() => composer.savePrompt({ name: "Summary", previousName: "summary", text: "Small" })).toThrow("already");
    expect(
      composer
        .list()
        .savedPrompts.map((prompt) => prompt.text)
        .sort(),
    ).toEqual(["Big", "Small"]);
  });
});
