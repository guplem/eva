import { describe, expect, test } from "bun:test";
import { cliCommands, parseArguments, usageText } from "../../../../src/frontends/cli/arguments.ts";

/** The command phrases of the usage text: the words before the first placeholder or description. */
function usagePhrases(): string[] {
  const section = usageText.slice(usageText.indexOf("Commands:"));
  return section
    .split("\n")
    .flatMap((line) => /^ {2}([a-z][a-z-]*(?: [a-z]+)*)/.exec(line)?.[1] ?? [])
    .sort();
}

describe("vault-upgrade", () => {
  test("takes one of its four steps (#773)", () => {
    expect(parseArguments(["vault-upgrade", "finish"])).toEqual({
      command: "vault-upgrade",
      instance: undefined,
      action: "finish",
    });
    expect(parseArguments(["vault-upgrade"]).command).toBe("usage-error");
    expect(parseArguments(["vault-upgrade", "later"]).command).toBe("usage-error");
  });
});

describe("help and version flags", () => {
  test.each([["--help"], ["-h"]])("%s shows the help, like the word help (#1067)", (flag) => {
    expect(parseArguments([flag])).toEqual({ command: "help", instance: undefined });
    expect(parseArguments(["chat", flag])).toEqual({ command: "help", instance: undefined });
    expect(parseArguments(["--instance", "work", flag])).toEqual({ command: "help", instance: "work" });
  });

  test.each([["--version"], ["-v"]])("%s shows the version, like the word version (#1067)", (flag) => {
    expect(parseArguments([flag])).toEqual({ command: "version", instance: undefined });
    expect(parseArguments([flag, "--instance", "work"])).toEqual({ command: "version", instance: "work" });
  });
});

describe("a short flag in free text", () => {
  // A request or a value can hold the word `-v` or `-h` (#1079).
  test("stays a word of the request of work", () => {
    expect(parseArguments(["work", "example-app", "add", "a", "-v", "flag"])).toEqual({
      command: "work",
      instance: undefined,
      projectId: "example-app",
      request: "add a -v flag",
    });
  });

  test("stays a word of a setting's value and of a project search", () => {
    expect(parseArguments(["settings", "set", "some.key", "-h"])).toMatchObject({ command: "settings", value: "-h" });
    expect(parseArguments(["projects", "cli", "-v"])).toMatchObject({ command: "projects", query: "cli -v" });
  });

  test("is still a flag before the free text starts", () => {
    expect(parseArguments(["projects", "-h"]).command).toBe("help");
    expect(parseArguments(["projects", "-v"]).command).toBe("version");
    expect(parseArguments(["settings", "-h"]).command).toBe("help");
    expect(parseArguments(["settings", "get", "-h"]).command).toBe("help");
    expect(parseArguments(["settings", "set", "-h"]).command).toBe("help");
    expect(parseArguments(["work", "-h"]).command).toBe("help");
  });

  test("the long flags still show the help and the version there", () => {
    expect(parseArguments(["work", "example-app", "--help"]).command).toBe("help");
    expect(parseArguments(["projects", "--version"]).command).toBe("version");
  });
});

describe("cliCommands", () => {
  test("lists each command of the usage text, and no other", () => {
    expect([...cliCommands].sort()).toEqual(usagePhrases());
  });

  // A command takes no value, one value, two values such as `work <project> <request>`, or a version.
  const valueShapes = [[], ["value"], ["value", "more"], ["1.2.0"]];

  test.each(cliCommands)("%s parses to a command", (phrase) => {
    const words = phrase.split(" ");
    const parses = valueShapes.some((values) => parseArguments([...words, ...values]).command !== "usage-error");
    expect(parses).toBe(true);
  });
});
