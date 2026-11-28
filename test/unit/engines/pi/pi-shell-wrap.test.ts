import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import evaShellWrap, {
  shellWallVariable,
  wrappedCommand,
  type ShellWrapEvent,
  type ShellWrapPi,
} from "../../../../src/engines/pi/pi-shell-wrap.ts";
import * as extension from "../../../../src/engines/pi/pi-shell-wrap-extension.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";

const wall = { command: ["/opt/eva/bin/eva"], wallFile: "/srv/eva/engines/pi/shell-walls/turn.json" };

class FakePi implements ShellWrapPi {
  readonly handlers: ((event: ShellWrapEvent) => unknown)[] = [];
  on(event: "tool_call", handler: (event: ShellWrapEvent) => unknown): void {
    expect(event).toBe("tool_call");
    this.handlers.push(handler);
  }
  /** Runs the handlers as pi does, and gives the input that the tool then runs with. */
  call(toolName: string, input: Record<string, unknown>): { input: Record<string, unknown>; results: unknown[] } {
    const event = { toolName, toolCallId: "call-1", input };
    const results = this.handlers.map((handler) => handler(event));
    return { input: event.input, results };
  }
}

function loaded(value: string | null = JSON.stringify(wall)): FakePi {
  if (value === null) Reflect.deleteProperty(process.env, shellWallVariable);
  else process.env[shellWallVariable] = value;
  const pi = new FakePi();
  evaShellWrap(pi);
  return pi;
}

afterEach(() => {
  Reflect.deleteProperty(process.env, shellWallVariable);
  // The extension keeps its wall for a second load in the same process. Each test starts with none.
  Reflect.deleteProperty(globalThis, Symbol.for("eva.shellWall"));
});

describe("Eva's pi extension that runs each shell command of a Project chat in the sandbox (#759)", () => {
  test("rewrites the bash command into a call of the wrapper, and leaves the other tools alone", () => {
    const pi = loaded();
    const bash = pi.call("bash", { command: "cat notes.md", timeout: 30 });
    expect(bash.input).toEqual({
      // Eva starts in `/`: Bun reads a `bunfig.toml` and a `.env` from its start folder, which the chat can write.
      command: `cd / && exec '/opt/eva/bin/eva' 'shell-sandbox' '/srv/eva/engines/pi/shell-walls/turn.json' '${process.cwd()}' 'cat notes.md'`,
      timeout: 30,
    });
    expect(bash.results).toEqual([undefined]);
    expect(pi.call("read", { path: "notes.md" }).input).toEqual({ path: "notes.md" });
  });

  test("reads the wall once and deletes the variable, so the model's commands never see it", () => {
    const pi = loaded();
    expect(process.env[shellWallVariable]).toBeUndefined();
    // pi can load the extensions again in the same process, with the variable gone.
    const again = new FakePi();
    evaShellWrap(again);
    expect(again.call("bash", { command: "ls" }).input["command"]).toContain("'shell-sandbox'");
    expect(pi.handlers).toHaveLength(1);
  });

  test("a command too long for one argument of Linux once wrapped is blocked, with what to do instead", () => {
    const pi = loaded();
    const command = `echo ${"'".repeat(33_000)}`;
    const result = pi.call("bash", { command });
    expect(result.input).toEqual({ command });
    expect(result.results).toEqual([{ block: true, reason: expect.stringContaining("Write it to a file") as unknown }]);
    expect(pi.call("bash", { command: "a".repeat(100_000) }).results).toEqual([undefined]);
  });

  test("with no wall, it wraps nothing: Eva's start check found no sandbox", () => {
    expect(loaded(null).handlers).toEqual([]);
  });

  test("a broken wall or a command it cannot wrap blocks the call, and never throws: the wall fails closed", () => {
    for (const value of ["not json", "{}", '{"command":[],"wallFile":"/w"}', '{"command":["eva"],"wallFile":3}']) {
      const pi = loaded(value);
      const result = pi.call("bash", { command: "ls" });
      expect(result.input).toEqual({ command: "ls" });
      expect(result.results).toEqual([{ block: true, reason: expect.stringContaining("sandbox") as unknown }]);
      Reflect.deleteProperty(globalThis, Symbol.for("eva.shellWall"));
    }
    const pi = loaded();
    expect(pi.call("bash", { command: 42 }).results).toEqual([
      { block: true, reason: expect.stringContaining("sandbox") as unknown },
    ]);
    const frozen = Object.freeze({ command: "ls" });
    expect(() => pi.call("bash", frozen)).not.toThrow();
    expect(pi.call("bash", frozen).results).toEqual([
      { block: true, reason: expect.stringContaining("sandbox") as unknown },
    ]);
  });

  test("the text that pi loads is this file, and its constant matches the adapter's", () => {
    expect(extension.shellWallVariable).toBe(shellWallVariable);
    expect(extension.shellWrapExtensionSource).toContain("export default function evaShellWrap");
  });
});

