import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homePaths, parseConfig, type HomePaths } from "../../../../src/core/settings/home.ts";
import { runMigrations } from "../../../../src/core/migrations/migration-runner.ts";
import { googleAccessPerService } from "../../../../src/core/migrations/google-access.ts";

let root: string;
let paths: HomePaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-google-access-"));
  paths = homePaths(join(root, "home"));
  mkdirSync(paths.root, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(): "done" | "later" | "failed" {
  const result = runMigrations({
    store: "machine",
    migrations: [googleAccessPerService],
    paths,
    vaultPath: null,
    version: "0.4.0",
    now: () => new Date("2026-10-20T08:00:00.000Z"),
  });
  if (result.kind === "failed") return "failed";
  if (result.kind === "ahead") throw new Error("unexpected");
  return result.later.length > 0 ? "later" : "done";
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(paths.config, "utf-8")) as Record<string, unknown>;
}

describe("googleAccessPerService (machine)", () => {
  test("is a dated machine migration", () => {
    expect(googleAccessPerService.store).toBe("machine");
    expect(googleAccessPerService.id).toMatch(/^\d{4}-\d{2}-\d{2}-/);
  });

  test("write access becomes the top level of each service, so the old login still fits", () => {
    writeFileSync(paths.config, JSON.stringify({ port: 4000, google: { readOnly: false, services: ["gmail"] } }));
    expect(migrate()).toBe("done");
    expect(readConfig()).toEqual({
      port: 4000,
      google: {
        services: ["gmail"],
        access: { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "full" },
      },
    });
    expect(parseConfig(readConfig(), "config.json").google.access.gmail).toBe("full");
  });

  test("read-only access drops the old key: the default is read only", () => {
    writeFileSync(paths.config, JSON.stringify({ google: { email: "person@example.com", readOnly: true } }));
    expect(migrate()).toBe("done");
    expect(readConfig()).toEqual({ google: { email: "person@example.com" } });
  });

  test("a level that is already set wins over the old key", () => {
    writeFileSync(paths.config, JSON.stringify({ google: { readOnly: false, access: { contacts: "readonly" } } }));
    expect(migrate()).toBe("done");
    expect(readConfig()).toEqual({
      google: { access: { calendar: "full", drive: "full", contacts: "readonly", tasks: "full", gmail: "full" } },
    });
  });

  test("a file without the old key, or no file, stays as it is", () => {
    expect(migrate()).toBe("done");
    expect(existsSync(paths.config)).toBe(false);
    writeFileSync(paths.config, JSON.stringify({ google: { services: ["calendar"] } }));
    rmSync(paths.migrationRecord, { force: true });
    expect(migrate()).toBe("done");
    expect(readConfig()).toEqual({ google: { services: ["calendar"] } });
  });

  test("a broken file waits for a later start", () => {
    writeFileSync(paths.config, "{ not json");
    expect(migrate()).toBe("later");
  });

  test("a file with a bad value waits until the person fixes it", () => {
    writeFileSync(paths.config, JSON.stringify({ port: "not a port", google: { readOnly: false } }));
    expect(migrate()).toBe("later");
    expect(readConfig()).toEqual({ port: "not a port", google: { readOnly: false } });
  });
});
