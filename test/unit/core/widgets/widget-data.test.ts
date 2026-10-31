import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OpenApprovedPath as ApprovedPath } from "../../../../src/core/widgets/widget-data.ts";
import {
  answerData,
  contentTypeOf,
  keepUnknownFields,
  maxWriteBytes,
  type DataWrite,
} from "../../../../src/core/widgets/widget-data.ts";

let folder: string;
let vault: string;

const habits: ApprovedPath = {
  input: "habits",
  type: "folder",
  path: "Life/Habits",
  access: "write",
  files: "*.json",
  schema: "schemas/habits.json",
};
const lifeRead: ApprovedPath = {
  input: "life",
  type: "folder",
  path: "Life",
  access: "read",
  files: null,
  schema: null,
};
const dayFile: ApprovedPath = {
  input: "day",
  type: "file",
  path: "Life/day.yaml",
  access: "write",
  files: null,
  schema: null,
};
const keep = (text: string): string => text;
const schema = { type: "object", properties: { name: {}, checks: {}, frequency: { properties: { times: {} } } } };

function write(path: string, content: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), content);
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

function body(value: unknown, redact = keep): DataWrite {
  return { body: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)), schema, redact };
}

function text(answer: { body?: string | Uint8Array }): string {
  return typeof answer.body === "string" ? answer.body : Buffer.from(answer.body ?? new Uint8Array()).toString();
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-widget-data-"));
  vault = join(folder, "vault");
  write("Life/Habits/walk.json", JSON.stringify({ name: "Walk", checks: [], streak: 4 }));
  write("Life/Habits/2026/run.json", JSON.stringify({ name: "Run" }));
  write("Life/Habits/index.json", "[]");
  write("Life/Habits/notes.md", "# Notes\n");
  write("Life/Habits/DATA_FORMAT.md", "# Format\n");
  write("Life/Habits/.hidden.json", "{}");
  write("Life/Habits/.env", "TOKEN=x\n");
  write("Life/About me.md", "# About me\n");
  write("Life/day.yaml", "# A comment\nmood: good\nslept: 8\n");
  write("Projects/2026-01-01-0900-app/repos/clone-1/app/a.json", "{}");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("answerData reads", () => {
  test("lists the files of the folder and its subfolders that the pattern takes", () => {
    const answer = answerData(vault, habits, "index.json", "GET", null);
    expect(answer.status).toBe(200);
    expect(JSON.parse(text(answer))).toEqual(["2026/run.json", "walk.json"]);
    // With no pattern, every plain file shows, but never the hidden places or the format file.
    expect(
      JSON.parse(text(answerData(vault, { ...lifeRead, path: "Life/Habits" }, "index.json", "GET", null))),
    ).toEqual(["2026/run.json", "notes.md", "walk.json"]);
  });

  test("a pick of Life never shows or reads About me.md", () => {
    expect(JSON.parse(text(answerData(vault, lifeRead, "index.json", "GET", null)))).not.toContain("About me.md");
    expect(answerData(vault, lifeRead, "About me.md", "GET", null).status).toBe(404);
    expect(answerData(vault, lifeRead, "ABOUT ME.MD", "GET", null).status).toBe(404);
    expect(answerData(vault, lifeRead, "Habits/walk.json", "GET", null).status).toBe(200);
  });

  test("reads a file of the folder, with its type", () => {
    const answer = answerData(vault, habits, "walk.json", "GET", null);
    expect(answer).toMatchObject({ status: 200, contentType: "application/json; charset=utf-8" });
    expect(JSON.parse(text(answer))).toMatchObject({ name: "Walk" });
    expect(text(answerData(vault, dayFile, null, "GET", null))).toContain("mood: good");
  });

  test("refuses each path that leaves the folder or reaches a hidden place", () => {
    for (const rest of [
      "../About me.md",
      "..",
      "./walk.json",
      ".hidden.json",
      ".env",
      "DATA_FORMAT.md",
      "2026",
      "missing.json",
      "walk.json/",
      "a\\b.json",
      "%2e%2e/About me.md",
      "",
    ]) {
      expect({ rest, status: answerData(vault, habits, rest, "GET", null).status }).toEqual({ rest, status: 404 });
    }
    expect(answerData(vault, habits, null, "GET", null).status).toBe(404);
    expect(answerData(vault, dayFile, "x", "GET", null).status).toBe(404);
    const repos: ApprovedPath = { ...lifeRead, path: "Projects/2026-01-01-0900-app" };
    expect(answerData(vault, repos, "repos/clone-1/app/a.json", "GET", null).status).toBe(404);
    expect(JSON.parse(text(answerData(vault, repos, "index.json", "GET", null)))).toEqual([]);
  });

  test("gives nothing for a record whose place is now closed or gone", () => {
    expect(answerData(vault, { ...lifeRead, path: "Scratch" }, "x.json", "GET", null).status).toBe(404);
    expect(answerData(vault, { ...lifeRead, path: "Gone" }, "index.json", "GET", null).status).toBe(404);
    expect(answerData(vault, { ...lifeRead, path: ".eva" }, "index.json", "GET", null).status).toBe(404);
  });

  test("never follows a symbolic link, in the folder or on the way to it", () => {
    writeFileSync(join(folder, "outside.json"), '{"secret":true}');
    mkdirSync(join(folder, "elsewhere"));
    writeFileSync(join(folder, "elsewhere", "x.json"), "{}");
    try {
      symlinkSync(join(folder, "outside.json"), join(vault, "Life/Habits/link.json"));
      symlinkSync(join(folder, "elsewhere"), join(vault, "Life/Habits/away"), "junction");
      symlinkSync(join(vault, "Life/Habits"), join(vault, "Linked"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    expect(answerData(vault, habits, "link.json", "GET", null).status).toBe(404);
    expect(answerData(vault, habits, "away/x.json", "GET", null).status).toBe(404);
    expect(JSON.parse(text(answerData(vault, habits, "index.json", "GET", null)))).toEqual([
      "2026/run.json",
      "walk.json",
    ]);
    expect(answerData(vault, habits, "link.json", "PUT", body({ name: "x" })).status).toBe(403);
    expect(readFileSync(join(folder, "outside.json"), "utf-8")).toBe('{"secret":true}');
    expect(answerData(vault, habits, "away/new.json", "PUT", body({ name: "x" })).status).toBe(403);
    expect(existsSync(join(folder, "elsewhere", "new.json"))).toBe(false);
    expect(answerData(vault, habits, "link.json", "DELETE", null).status).toBe(404);
    const linked: ApprovedPath = { ...habits, path: "Linked" };
    expect(answerData(vault, linked, "walk.json", "GET", null).status).toBe(404);
    expect(answerData(vault, linked, "new.json", "PUT", body({ name: "x" })).status).toBe(404);
  });
});

test("never reaches a file of another place through a hard link", () => {
  try {
    linkSync(join(vault, "Life/About me.md"), join(vault, "Life/Habits/facts.json"));
  } catch {
    return; // A system that cannot make the link cannot follow one either.
  }
  expect(answerData(vault, habits, "facts.json", "GET", null).status).toBe(404);
  expect(JSON.parse(text(answerData(vault, habits, "index.json", "GET", null)))).toEqual([
    "2026/run.json",
    "walk.json",
  ]);
  expect(answerData(vault, habits, "facts.json", "PUT", body({ name: "x" })).status).toBe(403);
  expect(answerData(vault, habits, "facts.json", "DELETE", null).status).toBe(403);
  expect(read("Life/About me.md")).toBe("# About me\n");
});

describe("answerData writes", () => {
  test("writes a new file, and a file in a new subfolder", () => {
    expect(answerData(vault, habits, "read.json", "PUT", body({ name: "Read", checks: [] })).status).toBe(204);
    expect(JSON.parse(read("Life/Habits/read.json"))).toEqual({ name: "Read", checks: [] });
    expect(answerData(vault, habits, "2027/swim.json", "PUT", body({ name: "Swim" })).status).toBe(204);
    expect(JSON.parse(read("Life/Habits/2027/swim.json"))).toEqual({ name: "Swim" });
  });

  test("keeps the fields that the widget does not know, and lets it drop its own", () => {
    write(
      "Life/Habits/walk.json",
      JSON.stringify({ name: "Walk", note: "x", streak: 4, frequency: { times: 1, days: 2 } }),
    );
    const next = { checks: [{ date: "2026-01-01" }], frequency: {} };
    expect(answerData(vault, habits, "walk.json", "PUT", body(next)).status).toBe(204);
    // `name` is in the schema, so the widget dropped it. `note`, `streak` and `days` are not.
    expect(JSON.parse(read("Life/Habits/walk.json"))).toEqual({
      checks: [{ date: "2026-01-01" }],
      frequency: { days: 2 },
      note: "x",
      streak: 4,
    });
  });

  test("keeps the body as the widget wrote it when nothing is merged", () => {
    const exact = '{ "name": "Walk",  "checks": [], "streak": 4 }';
    expect(answerData(vault, habits, "walk.json", "PUT", body(exact)).status).toBe(204);
    expect(read("Life/Habits/walk.json")).toBe(exact);
  });

  test("writes YAML, and keeps its unknown fields", () => {
    expect(answerData(vault, dayFile, null, "PUT", { ...body("mood: great\n"), schema: null }).status).toBe(204);
    expect(read("Life/day.yaml")).toBe("mood: great\nslept: 8\n");
  });

  test("refuses a write that the record does not allow", () => {
    expect(answerData(vault, lifeRead, "x.json", "PUT", body({})).status).toBe(403);
    for (const rest of [
      "AGENTS.md",
      "agents.md",
      "README.md",
      "CLAUDE.md",
      "DATA_FORMAT.md",
      "notes.md",
      "x.yaml",
      "index.json",
    ]) {
      expect({ rest, status: answerData(vault, habits, rest, "PUT", body({})).status }).toEqual({ rest, status: 403 });
    }
    const anyName: ApprovedPath = { ...habits, files: null };
    expect(answerData(vault, anyName, "AGENTS.md", "PUT", body("# Rules")).status).toBe(403);
    expect(answerData(vault, anyName, ".eva.json", "PUT", body({})).status).toBe(404);
    expect(answerData(vault, anyName, "x.yaml", "PUT", body("a: 1")).status).toBe(204);
    expect(answerData(vault, habits, "walk.json", "POST", body({})).status).toBe(405);
    expect(answerData(vault, habits, "walk.json", "PUT", null).status).toBe(400);
  });

  test("a file input writes its file when it does not exist yet, also at the vault root", () => {
    const newDay: ApprovedPath = { ...dayFile, path: "Life/new-day.json" };
    expect(answerData(vault, newDay, null, "PUT", body({ mood: "fine" })).status).toBe(204);
    expect(JSON.parse(read("Life/new-day.json"))).toEqual({ mood: "fine" });
    const atRoot: ApprovedPath = { ...dayFile, path: "day.json" };
    expect(answerData(vault, atRoot, null, "PUT", body({ mood: "fine" })).status).toBe(204);
    expect(answerData(vault, atRoot, null, "DELETE", null).status).toBe(204);
    expect(answerData(vault, { ...dayFile, path: "Gone/day.json" }, null, "PUT", body({})).status).toBe(404);
  });

  test("never writes or deletes a secrets file, and a refused write makes no folder", () => {
    const anyName: ApprovedPath = { ...habits, files: null };
    write("Life/Habits/credentials.json", "{}");
    for (const rest of ["secrets.json", "credentials.json", "client_secret_1.json"]) {
      expect({ rest, status: answerData(vault, anyName, rest, "PUT", body({})).status }).toEqual({ rest, status: 403 });
    }
    expect(answerData(vault, anyName, "credentials.json", "DELETE", null).status).toBe(403);
    expect(existsSync(join(vault, "Life/Habits/credentials.json"))).toBe(true);
    expect(answerData(vault, habits, "a/b/x.json", "PUT", body("{ broken")).status).toBe(400);
    expect(existsSync(join(vault, "Life/Habits/a"))).toBe(false);
  });

  test("refuses a body that is too large, does not parse, or holds a secret", () => {
    const large = { body: new Uint8Array(maxWriteBytes + 1), schema: null, redact: keep };
    expect(answerData(vault, habits, "walk.json", "PUT", large).status).toBe(413);
    expect(answerData(vault, habits, "walk.json", "PUT", body("{ broken")).status).toBe(400);
    const redact = (value: string): string => value.replaceAll("ghp_secret", "[hidden]");
    expect(answerData(vault, habits, "new.json", "PUT", body({ name: "ghp_secret" }, redact)).status).toBe(422);
    expect(existsSync(join(vault, "Life/Habits/new.json"))).toBe(false);
  });

  test("never writes over a file that it cannot merge, or a folder", () => {
    write("Life/Habits/broken.json", "{ not json");
    expect(answerData(vault, habits, "broken.json", "PUT", body({ name: "x" })).status).toBe(409);
    expect(read("Life/Habits/broken.json")).toBe("{ not json");
    mkdirSync(join(vault, "Life/Habits/folder.json"));
    expect(answerData(vault, habits, "folder.json", "PUT", body({})).status).toBe(403);
    write("Life/Habits/plain", "x");
    expect(answerData(vault, habits, "plain/x.json", "PUT", body({})).status).toBe(403);
    expect(answerData(vault, { ...habits, path: "Life/Missing" }, "x.json", "PUT", body({})).status).toBe(404);
  });

  test("deletes a file of the folder, and nothing else", () => {
    expect(answerData(vault, habits, "walk.json", "DELETE", null).status).toBe(204);
    expect(existsSync(join(vault, "Life/Habits/walk.json"))).toBe(false);
    expect(answerData(vault, habits, "walk.json", "DELETE", null).status).toBe(404);
    expect(answerData(vault, habits, "2026", "DELETE", null).status).toBe(403);
    expect(answerData(vault, lifeRead, "Habits/2026/run.json", "DELETE", null).status).toBe(403);
    expect(answerData(vault, { ...habits, path: "Life/Missing" }, "x.json", "DELETE", null).status).toBe(404);
  });
});

describe("keepUnknownFields", () => {
  test("takes the new value when either side is not an object", () => {
    expect(keepUnknownFields([1], { a: 1 }, null)).toEqual({ a: 1 });
    expect(keepUnknownFields({ a: 1 }, [2], null)).toEqual([2]);
    expect(keepUnknownFields({ list: [{ a: 1, b: 2 }] }, { list: [{ a: 3 }] }, null)).toEqual({ list: [{ a: 3 }] });
  });

  test("keeps `__proto__` as a plain field", () => {
    const before = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as unknown;
    const merged = keepUnknownFields(before, { b: 2 }, null) as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("contentTypeOf", () => {
  test("never serves an unknown type as a page", () => {
    expect(contentTypeOf("a.html")).toBe("application/octet-stream");
    expect(contentTypeOf("a.PNG")).toBe("image/png");
    expect(contentTypeOf("noextension")).toBe("application/octet-stream");
  });
});
