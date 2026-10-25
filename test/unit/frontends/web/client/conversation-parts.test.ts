import { describe, expect, test } from "bun:test";
import {
  answeredModel,
  engineLock,
  composerPlaceholder,
  effortLabel,
  elapsedText,
  engineLabel,
  foldSteps,
  followsBottom,
  inputFields,
  liveFace,
  missingDetail,
  stepState,
  modelLabel,
  modelNote,
  keptPending,
  restoredText,
  runningUntil,
  isWorking,
  sendsOnEnter,
  sentTurnCount,
  undoQuestion,
  stepIcon,
  snapsToBottom,
  stepOrigin,
  stepParts,
  turnEndNotice,
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
  test("names the engines and the model tiers as people say them (#550)", () => {
    expect(engineLabel("claude-code")).toBe("Claude Code");
    expect(engineLabel("pi")).toBe("pi");
    expect(modelLabel("opus")).toBe("Smart");
    expect(modelLabel("sonnet")).toBe("Balanced");
    expect(modelLabel("haiku")).toBe("Fast");
  });

  test("names the model that answered beside its tier (#419, #550)", () => {
    expect(modelLabel("opus", "claude-opus-5-5")).toBe("Smart · Opus 5.5");
    expect(modelLabel("haiku", "claude-haiku-4-5-20251001")).toBe("Fast · Haiku 4.5");
    expect(modelLabel("sonnet", "claude-sonnet-4-6[1m]")).toBe("Balanced · Sonnet 4.6");
    // A date is no minor version.
    expect(modelLabel("opus", "claude-opus-4-20250514")).toBe("Smart · Opus 4");
    expect(modelLabel("opus", "claude-opus-4-1-20250805")).toBe("Smart · Opus 4.1");
    // A pi model keeps its own id.
    expect(modelLabel("opus", "fake-model")).toBe("Smart · fake-model");
    expect(modelLabel("opus", null)).toBe("Smart");
  });

  test("names each effort level in plain words (#419)", () => {
    expect(effortLabel("medium")).toBe("Medium effort");
    expect(effortLabel("xhigh")).toBe("Extra high effort");
    expect(effortLabel("max")).toBe("Max effort");
  });

  test("takes the model of the newest turn that names one", () => {
    expect(answeredModel([{ model: "claude-opus-5-5" }, { model: null }], "opus")).toBe("claude-opus-5-5");
    expect(answeredModel([{ model: "claude-opus-4-6" }, { model: "claude-opus-5-5" }], "opus")).toBe("claude-opus-5-5");
    expect(answeredModel([], "opus")).toBeNull();
  });

  test("names no answered model after a change of model, until a turn answers with the new one (#545)", () => {
    const turns = [{ model: "claude-haiku-5-5", modelAlias: "haiku" as const }];
    expect(answeredModel(turns, "haiku")).toBe("claude-haiku-5-5");
    expect(answeredModel(turns, "opus")).toBeNull();
    expect(answeredModel(turns, "sonnet")).toBeNull();
    // A turn from before the stored model choice ran with the only model the chat ever had.
    expect(answeredModel([{ model: "claude-opus-5-5" }], "opus")).toBe("claude-opus-5-5");
  });
});

describe("engineLock", () => {
  test("lets a new chat pick, and says why a fork or a started chat cannot", () => {
    expect(engineLock({ parentId: null, turns: [] }, false)).toBeNull();
    expect(engineLock({ parentId: null, turns: [] }, true)).toContain("first message");
    expect(engineLock({ parentId: null, turns: [{}] }, false)).toContain("first message");
    expect(engineLock({ parentId: "chat-1", turns: [] }, false)).toContain("fork");
  });
});

describe("modelNote", () => {
  test("warns about the cost only when the chat has a history, and waits for a running turn (#545)", () => {
    expect(modelNote({ parentId: null, turns: [] }, false)).toBeNull();
    expect(modelNote({ parentId: null, turns: [{}] }, false)).toContain("costs more");
    expect(modelNote({ parentId: "chat-1", turns: [] }, false)).toContain("costs more");
    expect(modelNote({ parentId: null, turns: [{}] }, true)).toContain("answer ends");
    expect(modelNote({ parentId: null, turns: [] }, true)).toContain("answer ends");
  });
});

