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
});
