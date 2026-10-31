import { describe, expect, test } from "bun:test";
import { shellWallGap } from "../../../src/core/shell-wall.ts";

const found =
  (names: readonly string[]) =>
  (name: string): string | null =>
    names.includes(name) ? `/usr/bin/${name}` : null;

describe("shellWallGap (#711)", () => {
  test("Linux with bubblewrap and socat has a shell wall", () => {
    expect(shellWallGap({ platform: "linux", which: found(["bwrap", "socat"]) })).toBeNull();
  });

  test("Linux without one of them says which to install", () => {
    const gap = shellWallGap({ platform: "linux", which: found(["socat"]) }) ?? "";
    expect(gap).toContain("bubblewrap");
    expect(gap).toContain("apt install bubblewrap socat");
  });

  test("macOS has its own sandbox, and native Windows has none that Eva can turn on", () => {
    expect(shellWallGap({ platform: "darwin", which: found([]) })).toBeNull();
    expect(shellWallGap({ platform: "win32", which: found([]) })).toContain("Windows");
  });
});
