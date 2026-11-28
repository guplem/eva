import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { absentPlaceholders, piShellWallConfig, removePlaceholders } from "../../../../src/engines/pi/pi-shell-wall.ts";
import { SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";

const wall = {
  area: "/srv/vault/Projects/2025-03-02-1015-example-app/repos/clone-0",
  closed: ["/srv/vault", "/srv/eva", "/srv/vault/Projects/2025-03-02-1015-example-app/repos"],
  readable: ["/srv/eva/engines/git", "/srv/eva/engines/gh", "/srv/eva/bin"],
  readOnly: ["/srv/vault/Projects/2025-03-02-1015-example-app"],
  socketFilter: true,
  shellSandbox: true,
};
const environment = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: "/srv/eva/engines/pi-agent" };
const linux = { runtimeFolder: null, platform: "linux" as const };

describe("the sandbox config of a pi Project chat's shell (#759)", () => {
  test("has the walls of Claude Code's shell, pi's own programs, and the socket filter's helper", () => {
    const config = piShellWallConfig(wall, environment, "/srv/eva/bin/apply-seccomp", linux);
    expect(config).toEqual({
      network: {
        allowedDomains: expect.arrayContaining(["github.com", "registry.npmjs.org"]) as unknown as string[],
        deniedDomains: ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "*.ts.net"],
        allowLocalBinding: true,
      },
      filesystem: {
        denyRead: wall.closed,
        // pi's managed rg and fd, but not its logins or its chats' history.
        allowRead: [wall.area, ...wall.readOnly, ...wall.readable, "/srv/eva/engines/pi-agent/bin"],
        allowWrite: [wall.area, tmpdir(), join(homedir(), ".npm", "_cacache")],
        // pi reads its settings from `.pi`, and a shell command prefix there runs before the wrap.
        denyWrite: [join(wall.area, ".pi")],
      },
      seccomp: { applyPath: "/srv/eva/bin/apply-seccomp" },
    });
    // The library refuses a config it cannot read, so the wrapper would run nothing.
    expect(SandboxRuntimeConfigSchema.safeParse(config).success).toBe(true);
  });

  test("with no helper on Linux, it closes the socket folders, as where the filter cannot run (#760)", () => {
    const config = piShellWallConfig(wall, environment, null, linux);
    expect(config["seccomp"]).toBeUndefined();
    expect((config["network"] as Record<string, unknown>)["allowAllUnixSockets"]).toBe(true);
    expect((config["filesystem"] as { denyRead: string[] }).denyRead).toContain("/run");
  });

  test("macOS filters sockets with no helper", () => {
    const config = piShellWallConfig(wall, environment, null, { runtimeFolder: null, platform: "darwin" });
    expect((config["network"] as Record<string, unknown>)["allowAllUnixSockets"]).toBeUndefined();
  });

  test("with no pi folder in the environment, it opens none of pi's own", () => {
    const config = piShellWallConfig(wall, { PATH: "/usr/bin" }, "/srv/eva/bin/apply-seccomp", linux);
    expect((config["filesystem"] as { allowRead: string[] }).allowRead).toEqual([
      wall.area,
      ...wall.readOnly,
      ...wall.readable,
    ]);
  });
});

describe("the placeholders that bubblewrap leaves in a chat's folder (#759)", () => {
  let folder: string;
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  test("go at the end of the turn when they are new and empty, as after a command that pi stopped hard", () => {
    folder = mkdtempSync(join(tmpdir(), "eva-placeholders-"));
    writeFileSync(join(folder, ".mcp.json"), "");
    const absent = absentPlaceholders(folder);
    expect(absent).not.toContain(".mcp.json");
    // What a killed bubblewrap leaves: empty files and folders where the names were absent.
    for (const name of [".bashrc", ".gitconfig", ".pi"]) writeFileSync(join(folder, name), "");
    for (const name of [".vscode", ".claude/commands", ".claude/agents"])
      mkdirSync(join(folder, name), { recursive: true });
    // A file with content is never a placeholder.
    writeFileSync(join(folder, ".profile"), "export A=1\n");
    removePlaceholders(folder, absent);
    expect(readdirSync(folder).sort()).toEqual([".mcp.json", ".profile"]);
  });

  test("a folder with a file in it stays", () => {
    folder = mkdtempSync(join(tmpdir(), "eva-placeholders-"));
    const absent = absentPlaceholders(folder);
    mkdirSync(join(folder, ".claude", "commands"), { recursive: true });
    writeFileSync(join(folder, ".claude", "notes.md"), "kept");
    removePlaceholders(folder, absent);
    expect(readdirSync(join(folder, ".claude"))).toEqual(["notes.md"]);
  });

  test("a folder that Eva cannot read changes nothing, and nothing throws", () => {
    folder = mkdtempSync(join(tmpdir(), "eva-placeholders-"));
    expect(() => {
      removePlaceholders(join(folder, "missing"), absentPlaceholders(join(folder, "missing")));
    }).not.toThrow();
  });
});
