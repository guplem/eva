/**
 * Tests for the check that a pull request keeps each stored name, or says that it breaks one (#98).
 * The file has no `src/` twin: it tests `scripts/check-stored-names.ts`, which only the checks run.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  currentNames,
  hasBreakingCommit,
  judgeNames,
  parseSnapshot,
  renderSnapshot,
  schemaNames,
} from "../../scripts/check-stored-names.ts";

describe("schemaNames", () => {
  test("lists each key path, with the values of each enum and literal", () => {
    const schema = z.object({
      version: z.literal(1),
      mode: z.enum(["on", "off"]).default("on"),
      inner: z.object({ name: z.string().nullable() }).default({ name: null }),
      items: z.array(z.object({ id: z.string() })).catch([]),
      token: z.string().optional(),
    });
    expect(schemaNames(schema)).toEqual([
      "version",
      "version=1",
      "mode",
      "mode=on",
      "mode=off",
      "inner",
      "inner.name",
      "items",
      "items[].id",
      "token",
    ]);
  });
});

describe("currentNames", () => {
  const names = currentNames();

  test.each([
    "machine config.json updates.install=minor",
    "machine secrets.json telegramBotToken",
    "machine state/sessions.json sessions[].turns[].userText",
    "machine state/sessions.json sessions[].engine=pi",
    "machine state/devices.json devices[].hash",
    "vault .eva/settings.json updates.install",
    "vault .eva/schedules.json schedules[].at",
    "vault .eva/hub.json machine",
    "typed cli settings set",
    "typed cli --check",
    "typed telegram /new",
    "migration vault 2026-10-18-drop-security-settings-from-vault",
  ])("has %s", (name) => {
    expect(names).toContain(name);
  });

  test("keeps the machine's settings out of the vault file", () => {
    expect(names).not.toContain("vault .eva/settings.json port");
    expect(names).toContain("machine config.json port");
  });

  test("is sorted, with no line twice", () => {
    expect(names).toEqual([...new Set(names)].sort());
  });
});

describe("the snapshot", () => {
  test("reads back what it writes, and skips the comments", () => {
    const names = ["machine config.json port", "typed telegram /new"];
    expect(parseSnapshot(renderSnapshot(names))).toEqual(names);
  });

  test("reads a file with Windows line ends", () => {
    expect(parseSnapshot("# A comment\r\nmachine config.json port\r\n\r\n")).toEqual(["machine config.json port"]);
  });
});

describe("hasBreakingCommit", () => {
  const record = (subject: string, body = ""): string => `${subject}\u0000${body}\u0001`;

  test("finds a `!` subject or a BREAKING CHANGE footer", () => {
    expect(hasBreakingCommit(record("feat: add a thing") + record("fix!: drop a key"))).toBe(true);
    expect(hasBreakingCommit(record("feat: move a key", "Why.\n\nBREAKING CHANGE: the key moved."))).toBe(true);
  });

  test("finds none in plain commits", () => {
    expect(hasBreakingCommit(record("feat: add a thing") + record("docs: explain it"))).toBe(false);
    expect(hasBreakingCommit("")).toBe(false);
  });
});

describe("judgeNames", () => {
  const before = [
    "machine config.json port",
    "vault .eva/hub.json machine",
    "typed telegram /new",
    "migration machine 2026-10-18-a",
  ];

  test("passes when no name goes away", () => {
    const verdict = judgeNames({ before, after: [...before, "typed cli chat"], breaking: false });
    expect(verdict.ok).toBe(true);
  });

  test("fails when a stored name goes away with neither a migration nor a breaking commit", () => {
    const after = before.filter((name) => name !== "machine config.json port");
    const verdict = judgeNames({ before, after, breaking: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("machine config.json port");
    expect(verdict.message).toContain("migration");
    expect(verdict.message).toContain("BREAKING CHANGE:");
  });

  test("passes when a migration of the same store comes with the change", () => {
    const after = [
      ...before.filter((name) => name !== "machine config.json port"),
      "machine config.json network.port",
      "migration machine 2026-10-20-move-port",
    ];
    expect(judgeNames({ before, after, breaking: false }).ok).toBe(true);
  });

  test("fails when only a migration of the other store comes with the change", () => {
    const after = [
      ...before.filter((name) => name !== "vault .eva/hub.json machine"),
      "migration machine 2026-10-20-move-port",
    ];
    const verdict = judgeNames({ before, after, breaking: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("vault .eva/hub.json machine");
  });

  test("fails when a typed name goes away, even with a migration", () => {
    const after = [...before.filter((name) => name !== "typed telegram /new"), "migration machine 2026-10-20-b"];
    const verdict = judgeNames({ before, after, breaking: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("typed telegram /new");
  });

  test("fails when a migration goes away", () => {
    const after = before.filter((name) => !name.startsWith("migration "));
    expect(judgeNames({ before, after, breaking: false }).ok).toBe(false);
  });

  test("passes any removal with a breaking commit, and names what goes away", () => {
    const after = before.filter((name) => name !== "typed telegram /new");
    const verdict = judgeNames({ before, after, breaking: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain("typed telegram /new");
  });
});
