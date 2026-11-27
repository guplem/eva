import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlertProblem } from "../../../../src/core/alerts/alert-center.ts";
import { PlainHistoryWatch, plainHistoryKey } from "../../../../src/core/vault/plain-history.ts";

let folder: string;
let statePath: string;
let onRemote: (paths: readonly string[]) => Promise<string[] | null>;
let asked: string[][];
let notices: { key: string; problem: AlertProblem; send: boolean }[];

function watch(): PlainHistoryWatch {
  return new PlainHistoryWatch({
    statePath,
    plainOnRemote: (paths) => {
      asked.push([...paths]);
      return onRemote(paths);
    },
    notice: (key, problem, send) => notices.push({ key, problem, send }),
  });
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-plain-history-"));
  statePath = join(folder, "plain-history.json");
  onRemote = (paths) => Promise.resolve([...paths]);
  asked = [];
  notices = [];
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the warning about plain versions on the vault remote (#1110)", () => {
  test("a file with a plain version on the remote gets one notice that names it and says to change a key", async () => {
    await watch().consider(["deploy/id.key"], new Map());
    expect(notices).toHaveLength(1);
    expect(notices[0]?.key).toBe(plainHistoryKey("deploy/id.key"));
    expect(notices[0]?.send).toBe(true);
    expect(notices[0]?.problem.message).toContain("deploy/id.key");
    expect(notices[0]?.problem.message).toContain("git history");
    expect(notices[0]?.problem.message).toContain("Change");
  });

  test("Encrypt's rename checks the old name, and names the new one", async () => {
    onRemote = (paths) => Promise.resolve(paths.filter((path) => path === "Notes/plan.md"));
    await watch().consider(["Notes/plan.md.eva-secret"], new Map([["Notes/plan.md.eva-secret", "Notes/plan.md"]]));
    expect(asked).toEqual([["Notes/plan.md"]]);
    expect(notices.map((notice) => notice.key)).toEqual([plainHistoryKey("Notes/plan.md.eva-secret")]);
  });

  test("a file whose plain versions never reached the remote gets no notice", async () => {
    onRemote = () => Promise.resolve([]);
    await watch().consider(["deploy/id.key"], new Map());
    expect(notices).toEqual([]);
  });

  test("the same file gives no new notice at a later round, also after a restart", async () => {
    await watch().consider(["deploy/id.key"], new Map());
    await watch().consider(["deploy/id.key"], new Map());
    expect(notices.filter((notice) => notice.send)).toHaveLength(1);
    expect(asked).toEqual([["deploy/id.key"]]);
  });

  test("a restart opens each unread notice again, unsent, and a read notice stays closed", () => {
    writeFileSync(statePath, JSON.stringify({ warned: ["a.key", "b.key"], open: ["a.key", "b.key"] }));
    const restarted = watch();
    expect(restarted.read(plainHistoryKey("b.key"))).toBe(true);
    restarted.reopen();
    expect(notices.map(({ key, send }) => ({ key, send }))).toEqual([{ key: plainHistoryKey("a.key"), send: false }]);
    expect(restarted.read("vault_structure")).toBe(false);
  });

  test("when git cannot say, the files wait for the next round", async () => {
    onRemote = () => Promise.resolve(null);
    const one = watch();
    await one.consider(["deploy/id.key"], new Map());
    expect(notices).toEqual([]);
    onRemote = (paths) => Promise.resolve([...paths]);
    await one.consider([], new Map());
    expect(notices.map((notice) => notice.key)).toEqual([plainHistoryKey("deploy/id.key")]);
  });

  test("a broken state file reads as no notice", async () => {
    writeFileSync(statePath, "{ not json");
    await watch().consider(["deploy/id.key"], new Map());
    expect(notices).toHaveLength(1);
  });
});
