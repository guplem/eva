import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toastVisibleMs } from "../../../../../src/frontends/web/client/toast-timing.ts";

const toastStyles = readFileSync(join(import.meta.dir, "../../../../../src/frontends/web/toast.css"), "utf8");

describe("the time a toast stays", () => {
  test("a short note stays a few seconds", () => {
    const ms = toastVisibleMs("Saved.", false);
    expect(ms).toBeGreaterThanOrEqual(4_000);
    expect(ms).toBeLessThanOrEqual(6_000);
  });

  test("a long note stays longer, so the person can read it", () => {
    const long = "The page could not read which chats run. A restart stops them. Restart Eva now?";
    expect(toastVisibleMs(long, false)).toBeGreaterThan(toastVisibleMs("Saved.", false));
  });

  test("a toast with a button stays longer, so the person can reach it", () => {
    expect(toastVisibleMs("Restart Eva now?", true)).toBeGreaterThan(toastVisibleMs("Restart Eva now?", false));
  });

  test("no toast stays more than 15 seconds", () => {
    expect(toastVisibleMs("word ".repeat(500), true)).toBe(15_000);
  });

  test("the ring keeps running with reduced motion, because its end closes the toast", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(toastStyles)?.[0] ?? "";
    expect(reduced).not.toContain("toast-timer");
  });
});
