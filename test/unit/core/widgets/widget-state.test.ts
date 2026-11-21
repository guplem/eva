import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answerStatePath,
  maxStateBytes,
  removeWidgetState,
  type StatePathOptions,
  widgetStateFile,
} from "../../../../src/core/widgets/widget-state.ts";

let vault: string;
const id = "example-owner/calendar-widget";

function options(method: string, body: string | null = null): StatePathOptions {
  return {
    vaultPath: vault,
    id,
    method,
    body: body === null ? null : new TextEncoder().encode(body),
    exclusive: <Result>(work: () => Result): Promise<Result> => Promise.resolve(work()),
    redact: (text: string) => text.replaceAll("ghp_secret", "[redacted]"),
  };
}

function text(body: string | Uint8Array | undefined): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-widget-state-"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("eva/state.json", () => {
  test("answers {} before a save, then the saved object, kept in the vault", async () => {
    const empty = await answerStatePath(options("GET"));
    expect({ status: empty.status, body: text(empty.body) }).toEqual({ status: 200, body: "{}" });
    const saved = await answerStatePath(options("PUT", '{ "hiddenCalendars": ["work"] }'));
    expect(saved.status).toBe(204);
    const file = join(vault, ".eva", "widget-state", "example-owner", "calendar-widget.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ hiddenCalendars: ["work"] });
    const read = await answerStatePath(options("GET"));
    expect(JSON.parse(text(read.body))).toEqual({ hiddenCalendars: ["work"] });
    // A PUT replaces the whole state.
    await answerStatePath(options("PUT", '{ "other": 1 }'));
    expect(JSON.parse(text((await answerStatePath(options("GET"))).body))).toEqual({ other: 1 });
  });

  test("refuses a body that is not a JSON object, a large body, a secret and another method", async () => {
    for (const body of ["[1]", "null", "5", "{", ""])
      expect((await answerStatePath(options("PUT", body))).status).toBe(400);
    expect((await answerStatePath(options("PUT", null))).status).toBe(400);
    const large = JSON.stringify({ note: "x".repeat(maxStateBytes) });
    expect((await answerStatePath(options("PUT", large))).status).toBe(413);
    expect((await answerStatePath(options("PUT", '{ "token": "ghp_secret" }'))).status).toBe(422);
    expect((await answerStatePath(options("DELETE"))).status).toBe(405);
    expect(existsSync(join(vault, ".eva", "widget-state"))).toBe(false);
  });

  test("a broken file reads as {}, and a save writes over it", async () => {
    const file = widgetStateFile(vault, id);
    if (file === null) throw new Error("The id must have a file.");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "not json");
    expect(text((await answerStatePath(options("GET"))).body)).toBe("{}");
    writeFileSync(file, "[1, 2]");
    expect(text((await answerStatePath(options("GET"))).body)).toBe("{}");
    expect((await answerStatePath(options("PUT", '{ "a": 1 }'))).status).toBe(204);
  });

  test("removeWidgetState deletes the file, and the folder of the owner when it is empty", async () => {
    await answerStatePath(options("PUT", '{ "a": 1 }'));
    removeWidgetState(vault, id);
    expect(existsSync(join(vault, ".eva", "widget-state", "example-owner"))).toBe(false);
    // A second remove, or a widget that saved nothing, changes nothing.
    removeWidgetState(vault, id);
    removeWidgetState(vault, "example-owner/other");
  });

  test("an id that is not a plain owner and name has no file", () => {
    for (const bad of ["owner", "owner/..", "../x", "owner/name/more", "Owner/Name", ""])
      expect(widgetStateFile(vault, bad)).toBeNull();
  });
});