describe.if(process.platform !== "win32")("the quoting survives a real `bash -c` (#759)", () => {
  let folder: string;
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  /** Runs the wrapped line with bash, as pi does, and gives the arguments that the "wrapper" got. */
  async function argumentsOf(command: string, evaCommand: readonly string[]): Promise<{ argv: string[]; cwd: string }> {
    folder = mkdtempSync(join(tmpdir(), "eva-quote-"));
    const out = join(folder, "argv.json");
    // Stands in for Eva: it writes each argument it got, after its own command, to a file.
    const script = join(folder, "fake eva's script.js");
    writeFileSync(
      script,
      `require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))`,
    );
    const line = wrappedCommand(
      { command: [...evaCommand, script], wallFile: "/srv/eva/wall 1.json" },
      "/srv/vault/it's a clone",
      command,
    );
    const result = await systemProcessRunner.run(["/bin/bash", "-c", line], {
      cwd: folder,
      environment: { PATH: process.env["PATH"] ?? "" },
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(await Bun.file(out).text()) as { argv: string[]; cwd: string };
  }

  const cases: [string, string][] = [
    ["a plain command", "ls -la"],
    ["quotes of each kind", `echo 'one' "two" 'it'\\''s' "it's"`],
    ["a quote at each end", "'quoted'"],
    ["substitutions that must not run", "echo $(touch pwned) `touch pwned` ${HOME} $HOME"],
    ["shell operators", "a && b || c; d | e > f < g & h"],
    ["new lines and tabs", "line one\nline two\n\tindented\r\n"],
    ["Unicode", "echo 'héllo wörld ✓ 日本'"],
    ["an empty command", ""],
    ["the wrapper's own name", "eva shell-sandbox /etc/other.json 'cat /srv/vault/note.md'"],
    ["a quote that tries to end the wrap", "x' ; cat /srv/vault/note.md ; echo '"],
    ["every byte but NUL", Array.from({ length: 255 }, (_, index) => String.fromCharCode(index + 1)).join("")],
    // Linux takes at most 128 KB in one argument, and the quoting adds 3 bytes for each single quote.
    ["a long command", `echo ${"a'b\"c$d ".repeat(8_000)}`],
  ];

  // The script's path has a space and a quote, as a path of Eva's own command can.
  test.each(cases)("%s", async (_name, command) => {
    const got = await argumentsOf(command, [process.execPath]);
    expect(got).toEqual({
      argv: ["shell-sandbox", "/srv/eva/wall 1.json", "/srv/vault/it's a clone", command],
      cwd: "/",
    });
  });
});

describe.if(process.platform !== "win32")("a stale path of Eva fails closed (#759)", () => {
  // An update renames the executable aside, then puts the new one at the same path. In between,
  // or if a person moves Eva, the path names no file: the command must not run at all.
  test("when Eva's executable is gone, bash cannot start the wrapper, and the command never runs", async () => {
    const folder = mkdtempSync(join(tmpdir(), "eva-stale-"));
    try {
      const marker = join(folder, "ran");
      const line = wrappedCommand(
        { command: [join(folder, "eva")], wallFile: join(folder, "wall.json") },
        folder,
        `touch ${marker}`,
      );
      const result = await systemProcessRunner.run(["/bin/bash", "-c", line], {
        cwd: folder,
        environment: { PATH: process.env["PATH"] ?? "" },
        timeoutMs: 20_000,
      });
      expect(result.exitCode).toBe(127);
      expect(await Bun.file(marker).exists()).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
