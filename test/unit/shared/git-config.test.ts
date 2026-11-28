import { describe, expect, test } from "bun:test";
import { withGitConfig } from "../../../src/shared/git-config.ts";

describe("withGitConfig", () => {
  test("adds each entry as a numbered setting", () => {
    expect(withGitConfig({ PATH: "/bin" }, [["core.fsmonitor", "false"]])).toEqual({
      PATH: "/bin",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
    });
  });

  test("keeps the settings that the environment already holds, and adds after them", () => {
    const first = withGitConfig({}, [["core.fsmonitor", "false"]]);
    const second = withGitConfig(first, [["core.hooksPath", "/none"]]);
    expect(second).toMatchObject({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/none",
    });
  });

  test("a count that is not a number starts again at zero", () => {
    expect(withGitConfig({ GIT_CONFIG_COUNT: "many" }, [["a.b", "c"]])).toMatchObject({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "a.b",
    });
  });
});
