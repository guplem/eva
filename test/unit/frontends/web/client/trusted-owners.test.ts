import { describe, expect, test } from "bun:test";
import { withOwner, withoutOwner } from "../../../../../src/frontends/web/client/trusted-owners.ts";

describe("trusted owners", () => {
  test("adds a typed name, a name with @ and a pasted address", () => {
    expect(withOwner([], " example-org ")).toEqual({ owners: ["example-org"] });
    expect(withOwner(["a"], "@example-user")).toEqual({ owners: ["a", "example-user"] });
    expect(withOwner([], "https://github.com/example-org/")).toEqual({ owners: ["example-org"] });
  });

  test("refuses a name that GitHub never gives, and a name in the list already", () => {
    expect(withOwner([], "")).toEqual({ problem: "An empty name is not a GitHub account name." });
    expect(withOwner([], "two words")).toEqual({ problem: "two words is not a GitHub account name." });
    expect("problem" in withOwner([], "owner/repo")).toBe(true);
    expect("problem" in withOwner([], "-start")).toBe(true);
    expect(withOwner(["Example-Org"], "example-org")).toEqual({ problem: "example-org is in the list already." });
  });

  test("removes an owner", () => {
    expect(withoutOwner(["a", "b"], "a")).toEqual(["b"]);
  });
});