describe("keptPending", () => {
  const texts = (pending: readonly { text: string }[]): string[] => pending.map((message) => message.text);

  test("keeps the sent text while the stored turns are the ones from before the send", () => {
    expect(texts(keptPending([{ text: "Hello", turnCount: 2 }], 2))).toEqual(["Hello"]);
  });

  test("drops the sent text once its stored turn arrives, before any effect clears it", () => {
    expect(keptPending([{ text: "Hello", turnCount: 2 }], 3)).toEqual([]);
  });

  test("keeps a message sent during a turn when that turn is stored, and drops it with its own turn", () => {
    const running = [
      { text: "First", turnCount: 2 },
      { text: "Queued", turnCount: sentTurnCount(2, true) },
    ];
    expect(texts(keptPending(running, 2))).toEqual(["First", "Queued"]);
    expect(texts(keptPending(running, 3))).toEqual(["Queued"]);
    expect(keptPending(running, 4)).toEqual([]);
  });
});

describe("runningUntil", () => {
  test("a turn that starts runs until one more turn is stored", () => {
    expect(runningUntil(null, false, true, 2)).toBe(3);
  });

  test("stays running after the live steps end, until the stored turn arrives", () => {
    // The live steps go away at the turn end, a moment before the list brings the stored turn.
    expect(runningUntil(3, true, false, 2)).toBe(3);
    expect(runningUntil(3, false, false, 3)).toBeNull();
  });

  test("a turn that starts before the stored turn of the one before arrives waits for both", () => {
    expect(runningUntil(3, false, true, 2)).toBe(4);
    expect(runningUntil(4, true, true, 3)).toBe(4);
  });

  test("a stored turn that arrives before the live steps end leaves nothing running after them", () => {
    // The list can read the record after the save and before the turn's end event.
    const stored = runningUntil(3, true, true, 3);
    expect(stored).toBeNull();
    expect(runningUntil(stored, true, false, 3)).toBeNull();
  });

  test("nothing runs while no turn started", () => {
    expect(runningUntil(null, false, false, 2)).toBeNull();
  });

  test("a message sent in the end gap waits for the turn after the ended one", () => {
    expect(sentTurnCount(2, runningUntil(3, true, false, 2) !== null)).toBe(3);
  });
});

describe("turnEndNotice", () => {
  test("says once that the turn ended, also for a turn that failed before its first step", () => {
    expect(turnEndNotice(true, false, "")).toBe("The turn ended.");
  });

  test("a new turn clears the words, so the next end is a change that the reader says", () => {
    expect(turnEndNotice(false, true, "The turn ended.")).toBe("");
  });

  test("keeps the words while nothing changes", () => {
    expect(turnEndNotice(false, false, "The turn ended.")).toBe("The turn ended.");
    expect(turnEndNotice(true, true, "")).toBe("");
  });
});

describe("isWorking", () => {
  const sent = (turnCount: number): { text: string; turnCount: number } => ({ text: "Hi", turnCount });

  test("a send with no running turn shows the working card at once", () => {
    expect(isWorking({ live: false, turnRuns: false, pending: [sent(2)], turnCount: 2 })).toBe(true);
  });

  test("a running turn shows the card", () => {
    expect(isWorking({ live: true, turnRuns: true, pending: [], turnCount: 2 })).toBe(true);
  });

  test("a queued message keeps the card off until the turn before it is stored, so its clock starts fresh", () => {
    // The live steps of the turn before ended, and its stored turn has not come yet.
    expect(isWorking({ live: false, turnRuns: true, pending: [sent(3)], turnCount: 2 })).toBe(false);
  });

  test("a queued message shows the card once the turn before it is stored, while Eva saves the vault", () => {
    expect(isWorking({ live: false, turnRuns: false, pending: [sent(3)], turnCount: 3 })).toBe(true);
  });

  test("no card when nothing runs and nothing waits", () => {
    expect(isWorking({ live: false, turnRuns: false, pending: [], turnCount: 3 })).toBe(false);
  });
});

describe("sentTurnCount", () => {
  test("waits for the next stored turn when no turn runs, since Eva gathers such messages into it", () => {
    expect(sentTurnCount(2, false)).toBe(2);
  });

  test("waits for one more stored turn while a turn runs, since the running turn is stored first", () => {
    expect(sentTurnCount(2, true)).toBe(3);
  });
});

