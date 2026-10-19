import { describe, expect, test } from "bun:test";
import {
  chipLock,
  elapsedText,
  engineLabel,
  foldSteps,
  liveFace,
  modelLabel,
  stepIcon,
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
});

describe("chipLock", () => {
  test("lets a new chat pick, and says why a fork or a started chat cannot", () => {
    expect(chipLock({ parentId: null, turns: [] }, false)).toBeNull();
    expect(chipLock({ parentId: null, turns: [] }, true)).toContain("first message");
    expect(chipLock({ parentId: null, turns: [{}] }, false)).toContain("first message");
    expect(chipLock({ parentId: "chat-1", turns: [] }, false)).toContain("fork");
  });
});
