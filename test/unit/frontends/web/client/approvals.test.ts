import { describe, expect, test } from "bun:test";
import {
  approvalPlace,
  approvalTitle,
  approvalsOutside,
  rootChatId,
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

describe("rootChatId", () => {
  test("follows the parents to the chat that starts the tree", () => {
    expect(rootChatId("fork-of-fork", sessions)).toBe("chat");
    expect(rootChatId("chat", sessions)).toBe("chat");
  });

  test("keeps the id of a session that is not in the list", () => {
    expect(rootChatId("unknown", sessions)).toBe("unknown");
  });

  test("stops at a loop of parents", () => {
    const loop = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(["a", "b"]).toContain(rootChatId("a", loop));
  });
});

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

  test("names an unknown chat in plain words", () => {
    expect(approvalPlace(undefined)).toBe("A chat");
  });
});
