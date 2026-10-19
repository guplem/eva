import { describe, expect, test } from "bun:test";
import {
  chatGroup,
  chatPreview,
  chatState,
  chatTime,
  groupChats,
  matchesSearch,
} from "../../../../../src/frontends/web/client/chat-list.ts";
import type { SessionRecord } from "../../../../../src/core/sessions/session-store.ts";

type Turn = SessionRecord["turns"][number];

// Local times, so the tests pass in each time zone.
const now = new Date(2026, 9, 19, 18, 30);

function turn(fields: Partial<Turn>): Turn {
  return {
    userText: "What is on today?",
    answerText: "",
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [],
    omittedSteps: 0,
    contextTokens: null,
    failure: null,
    lastMessageId: null,
    at: now.toISOString(),
    ...fields,
  };
}

describe("chatGroup", () => {
  test("splits the chats into today, the 6 days before, and older", () => {
    expect(chatGroup(new Date(2026, 9, 19, 0, 5), now)).toBe("Today");
    expect(chatGroup(new Date(2026, 9, 18, 23, 59), now)).toBe("This week");
    expect(chatGroup(new Date(2026, 9, 13, 9, 0), now)).toBe("This week");
    expect(chatGroup(new Date(2026, 9, 12, 9, 0), now)).toBe("Older");
  });

  test("a time a little in the future counts as today", () => {
    expect(chatGroup(new Date(2026, 9, 20, 0, 1), now)).toBe("Today");
  });
});

describe("chatTime", () => {
  test("shows the hour today, the weekday this week, and the date before", () => {
    expect(chatTime(new Date(2026, 9, 19, 9, 4), now)).toBe("09:04");
    expect(chatTime(new Date(2026, 9, 18, 9, 4), now)).toBe("Sun");
    expect(chatTime(new Date(2026, 9, 2, 9, 4), now)).toBe("2 Oct");
    expect(chatTime(new Date(2025, 11, 31, 9, 4), now)).toBe("31 Dec 2025");
  });
});

describe("chatPreview", () => {
  test("shows one line of the last answer, with no Markdown marks", () => {
    const chat = {
      turns: [turn({ answerText: "old" }), turn({ answerText: "## Plan\n\n**Four** things\nthis week" })],
    };
    expect(chatPreview(chat)).toBe("Plan Four things this week");
  });

  test("shows why the turn failed, or the person's message while no answer exists", () => {
    expect(chatPreview({ turns: [turn({ failure: "The engine stopped." })] })).toBe("The engine stopped.");
    expect(chatPreview({ turns: [turn({ answerText: "  " })] })).toBe("What is on today?");
  });

  test("says that a new chat has no message, and cuts a long text", () => {
    expect(chatPreview({ turns: [] })).toBe("No messages yet");
    const preview = chatPreview({ turns: [turn({ answerText: "word ".repeat(100) })] });
    expect(preview).toHaveLength(140);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("chatState", () => {
  const running = (id: string): boolean => id === "fork";

  test("a waiting approval in the chat or a fork needs the person, also while the turn runs", () => {
    expect(chatState(["root", "fork"], running, ["fork"])).toBe("needs-you");
  });

  test("a running turn in the chat or a fork shows that Eva works", () => {
    expect(chatState(["root", "fork"], running, ["other"])).toBe("working");
  });

  test("a quiet chat has no state", () => {
    expect(chatState(["root"], running, ["other"])).toBeNull();
  });
});

describe("matchesSearch", () => {
  test("ignores case and the spaces around the query", () => {
    expect(matchesSearch("Plan for the week", "  WEEK ")).toBe(true);
    expect(matchesSearch("Plan for the week", "walk")).toBe(false);
    expect(matchesSearch("Plan for the week", "")).toBe(true);
  });
});

describe("groupChats", () => {
  test("keeps the list order and leaves out an empty group", () => {
    const chats = [new Date(2026, 9, 19, 9, 0), new Date(2026, 9, 19, 8, 0), new Date(2026, 8, 1, 9, 0)];
    expect(groupChats(chats, (at) => at, now).map(({ group, chats: inGroup }) => [group, inGroup.length])).toEqual([
      ["Today", 2],
      ["Older", 1],
    ]);
  });
});

describe("chatPreview with a state", () => {
  test("a waiting approval says so, because the last answer is out of date", () => {
    expect(chatPreview({ turns: [turn({ answerText: "Done." })] }, "needs-you")).toBe("Eva needs your permission");
  });

  test("a first turn that runs says that Eva works, not that the chat is empty", () => {
    expect(chatPreview({ turns: [] }, "working")).toBe("Eva is working on it");
    expect(chatPreview({ turns: [turn({ answerText: "Done." })] }, "working")).toBe("Done.");
  });
});

describe("chatPreview edge cases", () => {
  test("keeps a mark inside the text, such as an issue number or an arrow", () => {
    expect(chatPreview({ turns: [turn({ answerText: "Closed #169 in C#: a -> b, 2*3" })] })).toBe(
      "Closed #169 in C#: a -> b, 2*3",
    );
    expect(chatPreview({ turns: [turn({ answerText: "> Quote\n- **Bold** and `code`" })] })).toBe(
      "Quote Bold and code",
    );
  });

  test("an answer of marks only, or an empty failure, falls back to the person's message", () => {
    expect(chatPreview({ turns: [turn({ answerText: "**\n```" })] })).toBe("What is on today?");
    expect(chatPreview({ turns: [turn({ failure: "" })] })).toBe("What is on today?");
  });

  test("cuts a long text between characters, never inside an emoji", () => {
    const preview = chatPreview({ turns: [turn({ answerText: "🙂".repeat(200) })] });
    expect(Array.from(preview)).toHaveLength(141);
    expect(preview.endsWith("🙂…")).toBe(true);
  });
});

describe("a bad date", () => {
  test("shows no time and goes to the older chats", () => {
    expect(chatTime(new Date("bad"), now)).toBe("");
    expect(chatGroup(new Date("bad"), now)).toBe("Older");
  });
});
