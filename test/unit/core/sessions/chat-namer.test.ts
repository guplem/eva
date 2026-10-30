import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCalls } from "../../../../src/core/model-calls/model-calls.ts";
import { ChatNamer, chatNameRulesPath } from "../../../../src/core/sessions/chat-namer.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";

let vault: string;
let logs: { level: LogLevel; message: string }[];

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-chat-namer-"));
  logs = [];
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function namer(script?: FakeTurnScript): { namer: ChatNamer; engine: FakeEngine } {
  const engine = new FakeEngine(script);
  const calls = new ModelCalls({ engines: [engine], environment: {}, redact: (text) => text, timeoutMs: 5_000 });
  return {
    engine,
    namer: new ChatNamer({
      vaultPath: vault,
      modelCalls: calls,
      logger: { log: (level, message) => logs.push({ level, message }) },
    }),
  };
}

function writeRules(text: string): void {
  mkdirSync(join(vault, ".eva", "settings"), { recursive: true });
  writeFileSync(chatNameRulesPath(vault), text);
}

const turn = { engine: "claude-code", model: "opus", userText: "Implement issue 50", answerText: "Done." } as const;

describe("the chat namer", () => {
  test("without rules, or with empty rules, it asks no model and keeps the first line", async () => {
    const { namer: withoutRules, engine } = namer();
    expect(await withoutRules.name(turn)).toBeNull();
    writeRules("  \n");
    expect(await withoutRules.name(turn)).toBeNull();
    expect(engine.requests).toHaveLength(0);
  });

  test("it gives the model the rules, the first message and the first answer, on the cheapest model", async () => {
    writeRules("Name an issue chat `Implementing #N`.");
    const { namer: withRules, engine } = namer((request) => FakeEngine.answer(request, "Implementing #50"));
    expect(await withRules.name(turn)).toBe("Implementing #50");
    const request = engine.requests[0];
    expect(request?.model).toBe("haiku");
    expect(request?.appendSystemPrompt).toContain("one line");
    expect(request?.prompt).toContain("<rules>\nName an issue chat `Implementing #N`.\n</rules>");
    expect(request?.prompt).toContain("<first-message>\nImplement issue 50\n</first-message>");
    expect(request?.prompt).toContain("<first-answer>\nDone.\n</first-answer>");
  });

  test("it keeps the first line of the answer, without quotes, and cuts long texts it sends", async () => {
    writeRules("Lead with an emoji.");
    const { namer: withRules, engine } = namer((request) =>
      FakeEngine.answer(request, '\n  "🚀 Launch plan"  \nBecause it is about a launch.'),
    );
    expect(await withRules.name({ ...turn, userText: "x".repeat(5_000) })).toBe("🚀 Launch plan");
    expect(engine.requests[0]?.prompt.length).toBeLessThan(5_000);
  });

  test.each([
    ["**Rome trip**", "Rome trip"],
    ["Name: Rome trip", "Rome trip"],
    ["Chat title: *Rome trip*", "Rome trip"],
    ["# Rome trip", "Rome trip"],
    ["- Rome trip", "Rome trip"],
    ["“Rome trip.”", "Rome trip"],
    ["Implementing #50", "Implementing #50"],
    ["v2.", "v2."],
    ['"Budget".', "Budget"],
    ["**Budget**.", "Budget"],
    ["Title:\nTrip to Rome", "Trip to Rome"],
    ["Here is a name:\n\nTrip to Rome", "Trip to Rome"],
  ])("it cleans the model's habits from %p", async (answer, name) => {
    writeRules("Lead with an emoji.");
    const { namer: withRules } = namer((request) => FakeEngine.answer(request, answer));
    expect(await withRules.name(turn)).toBe(name);
  });

  test("the rules read back as saved, and a missing file reads as no rules", () => {
    const { namer: rulesNamer } = namer();
    expect(rulesNamer.rules()).toBe("");
    // No rules to save: a vault without the file keeps having none, so the autosave has nothing to commit.
    rulesNamer.saveRules("  ");
    expect(existsSync(chatNameRulesPath(vault))).toBe(false);
    rulesNamer.saveRules("  Lead with an emoji.\r\n");
    expect(rulesNamer.rules()).toBe("Lead with an emoji.");
    rulesNamer.saveRules("");
    expect(rulesNamer.rules()).toBe("");
  });

  test("a failed call or an empty answer keeps the first line, and a failure is logged", async () => {
    writeRules("Lead with an emoji.");
    const { namer: failing } = namer(() => [{ kind: "turn_failed", reason: "Not logged in" }]);
    expect(await failing.name(turn)).toBeNull();
    expect(logs).toEqual([{ level: "warn", message: "A chat name failed: Not logged in" }]);
    const { namer: blank } = namer((request) => FakeEngine.answer(request, ' "" '));
    expect(await blank.name(turn)).toBeNull();
  });
});

describe("the chat name rules in the settings folder (#662)", () => {
  const oldFile = (): string => join(vault, ".eva", "chat-names.md");

  test("the rules live in .eva/settings/", () => {
    expect(chatNameRulesPath(vault)).toBe(join(vault, ".eva", "settings", "chat-names.md"));
  });

  test("before the hub moves the files, the namer reads the old file, which an older Eva still writes", () => {
    mkdirSync(join(vault, ".eva", "settings"), { recursive: true });
    writeFileSync(oldFile(), "Old rules.\n");
    writeFileSync(chatNameRulesPath(vault), "New rules.\n");
    expect(namer().namer.rules()).toBe("Old rules.");
    writeFileSync(
      join(vault, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2026-10-30-settings-folder", at: "", version: "1.40.0" }] }),
    );
    expect(namer().namer.rules()).toBe("New rules.");
  });

  test("a save writes both places, so an older satellite reads the new rules", () => {
    const { namer: rulesNamer } = namer();
    rulesNamer.saveRules("Lead with an emoji.");
    expect(readFileSync(chatNameRulesPath(vault), "utf-8")).toBe("Lead with an emoji.\n");
    expect(readFileSync(oldFile(), "utf-8")).toBe("Lead with an emoji.\n");
  });

  test("an empty save clears the rules in a vault that has only the old file", () => {
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(oldFile(), "Old rules.\n");
    const { namer: rulesNamer } = namer();
    rulesNamer.saveRules("");
    expect(rulesNamer.rules()).toBe("");
  });
});
