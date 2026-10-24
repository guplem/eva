import { describe, expect, test } from "bun:test";
import { closesFence, openingFencePattern } from "../../../src/frontends/markdown-fence.ts";

describe("openingFencePattern", () => {
  test("reads the indent, the fence and the language", () => {
    expect(openingFencePattern.exec("  ```ts")?.slice(1)).toEqual(["  ", "```", "ts"]);
    expect(openingFencePattern.exec("~~~")?.[2]).toBe("~~~");
  });

  test("a backtick fence with a backtick after it is no fence (CommonMark)", () => {
    expect(openingFencePattern.test("```bash ls```")).toBe(false);
    expect(openingFencePattern.test("~~~ a`b")).toBe(true);
  });

  test("a very long backtick run stays fast", () => {
    const started = performance.now();
    expect(openingFencePattern.test(`${"`".repeat(50_000)}x\``)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("closesFence", () => {
  test("only a bare fence of the same character, at least as long, closes a block", () => {
    expect(closesFence("````", "```")).toBe(true);
    expect(closesFence("``", "```")).toBe(false);
    expect(closesFence("~~~", "```")).toBe(false);
  });
});
