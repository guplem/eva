import { describe, expect, test } from "bun:test";
import { approvalPlace, approvalTitle, approvalsOutside } from "../../../../../src/frontends/web/client/approvals.ts";
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
