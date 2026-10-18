import { describe, expect, test } from "bun:test";
import { coversScopes, googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { workspaceMcpVersion } from "../../../../src/core/google/google-mcp.ts";

const base = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

describe("googleScopes", () => {
  test("asks for the scopes of workspace-mcp 2.1.0: change both together", () => {
    expect(workspaceMcpVersion).toBe("2.1.0");
    expect(googleScopes({ services: ["calendar", "drive", "contacts", "tasks"], readOnly: true })).toEqual([
      ...base,
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ]);
  });

  test("write access asks for each scope of a service", () => {
    expect(googleScopes({ services: ["calendar", "gmail"], readOnly: false })).toEqual([
      ...base,
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/gmail.settings.basic",
    ]);
  });
});

describe("coversScopes", () => {
  test("a broad scope covers its read-only scope, as in workspace-mcp", () => {
    const granted = [...base, "https://www.googleapis.com/auth/calendar"];
    expect(coversScopes(granted, googleScopes({ services: ["calendar"], readOnly: true }))).toBe(true);
  });

  test("a read-only login does not cover write access", () => {
    const granted = googleScopes({ services: ["calendar"], readOnly: true });
    expect(coversScopes(granted, googleScopes({ services: ["calendar"], readOnly: false }))).toBe(false);
  });
});
