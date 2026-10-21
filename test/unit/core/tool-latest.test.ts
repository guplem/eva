import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeUpdateChannel, readLatestVersion } from "../../../src/core/tool-latest.ts";

describe("readLatestVersion", () => {
  let server: Server<undefined>;
  let sources: { npmBaseUrl: string; githubApiBaseUrl: string };
  const paths: string[] = [];

  beforeEach(() => {
    paths.length = 0;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === "/@anthropic-ai/claude-code/latest") return Response.json({ version: "2.1.310" });
        if (path === "/@anthropic-ai/claude-code/stable") return Response.json({ version: "2.1.304" });
        if (path === "/repos/earendil-works/pi/releases/latest") return Response.json({ tag_name: "v1.4.0" });
        if (path === "/repos/cli/cli/releases/latest") return Response.json({ tag_name: "v2.103.0" });
        if (path === "/repos/astral-sh/uv/releases/latest") return Response.json({ tag_name: "not a version" });
        return new Response("rate limited", { status: 403 });
      },
    });
    const base = `http://127.0.0.1:${String(server.port)}`;
    sources = { npmBaseUrl: base, githubApiBaseUrl: base };
  });

  afterEach(async () => {
    await server.stop(true);
  });

  test("claude comes from npm, and pi and gh from their GitHub release, without the v", async () => {
    expect(await readLatestVersion("claude", sources)).toBe("2.1.310");
    expect(await readLatestVersion("pi", sources)).toBe("1.4.0");
    expect(await readLatestVersion("gh", sources)).toBe("2.103.0");
    expect(paths).toEqual([
      "/@anthropic-ai/claude-code/latest",
      "/repos/earendil-works/pi/releases/latest",
      "/repos/cli/cli/releases/latest",
    ]);
  });

  test("claude on the stable channel reads the stable tag", async () => {
    expect(await readLatestVersion("claude", sources, "stable")).toBe("2.1.304");
  });

  test("an answer with no version number, a refusal or no server gives null", async () => {
    expect(await readLatestVersion("uv", sources)).toBeNull();
    expect(await readLatestVersion("gh", { ...sources, githubApiBaseUrl: `${sources.npmBaseUrl}/missing` })).toBeNull();
    expect(await readLatestVersion("claude", { ...sources, npmBaseUrl: "http://127.0.0.1:1" })).toBeNull();
  });
});

describe("claudeUpdateChannel", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "eva-claude-channel-"));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  test("the channel comes from Claude Code's settings, and anything else is latest", () => {
    expect(claudeUpdateChannel(folder)).toBe("latest");
    writeFileSync(join(folder, "settings.json"), "{ not json");
    expect(claudeUpdateChannel(folder)).toBe("latest");
    writeFileSync(join(folder, "settings.json"), JSON.stringify({ autoUpdatesChannel: "nightly" }));
    expect(claudeUpdateChannel(folder)).toBe("latest");
    writeFileSync(join(folder, "settings.json"), JSON.stringify({ autoUpdatesChannel: "stable" }));
    expect(claudeUpdateChannel(folder)).toBe("stable");
  });
});
