import { describe, expect, test } from "bun:test";
import { missingPathsChecker } from "../../../../../src/frontends/web/client/vault-link-check.ts";

describe("missingPathsChecker (#932)", () => {
  test("answers the paths that the core does not name as existing", async () => {
    const missing = missingPathsChecker((paths) => Promise.resolve(paths.filter((path) => path !== "Burocracia")));
    expect(await missing(["Methods", "Burocracia"])).toEqual(new Set(["Burocracia"]));
  });

  test("asks the core once for each path, and keeps the answer", async () => {
    const asked: string[][] = [];
    const missing = missingPathsChecker((paths) => {
      asked.push([...paths]);
      return Promise.resolve(paths.filter((path) => path === "Methods"));
    });
    const first = missing(["Methods", "Gone"]);
    const second = missing(["Methods", "Gone", "Methods", "Life"]);
    expect(await first).toEqual(new Set(["Gone"]));
    expect(await second).toEqual(new Set(["Gone", "Life"]));
    expect(asked).toEqual([["Methods", "Gone"], ["Life"]]);
    expect(await missing([])).toEqual(new Set());
    expect(asked).toHaveLength(2);
  });

  test("keeps every link when the core does not answer, and asks again later", async () => {
    let calls = 0;
    const missing = missingPathsChecker(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve([]);
    });
    expect(await missing(["Gone"])).toEqual(new Set());
    expect(await missing(["Gone"])).toEqual(new Set(["Gone"]));
  });
});
