import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embeddedSeccompHelper, installSeccompHelper } from "../../../../src/core/shell-sandbox/seccomp-helper.ts";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-seccomp-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the apply-seccomp helper of the shell sandbox (#759)", () => {
  test("each Linux build carries the helper of its own processor, and no other build carries one", async () => {
    const helper = await embeddedSeccompHelper();
    if (process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64"))
      expect(helper !== null && existsSync(helper)).toBe(true);
    else expect(helper).toBeNull();
  });

  test("goes to a folder that the sandbox reads, as a program, and is written again only when it changed", () => {
    const source = join(folder, "apply-seccomp");
    writeFileSync(source, "first");
    const target = join(folder, "bin");
    const installed = installSeccompHelper(source, target);
    expect(installed).toBe(join(target, "apply-seccomp"));
    expect(readFileSync(join(target, "apply-seccomp"), "utf-8")).toBe("first");
    if (process.platform !== "win32") expect(statSync(join(target, "apply-seccomp")).mode & 0o777).toBe(0o755);
    const written = statSync(join(target, "apply-seccomp")).mtimeMs;
    expect(installSeccompHelper(source, target)).toBe(installed);
    expect(statSync(join(target, "apply-seccomp")).mtimeMs).toBe(written);
    // A planted copy, such as from a shell with no wall, is replaced at the next start.
    writeFileSync(join(target, "apply-seccomp"), "planted");
    installSeccompHelper(source, target);
    expect(readFileSync(join(target, "apply-seccomp"), "utf-8")).toBe("first");
  });

  test("gives no helper when the build carries none or the copy fails", () => {
    expect(installSeccompHelper(null, join(folder, "bin"))).toBeNull();
    expect(installSeccompHelper(join(folder, "missing"), join(folder, "bin"))).toBeNull();
  });
});
