/** A file that passes, run after a blocked file to show that the run goes on. */
import { expect, test } from "bun:test";

test("passes", () => {
  expect(1).toBe(1);
});
