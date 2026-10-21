import { describe, expect, test } from "bun:test";
import type { EvaStatus } from "../../../../../src/frontends/web/client/api.ts";
import { statusFacts } from "../../../../../src/frontends/web/client/status-overview.ts";

function status(change: Partial<EvaStatus> = {}): EvaStatus {
  return {
    version: "1.4.0",
    vaultPath: "/vault",
    role: "hub",
    machine: "desk",
    hub: "desk",
    vaultSync: { status: "ok", lastCommitAt: null, lastPushAt: null, lastError: null, withheldFiles: [] },
    vaultAutoSync: true,
    sessionCount: 3,
    busySessionIds: ["a"],
    lastTurn: null,
    update: null,
    remoteAccess: { url: "https://desk.example.ts.net", problem: null },
    localUrl: "http://127.0.0.1:7777",
    problems: [],
    problemDetails: [],
    setupMissing: 0,
    chatBlocker: null,
    voiceNotes: false,
    ...change,
  };
}

function valueOf(facts: ReturnType<typeof statusFacts>, label: string): string | undefined {
  return facts.find((fact) => fact.label === label)?.value;
}

describe("the status overview", () => {
  test("names each fact in a fixed order", () => {
    expect(statusFacts(status()).map((fact) => fact.label)).toEqual([
      "Version",
      "This machine",
      "Chats",
      "Vault sync",
      "Phone access",
      "Problems",
    ]);
  });

  test("says what runs on a healthy hub", () => {
    const facts = statusFacts(status());
    expect(valueOf(facts, "Version")).toBe("1.4.0");
    expect(valueOf(facts, "This machine")).toBe("desk, the hub");
    expect(valueOf(facts, "Chats")).toBe("3 chats, 1 runs now");
    expect(valueOf(facts, "Vault sync")).toBe("Up to date");
    expect(valueOf(facts, "Phone access")).toBe("https://desk.example.ts.net");
    expect(valueOf(facts, "Problems")).toBe("None");
  });

  test("names the version that waits to install", () => {
    const update = { available: true, target: "1.5.0" } as EvaStatus["update"];
    expect(valueOf(statusFacts(status({ update })), "Version")).toBe("1.4.0, 1.5.0 waits to install");
  });

  test("names the hub of a satellite", () => {
    expect(valueOf(statusFacts(status({ role: "satellite", hub: "laptop" })), "This machine")).toBe(
      "desk, a satellite of laptop",
    );
    expect(valueOf(statusFacts(status({ role: "satellite", hub: null })), "This machine")).toBe("desk, a satellite");
  });

  test("counts one chat, and no chat that runs", () => {
    expect(valueOf(statusFacts(status({ sessionCount: 1, busySessionIds: [] })), "Chats")).toBe("1 chat");
    expect(valueOf(statusFacts(status({ sessionCount: 0, busySessionIds: [] })), "Chats")).toBe("No chats yet");
  });

  test("counts the chats that run now", () => {
    expect(valueOf(statusFacts(status({ busySessionIds: ["a", "b"] })), "Chats")).toBe("3 chats, 2 run now");
  });

  test("shows the sync error, and no sync without a vault", () => {
    const vaultSync = { ...status().vaultSync, status: "error" as const, lastError: "The push failed." };
    expect(valueOf(statusFacts(status({ vaultSync })), "Vault sync")).toBe("Error: The push failed.");
    expect(valueOf(statusFacts(status({ vaultPath: null })), "Vault sync")).toBe("No vault yet");
  });

  test("says when automatic sync is off", () => {
    expect(valueOf(statusFacts(status({ vaultAutoSync: false })), "Vault sync")).toBe(
      "Up to date, automatic sync is off",
    );
  });

  test("reads a status without the automatic sync field, as an older Eva sends it", () => {
    const { vaultAutoSync: _, ...older } = status();
    expect(valueOf(statusFacts(older as EvaStatus), "Vault sync")).toBe("Up to date");
  });

  test("says when phone access is not set up, or has a problem", () => {
    expect(valueOf(statusFacts(status({ remoteAccess: null })), "Phone access")).toBe("Not set up");
    expect(
      valueOf(statusFacts(status({ remoteAccess: { url: null, problem: "Tailscale stopped." } })), "Phone access"),
    ).toBe("Tailscale stopped.");
  });

  test("counts the open problems", () => {
    expect(valueOf(statusFacts(status({ problems: ["a"] })), "Problems")).toBe("1 open");
    expect(valueOf(statusFacts(status({ problems: ["a", "b"] })), "Problems")).toBe("2 open");
  });
});
