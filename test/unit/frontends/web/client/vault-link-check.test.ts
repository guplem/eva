import { describe, expect, test } from "bun:test";
import {
  maxPathsPerAsk,
  missingAnswerMs,
  missingPathsChecker,
} from "../../../../../src/frontends/web/client/vault-link-check.ts";

describe("missingPathsChecker (#932)", () => {
  test("answers the paths that the core does not name as existing", async () => {
    const check = missingPathsChecker((paths) => Promise.resolve(paths.filter((path) => path !== "Burocracia")));
    expect(await check.missing(["Methods", "Burocracia"])).toEqual(new Set(["Burocracia"]));
  });

  test("asks the core once for each path while the answer holds", async () => {
    const asked: string[][] = [];
    const check = missingPathsChecker((paths) => {
      asked.push([...paths]);
      return Promise.resolve(paths.filter((path) => path === "Methods"));
    });
    const first = check.missing(["Methods", "Gone"]);
    const second = check.missing(["Methods", "Gone", "Methods", "Life"]);
    expect(await first).toEqual(new Set(["Gone"]));
    expect(await second).toEqual(new Set(["Gone", "Life"]));
    expect(await check.missing(["Methods", "Gone"])).toEqual(new Set(["Gone"]));
    expect(await check.missing([])).toEqual(new Set());
    expect(asked).toEqual([["Methods", "Gone"], ["Life"]]);
  });

  test("knows a missing path at once, with no request, so a new render hides it before it paints", async () => {
    const check = missingPathsChecker((paths) => Promise.resolve(paths.filter((path) => path === "Methods")));
    expect(check.knownMissing(["Gone"])).toEqual(new Set());
    await check.missing(["Methods", "Gone"]);
    expect(check.knownMissing(["Methods", "Gone", "Life"])).toEqual(new Set(["Gone"]));
  });

  test("asks again about a missing path after a while: a turn can create the file", async () => {
    let time = 0;
    let exists = false;
    const check = missingPathsChecker(
      (paths) => Promise.resolve(exists ? paths : []),
      () => time,
    );
    expect(await check.missing(["Notes/plan.md"])).toEqual(new Set(["Notes/plan.md"]));
    exists = true;
    time = missingAnswerMs - 1;
    expect(await check.missing(["Notes/plan.md"])).toEqual(new Set(["Notes/plan.md"]));
    time = missingAnswerMs;
    expect(check.knownMissing(["Notes/plan.md"])).toEqual(new Set());
    expect(await check.missing(["Notes/plan.md"])).toEqual(new Set());
  });

  test("keeps every link when the core does not answer, and asks again later", async () => {
    let calls = 0;
    const check = missingPathsChecker(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve([]);
    });
    expect(await check.missing(["Gone"])).toEqual(new Set());
    expect(await check.missing(["Gone"])).toEqual(new Set(["Gone"]));
  });

  test("splits a long list into requests that the core takes", async () => {
    const sizes: number[] = [];
    const check = missingPathsChecker((paths) => {
      sizes.push(paths.length);
      return Promise.resolve(paths);
    });
    const paths = Array.from({ length: maxPathsPerAsk + 1 }, (_, index) => `Notes/${String(index)}.md`);
    expect(await check.missing(paths)).toEqual(new Set());
    expect(sizes).toEqual([maxPathsPerAsk, 1]);
  });
});
