import { describe, expect, test } from "bun:test";
import { cliCommands, parseArguments, usageText } from "../../../../src/frontends/cli/arguments.ts";

/** The command phrases of the usage text: the words before the first placeholder or description. */
function usagePhrases(): string[] {
  const section = usageText.slice(usageText.indexOf("Commands:"));
  return section
    .split("\n")
    .flatMap((line) => /^ {2}([a-z]+(?: [a-z]+)*)/.exec(line)?.[1] ?? [])
    .sort();
}

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
