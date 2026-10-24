import { describe, expect, test } from "bun:test";
import {
  answeredModel,
  chipLock,
  composerPlaceholder,
  effortLabel,
  elapsedText,
  engineLabel,
  foldSteps,
  inputFields,
  liveFace,
  missingDetail,
  stepState,
  modelLabel,
  shownPending,
  stepIcon,
  stepOrigin,
  stepParts,
} from "../../../../../src/frontends/web/client/conversation-parts.ts";
import type { TurnStep } from "../../../../../src/shared/turn-steps.ts";

function step(kind: TurnStep["kind"], text: string, isError = false): TurnStep {
  return { kind, text, isError, id: null };
}

describe("foldSteps", () => {
  test("lists every step but the last message, in order, and keeps the last message for the bubble", () => {
    const steps = [step("message", "first"), step("tool", "Read a.md"), step("message", "last"), step("command", "ls")];
    const { listed, lastMessage } = foldSteps(steps);
    expect(listed.map((each) => each.text)).toEqual(["first", "Read a.md", "ls"]);
    expect(lastMessage?.text).toBe("last");
  });

  test("lists every step when the turn has no message yet", () => {
    const { listed, lastMessage } = foldSteps([step("task", "Search")]);
    expect(listed).toHaveLength(1);
    expect(lastMessage).toBeUndefined();
  });
});

describe("stepIcon", () => {
  test("gives each kind its own icon, and a failed step the cross", () => {
    expect(stepIcon(step("message", "a"))).toBe("chat");
    expect(stepIcon(step("command", "ls"))).toBe("term");
    expect(stepIcon(step("tool", "Read"))).toBe("bolt");
    expect(stepIcon(step("task", "Search"))).toBe("sync");
    expect(stepIcon(step("command", "ls", true))).toBe("x");
  });
});

describe("stepParts", () => {
  test("splits a tool step into the tool as the action and its target as the detail", () => {
    expect(stepParts(step("tool", "Read /demo-vault/Life/Notes.md"))).toEqual({
      action: "Read",
      detail: "/demo-vault/Life/Notes.md",
    });
    expect(stepParts(step("tool", "Skill eva:about-me"))).toEqual({ action: "Skill", detail: "eva:about-me" });
  });

  test("shows only the tool part of an MCP name", () => {
    expect(stepParts(step("tool", 'mcp__demo__list_notes {"limit":5}'))).toEqual({
      action: "list_notes",
      detail: '{"limit":5}',
    });
  });

  test("names a stored tool step without a name, a command, a message and a task by their kind", () => {
    expect(stepParts(step("tool", '{"skill":"eva:about-me"}'))).toEqual({
      action: "Tool",
      detail: '{"skill":"eva:about-me"}',
    });
    expect(stepParts(step("tool", "TodoWrite"))).toEqual({ action: "TodoWrite", detail: "" });
    expect(stepParts(step("command", "git status"))).toEqual({ action: "Command", detail: "git status" });
    expect(stepParts(step("message", "Let me look."))).toEqual({ action: "Message", detail: "Let me look." });
    expect(stepParts(step("task", "Search the notes"))).toEqual({ action: "Task", detail: "Search the notes" });
  });
});

describe("stepOrigin", () => {
  test("names an MCP tool and its server", () => {
    expect(stepOrigin(step("tool", 'mcp__demo__list_notes {"limit":5}'))).toEqual({
      tool: "mcp__demo__list_notes",
      from: "The MCP server demo",
    });
  });

  test("names a tool of the engine, and a command of the shell", () => {
    expect(stepOrigin(step("tool", "Read /demo-vault/Life/Notes.md"))).toEqual({
      tool: "Read",
      from: "The engine",
    });
    expect(stepOrigin(step("command", "ls"))).toEqual({ tool: null, from: "The shell" });
  });

  test("names nothing for a stored tool step without a name, a message and a task", () => {
    expect(stepOrigin(step("tool", '{"skill":"eva:about-me"}'))).toBeNull();
    expect(stepOrigin(step("message", "Hi"))).toBeNull();
    expect(stepOrigin(step("task", "Search"))).toBeNull();
  });
});

describe("inputFields", () => {
  test("splits a JSON object into its description and its other fields", () => {
    const input = JSON.stringify({ command: "ls\npwd", description: "List the files", limit: 5, flags: ["-a"] });
    expect(inputFields(input)).toEqual({
      description: "List the files",
      fields: [
        { key: "command", value: "ls\npwd" },
        { key: "limit", value: "5" },
        { key: "flags", value: '[\n  "-a"\n]' },
      ],
    });
  });

  test("gives no fields for an input that is no JSON object", () => {
    expect(inputFields(undefined)).toBeNull();
    expect(inputFields("not json")).toBeNull();
    expect(inputFields("[1, 2]")).toBeNull();
    expect(inputFields('"text"')).toBeNull();
  });

  test("keeps a description that is no text as a field", () => {
    expect(inputFields('{"description": 3}')).toEqual({
      description: null,
      fields: [{ key: "description", value: "3" }],
    });
  });
});