describe("followsBottom", () => {
  const place = (top: number): { top: number; height: number; visible: number } => ({
    top,
    height: 2_000,
    visible: 500,
  });

  const before = (top: number, height = 2_000): { top: number; height: number } => ({ top, height });

  test("stops following as soon as the person scrolls up, even near the bottom", () => {
    expect(followsBottom(true, before(1_500), place(1_490))).toBe(false);
  });

  test("follows again once the person scrolls back near the bottom", () => {
    expect(followsBottom(false, before(1_300), place(1_450))).toBe(true);
  });

  test("does not follow while the person scrolls down far from the bottom", () => {
    expect(followsBottom(false, before(500), place(800))).toBe(false);
  });

  test("follows when shorter content pulls the view up to the very bottom", () => {
    expect(followsBottom(true, before(1_800, 2_300), place(1_500))).toBe(true);
  });

  test("keeps the follow when a change of the content, not the person, moves the view up", () => {
    // Another chat opens, or the browser keeps a line in place while the content above it changes.
    const changed = { top: 600, height: 3_000, visible: 500 };
    expect(followsBottom(true, before(1_500), changed)).toBe(true);
    expect(followsBottom(false, before(1_500), changed)).toBe(false);
  });
});

describe("snapsToBottom", () => {
  test("a view that follows snaps to the newest message", () => {
    expect(snapsToBottom(true, false)).toBe(true);
  });

  test("a finger on the chat pauses the snap, so a render cannot pull back its drag", () => {
    expect(snapsToBottom(true, true)).toBe(false);
  });

  test("a view that does not follow never snaps", () => {
    expect(snapsToBottom(false, false)).toBe(false);
  });
});

describe("sendsOnEnter", () => {
  const key = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };

  test("sends on Enter with a keyboard", () => {
    expect(sendsOnEnter(key, false)).toBe(true);
  });

  test("keeps Shift+Enter and any Enter on a touch screen for a new line", () => {
    expect(sendsOnEnter({ ...key, shiftKey: true }, false)).toBe(false);
    expect(sendsOnEnter(key, true)).toBe(false);
  });

  test("leaves an Enter that ends an IME composition to the input method", () => {
    expect(sendsOnEnter({ ...key, isComposing: true }, false)).toBe(false);
    // Safari ends the composition before its keydown, and marks that key with the code 229.
    expect(sendsOnEnter({ ...key, keyCode: 229 }, false)).toBe(false);
  });
});

describe("restoredText", () => {
  test("puts the failed message back in an empty box", () => {
    expect(restoredText("Hello", "")).toBe("Hello");
    expect(restoredText("Hello", "  \n")).toBe("Hello");
  });

  test("keeps the text typed during the send after the failed message", () => {
    expect(restoredText("Hello", "And more")).toBe("Hello\n\nAnd more");
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

  test("project work only started: its Project chat may still run, so its step never says Done (#571)", () => {
    const work: TurnStep = { kind: "task", text: "example-app: Fix it", isError: false, id: "p1", chatId: "p1" };
    expect(stepState(work, false)).toBe("Started");
    expect(stepState(work, true)).toBe("Started");
  });

  test("a missing part says why it is missing", () => {
    expect(missingDetail("output", true)).toBe("The tool still runs.");
    expect(missingDetail("output", false)).toBe("Eva kept no output for this step.");
    expect(missingDetail("input", true)).toBe("Eva kept no input for this step.");
  });
});

describe("undoQuestion", () => {
  const none = { restore: [], changed: [], notKept: [], answers: 1 };

  test("asks only when a file can go back, and names the later answers", () => {
    expect(undoQuestion(none)).toBeNull();
    expect(undoQuestion({ ...none, notKept: ["Scratch/a.pdf"], changed: ["Plan.md"] })).toBeNull();
    expect(undoQuestion({ ...none, restore: ["Plan.md"] })).toBe("Undo the changes of this answer?");
    expect(undoQuestion({ ...none, restore: ["Plan.md"], answers: 3 })).toBe(
      "Undo the changes of this answer and the later ones?",
    );
  });
});
