import { describe, expect, test } from "bun:test";
import { repositoryName } from "../../../../src/core/projects/repository-name.ts";

describe("repositoryName", () => {
  test("takes the last path part of a URL, without .git", () => {
    expect(repositoryName("https://github.com/owner/example-app")).toBe("example-app");
    expect(repositoryName("https://github.com/owner/example-app.git/")).toBe("example-app");
    expect(repositoryName("git@github.com:owner/Tool.git")).toBe("Tool");
    expect(repositoryName("C:\\repos\\local.git")).toBe("local");
  });
});
