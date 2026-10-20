import { describe, expect, test } from "bun:test";
import { coversScopes, googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { workspaceMcpVersion } from "../../../../src/core/google/google-mcp.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";

const base = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];
const readOnly = defaultConfig.google.access;
const everything = { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "full" } as const;

describe("googleScopes", () => {
  test("asks for the scopes of workspace-mcp 2.1.0: change both together", () => {
    expect(workspaceMcpVersion).toBe("2.1.0");
    expect(googleScopes({ services: ["calendar", "drive", "contacts", "tasks"], access: readOnly })).toEqual([
      ...base,
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ]);
  });

  test("each level holds the scopes of the levels below it", () => {
    expect(googleScopes({ services: ["calendar", "gmail"], access: everything })).toEqual([
      ...base,
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.settings.basic",
    ]);
  });

  test("each service takes its own level", () => {
    const access = { ...readOnly, contacts: "full", tasks: "manage", gmail: "drafts" } as const;
    expect(googleScopes({ services: ["calendar", "contacts", "tasks", "gmail"], access })).toEqual([
      ...base,
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts",
      "https://www.googleapis.com/auth/tasks.readonly",
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
  });

  test("a service that is off asks for nothing, whatever its level", () => {
    expect(googleScopes({ services: [], access: everything })).toEqual(base);
  });
});

describe("coversScopes", () => {
  test("a broad scope covers its read-only scope, as in workspace-mcp", () => {
    const granted = [...base, "https://www.googleapis.com/auth/calendar"];
    expect(coversScopes(granted, googleScopes({ services: ["calendar"], access: readOnly }))).toBe(true);
  });

  test("a read-only login does not cover a higher level", () => {
    const granted = googleScopes({ services: ["calendar"], access: readOnly });
    expect(coversScopes(granted, googleScopes({ services: ["calendar"], access: everything }))).toBe(false);
  });
});
