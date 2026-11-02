import { describe, expect, test } from "bun:test";
import { chatKind, chatKindName } from "../../../src/shared/chat-kind.ts";

describe("chatKind", () => {
  test("a Project chat with no clone is a specialist chat (#703)", () => {
    expect(chatKind({ mode: "assistant", clone: null })).toBe("assistant");
    expect(chatKind({ mode: "project", clone: "clone-0" })).toBe("project");
    expect(chatKind({ mode: "project", clone: null })).toBe("specialist");
  });

  test("each kind has the name that every front end shows", () => {
    expect(chatKindName("assistant")).toBe("Assistant");
    expect(chatKindName("project")).toBe("Project");
    expect(chatKindName("specialist")).toBe("Specialist");
  });

  test("a chat in a project folder is named after the project type, so the label follows a type change (#768)", () => {
    expect(chatKindName("specialist", "specialist")).toBe("Specialist");
    expect(chatKindName("specialist", "general")).toBe("Project");
    expect(chatKindName("project", "software")).toBe("Project");
    expect(chatKindName("assistant", undefined)).toBe("Assistant");
  });
});
