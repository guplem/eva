import { describe, expect, test } from "bun:test";
import {
  approvalNoticeWords,
  approvalPlace,
  approvalTitle,
  approvalsOutside,
  pendingOf,
  pickOption,
  questionAnswers,
} from "../../../../../src/frontends/web/client/approvals.ts";
import type { PendingApproval } from "../../../../../src/frontends/web/client/api.ts";

function approval(sessionId: string, toolName = "Bash"): PendingApproval {
  return { requestId: `request-${sessionId}`, sessionId, toolName, summary: "git push" };
}

const sessions = [
  { id: "chat", parentId: null, mode: "assistant" as const, title: "Plan the week", clone: null },
  { id: "fork", parentId: "chat", mode: "assistant" as const, title: "Plan the week", clone: null },
  { id: "fork-of-fork", parentId: "fork", mode: "assistant" as const, title: "Plan the week", clone: null },
  { id: "work", parentId: null, mode: "project" as const, title: "Ship the login", clone: "example-app-1" },
];

describe("approvalsOutside", () => {
  test("keeps only the approvals of the sessions that are not on screen, in order", () => {
    const pending = [approval("work"), approval("fork"), approval("chat")];
    expect(approvalsOutside(pending, ["chat", "fork"])).toEqual([approval("work")]);
    expect(approvalsOutside(pending, [])).toEqual(pending);
  });
});

describe("approvalTitle", () => {
  test("names a shell command as a command, and any other tool by its name", () => {
    expect(approvalTitle("Bash")).toBe("Eva wants to run a command");
    expect(approvalTitle("bash")).toBe("Eva wants to run a command");
    expect(approvalTitle("mcp__google__send_email")).toBe("Eva wants to use mcp__google__send_email");
  });

  test("keeps a question of Eva herself, such as the trust of a repository, as it is", () => {
    expect(approvalTitle("Trust this repository")).toBe("Trust this repository");
  });
});

describe("approvalPlace", () => {
  test("names the clone of a project chat and the title of an assistant chat", () => {
    expect(approvalPlace(sessions[3])).toBe("clone example-app-1");
    expect(approvalPlace(sessions[1])).toBe("Plan the week");
  });

  test("names a chat that is not in the list in words that fit in a sentence", () => {
    expect(approvalPlace(undefined)).toBe("another chat");
  });
});

describe("the model's questions", () => {
  const single = {
    question: "Which format?",
    header: "Format",
    options: [
      { label: "Talk", description: "" },
      { label: "Form", description: "" },
    ],
    multiSelect: false,
  };
  const multi = { ...single, question: "Which tools?", multiSelect: true };

  test("a question card has its own title, and the notice says that Eva asks", () => {
    expect(approvalTitle("AskUserQuestion", [single])).toBe("Eva has a question");
    expect(approvalTitle("AskUserQuestion", [single, multi])).toBe("Eva has 2 questions");
    expect(approvalNoticeWords([single])).toBe("Eva has a question in");
    expect(approvalNoticeWords(undefined)).toBe("Eva needs your permission in");
  });

  test("a single choice replaces the last one; a multiple choice toggles", () => {
    expect(pickOption([0], 1, false)).toEqual([1]);
    expect(pickOption([0], 1, true)).toEqual([0, 1]);
    expect(pickOption([0, 1], 0, true)).toEqual([1]);
  });

  test("the answers are ready only when each question has a choice or own text", () => {
    const drafts = [
      { selected: [1], other: "" },
      { selected: [], other: "" },
    ];
    expect(questionAnswers([single, multi], drafts)).toBeNull();
    expect(questionAnswers([single, multi], [drafts[0]!, { selected: [], other: " both " }])).toEqual([
      { selected: [1] },
      { selected: [], other: "both" },
    ]);
    expect(questionAnswers([single], [{ selected: [0], other: "" }])).toEqual([{ selected: [0] }]);
  });
});

describe("pendingOf", () => {
  test("keeps the questions of the event, so the card shows the form and not the raw input", () => {
    const event = {
      kind: "approval_needed" as const,
      requestId: "r",
      sessionId: "s",
      seq: 1,
      at: "2026-10-24T10:00:00Z",
      toolName: "AskUserQuestion",
      summary: "Which?",
      questions: [{ question: "Which?", header: "", options: [{ label: "A", description: "" }], multiSelect: false }],
    };
    expect(pendingOf(event)).toEqual({
      requestId: "r",
      sessionId: "s",
      toolName: "AskUserQuestion",
      summary: "Which?",
      questions: event.questions,
    });
    const { questions: _questions, ...plain } = event;
    expect(pendingOf(plain)).toEqual({
      requestId: "r",
      sessionId: "s",
      toolName: "AskUserQuestion",
      summary: "Which?",
    });
  });
});