describe("elapsedText", () => {
  test("says seconds, then minutes and seconds", () => {
    expect(elapsedText(0)).toBe("0 s");
    expect(elapsedText(8_400)).toBe("8 s");
    expect(elapsedText(60_000)).toBe("1 min");
    expect(elapsedText(125_000)).toBe("2 min 5 s");
  });
});

describe("liveFace", () => {
  test("thinks before the first text, then focuses in project mode", () => {
    expect(liveFace(false, "assistant")).toBe("thinking");
    expect(liveFace(false, "project")).toBe("thinking");
    expect(liveFace(true, "project")).toBe("focused");
    expect(liveFace(true, "assistant")).toBe("neutral");
  });
});

describe("labels", () => {
  test("names the engines and models as people say them", () => {
    expect(engineLabel("claude-code")).toBe("Claude Code");
    expect(engineLabel("pi")).toBe("pi");
    expect(modelLabel("default")).toBe("Default model");
    expect(modelLabel("sonnet")).toBe("Sonnet");
  });

  test("names the model that answered, so the default model is no mystery (#419)", () => {
    expect(modelLabel("default", "claude-opus-5-5")).toBe("Default · Opus 5.5");
    expect(modelLabel("haiku", "claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("sonnet", "claude-sonnet-4-6[1m]")).toBe("Sonnet 4.6");
    // A date is no minor version.
    expect(modelLabel("default", "claude-opus-4-20250514")).toBe("Default · Opus 4");
    expect(modelLabel("opus", "claude-opus-4-1-20250805")).toBe("Opus 4.1");
    // A pi model keeps its own id.
    expect(modelLabel("default", "fake-model")).toBe("Default · fake-model");
    expect(modelLabel("opus", null)).toBe("Opus");
  });

  test("names each effort level in plain words (#419)", () => {
    expect(effortLabel("default")).toBe("Default effort");
    expect(effortLabel("xhigh")).toBe("Extra high effort");
    expect(effortLabel("max")).toBe("Max effort");
  });

  test("takes the model of the newest turn that names one", () => {
    expect(answeredModel([{ model: "claude-opus-5-5" }, { model: null }])).toBe("claude-opus-5-5");
    expect(answeredModel([{ model: "claude-opus-4-6" }, { model: "claude-opus-5-5" }])).toBe("claude-opus-5-5");
    expect(answeredModel([])).toBeNull();
  });
});

describe("chipLock", () => {
  test("lets a new chat pick, and says why a fork or a started chat cannot", () => {
    expect(chipLock({ parentId: null, turns: [] }, false)).toBeNull();
    expect(chipLock({ parentId: null, turns: [] }, true)).toContain("first message");
    expect(chipLock({ parentId: null, turns: [{}] }, false)).toContain("first message");
    expect(chipLock({ parentId: "chat-1", turns: [] }, false)).toContain("fork");
  });
});

describe("shownPending", () => {
  test("shows the sent text while the stored turns are the ones from before the send", () => {
    expect(shownPending({ text: "Hello", turnCount: 2 }, 2)).toBe("Hello");
  });

  test("hides the sent text once its stored turn arrives, before any effect clears it", () => {
    expect(shownPending({ text: "Hello", turnCount: 2 }, 3)).toBeNull();
  });

  test("shows nothing when nothing waits", () => {
    expect(shownPending(null, 0)).toBeNull();
  });
});

describe("composerPlaceholder", () => {
  test("addresses Eva in an Assistant chat", () => {
    expect(composerPlaceholder(null)).toBe("Message Eva");
  });

  test("addresses the project in a project chat, because there the harness answers, not the assistant", () => {
    expect(composerPlaceholder("Example App")).toBe("Message Example App");
  });
});

describe("step dialog", () => {
  const tool: TurnStep = { kind: "tool", text: "Read x", isError: false, id: "t1", input: "{}" };

  test("a live tool with no output yet still runs, and a failed step says so in a word", () => {
    expect(stepState(tool, true)).toBe("Running");
    expect(stepState({ ...tool, output: "x" }, true)).toBe("Done");
    expect(stepState(tool, false)).toBe("Done");
    expect(stepState({ ...tool, isError: true }, true)).toBe("Failed");
    expect(stepState({ kind: "message", text: "Hi", isError: false, id: "m1" }, true)).toBe("Done");
  });

  test("a missing part says why it is missing", () => {
    expect(missingDetail("output", true)).toBe("The tool still runs.");
    expect(missingDetail("output", false)).toBe("Eva kept no output for this step.");
    expect(missingDetail("input", true)).toBe("Eva kept no input for this step.");
  });
});
