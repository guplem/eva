import { describe, expect, test } from "bun:test";
import { PiEngine } from "../../../../src/engines/pi/pi-adapter.ts";
import { describePiPermissions } from "../../../../src/engines/pi/pi-permissions.ts";
import { outwardActionWords } from "../../../../src/shared/outward-actions.ts";

describe("describePiPermissions", () => {
  test("an Assistant chat asks before each action that reaches other people, and a project chat asks nothing", () => {
    const permissions = describePiPermissions();
    expect(permissions.mode).toBeNull();
    expect(permissions.personRules).toBeNull();
    const [assistant, trusted, untrusted] = permissions.chats;
    expect(assistant?.chat).toBe("assistant");
    expect(assistant?.asks).toEqual(outwardActionWords);
    expect(trusted?.chat).toBe("trusted-project");
    expect(trusted?.asks).toEqual([]);
    expect(untrusted?.chat).toBe("untrusted-project");
    expect(untrusted?.asks).toEqual([]);
    expect(trusted?.note).toContain("Eva answers no");
    expect(untrusted?.note).toContain("your own");
  });

  test("the engine gives the same words", () => {
    const engine = new PiEngine({
      command: ["pi"],
      workFolder: "/eva-pi",
      models: { default: null, opus: null, sonnet: null, haiku: null },
    });
    expect(engine.describePermissions()).toEqual(describePiPermissions());
  });
});
