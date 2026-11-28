import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEvaError } from "../../../src/shared/errors.ts";
import { systemSandboxedCommandStarter } from "../../../src/shared/sandboxed-command.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-sandboxed-command-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the seam of the shell sandbox wrapper (#759)", () => {
  test("gives the command's own exit code", async () => {
    expect(await systemSandboxedCommandStarter([bun, "-e", "process.exit(3)"], { cwd: folder, environment })).toBe(3);
  });

  test("runs in the folder and with the environment that it gets", async () => {
    const script = `require("node:fs").writeFileSync("out.txt", process.env.EVA_TEST_VALUE)`;
    const code = await systemSandboxedCommandStarter([bun, "-e", script], {
      cwd: folder,
      environment: { ...environment, EVA_TEST_VALUE: "from the wrapper" },
    });
    expect(code).toBe(0);
    expect(readFileSync(join(folder, "out.txt"), "utf-8")).toBe("from the wrapper");
  });

  test("rejects when the program cannot start", async () => {
    let failure: unknown = null;
    try {
      await systemSandboxedCommandStarter([join(folder, "no-such-program")], { cwd: folder, environment });
    } catch (error) {
      failure = error;
    }
    expect(isEvaError(failure, "process_failed")).toBe(true);
  });
});
