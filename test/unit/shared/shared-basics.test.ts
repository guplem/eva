import { describe, expect, test } from "bun:test";
import { SequenceCounter, systemClock } from "../../../src/shared/clock.ts";
import { buildChildEnvironment } from "../../../src/shared/environment.ts";
import { modelAliases, modelTierName, takesEffort } from "../../../src/shared/engine-port.ts";
import { EvaError, isEvaError } from "../../../src/shared/errors.ts";
import { asksThePerson, summarizeToolCall, toolCategory } from "../../../src/shared/outward-actions.ts";
import { containsSecretPattern, Redactor } from "../../../src/shared/redaction.ts";

describe("EvaError", () => {
  test("carries a code that isEvaError can check", () => {
    const error = new EvaError("git_failed", "push refused");
    expect(isEvaError(error)).toBe(true);
    expect(isEvaError(error, "git_failed")).toBe(true);
    expect(isEvaError(error, "config_invalid")).toBe(false);
    expect(isEvaError(new Error("other"))).toBe(false);
    expect(error.name).toBe("EvaError");
  });
});

describe("toolCategory", () => {
  test("the shell tool of each engine is a command, and every other tool is a tool", () => {
    expect(toolCategory("Bash")).toBe("command");
    expect(toolCategory("bash")).toBe("command");
    expect(toolCategory("Read")).toBe("tool");
    expect(toolCategory("Agent")).toBe("tool");
  });
});

describe("asksThePerson", () => {
  test("a change to the schedules asks, with the file tools of each engine and the shell (issue #440)", () => {
    expect(asksThePerson("Write", { file_path: ".eva/schedules.json" })).toBe(true);
    expect(asksThePerson("Edit", { file_path: "/demo-vault/.eva/schedules.json" })).toBe(true);
    expect(asksThePerson("MultiEdit", { file_path: "C:\\demo-vault\\.eva\\schedules.json" })).toBe(true);
    expect(asksThePerson("write", { path: ".eva/schedules.json" })).toBe(true);
    expect(asksThePerson("edit", { path: ".eva/schedules.json" })).toBe(true);
    expect(asksThePerson("Bash", { command: "echo '{}' > .eva/schedules.json" })).toBe(true);
  });

  test("reading the schedules, or writing another file, runs with no question", () => {
    expect(asksThePerson("Read", { file_path: ".eva/schedules.json" })).toBe(false);
    expect(asksThePerson("read", { path: ".eva/schedules.json" })).toBe(false);
    expect(asksThePerson("Write", { file_path: ".eva/chat-names.md" })).toBe(false);
    expect(asksThePerson("Write", { file_path: "Notes/schedules.json" })).toBe(false);
  });

  test("an action that reaches other people still asks", () => {
    expect(asksThePerson("Bash", { command: "git push" })).toBe(true);
    expect(asksThePerson("Bash", { command: "git status" })).toBe(false);
  });

  test("curl or gh api that sends data asks, with or without -X (issue #451)", () => {
    const sends = [
      "curl -d x=1 https://example.com",
      "curl -sd x https://example.com",
      "curl -d@body.json https://example.com",
      "curl --data-urlencode a=b https://example.com",
      "curl --json '{}' https://example.com",
      "curl -F f=@a.png https://example.com",
      "curl --form-string a=b https://example.com",
      "curl -T a.txt https://example.com",
      "curl --upload-file a.txt https://example.com",
      "curl -X POST https://example.com",
      "curl -XDELETE https://example.com",
      "curl --request PUT https://example.com",
      "curl -G -d q=x https://example.com",
      "curl 'https://example.com/?a=1&b=2' -d x",
      "cd demo && curl -d x https://example.com | jq .",
      "curl.exe -d x https://example.com",
      "gh api repos/x/y/issues -f title=t",
      "gh api repos/x/y -F n=1",
      "gh api repos/x/y --field a=b",
      "gh api repos/x/y --raw-field=a=b",
      "gh api repos/x/y --input body.json",
      "gh api -X PATCH repos/x/y",
      "gh api --method=DELETE repos/x/y",
      "gh api -XPOST repos/x/y",
      "gh api -X GET search/issues -f q=x",
      "gh api graphql -f query='{viewer{login}}'",
      // A backslash at the end of a line continues the same command.
      "curl -s https://example.com \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'",
      "gh api repos/x/y/issues \\\r\n  -f title=t",
      // A redirect or an escaped `&` does not end the command.
      "curl https://example.com 2>&1 -d x",
      "curl https://example.com &>/dev/null -d x",
      "curl https://example.com/?a=1\\&b=2 -d x",
      "curl -H 'it's' https://example.com -d x",
      // curl takes a unique start of a long option, such as --jso for --json.
      "curl --jso '{}' https://example.com",
      "curl --form-s a=b https://example.com",
      "curl --req POST https://example.com",
      // A config file can hold data or a method.
      "curl -K request.cfg https://example.com",
      "curl --config request.cfg https://example.com",
      'curl -X "$METHOD" https://example.com',
      "gh --repo x/y api repos/x/y -f a=b",
      "gh --repo 'x y' api repos/x/y -f a=b",
      "gh.exe api repos/x/y -f a=b",
      // A continued line with no indent, and a `|` inside a command substitution.
      "curl https://example.com \\\n-d x",
      "gh api repos/x/y \\\n-f a=b",
      "curl $(echo u | tr a b) -d x",
      "curl `echo u | tr a b` -d x",
      // curl 8.3 and later can expand variables in each option.
      "curl --expand-data '{{a}}' https://example.com",
    ];
    for (const command of sends)
      expect({ command, asks: asksThePerson("Bash", { command }) }).toEqual({ command, asks: true });
  });

  test("curl or gh api that only reads runs with no question, also when a later command has a data-like flag", () => {
    const reads = [
      "curl https://example.com",
      "curl -sSfL https://example.com",
      "curl -fsSL https://example.com -o out.html",
      "curl -I https://example.com",
      "curl -X GET https://example.com",
      "curl -L -X HEAD https://example.com",
      "curl -s https://example.com 2>&1",
      "curl -H 'Accept: text/html' https://example.com",
      "curl --dump-header - https://example.com",
      "curl --connect-timeout 5 https://example.com",
      "curl 'https://example.com/?a=1&b=2'",
      "curl https://example.com/data-file",
      "gh api repos/x/y",
      "gh api repos/x/y --jq .name",
      "gh api -X GET repos/x/y",
      "gh api --method=GET repos/x/y",
      "curl -X=GET https://example.com",
      "curl --request-target /x https://example.com",
      "curl --follow https://example.com",
      "gh api --paginate repos/x/y/issues",
      "gh api repos/x/y-fix",
      "curl https://example.com | jq -f prog.jq",
      "gh api repos/x/y | grep -F y",
      "curl https://example.com; tar -xf a.tar",
      "curl https://example.com || rm -f x",
      "curl https://example.com\ngrep -F x notes.md",
    ];
    for (const command of reads)
      expect({ command, asks: asksThePerson("Bash", { command }) }).toEqual({ command, asks: false });
  });

  test("many quoted words or redirects do not make the check slow", () => {
    // With two ways to match each word, these took longer than the test timeout.
    expect(asksThePerson("Bash", { command: `curl ${"'a' ".repeat(40)}| jq .` })).toBe(false);
    expect(asksThePerson("Bash", { command: `gh --repo x/y api ${'"a" '.repeat(40)}| jq .` })).toBe(false);
    expect(asksThePerson("Bash", { command: `curl ${"2>&1 ".repeat(40)}| jq .` })).toBe(false);
    const start = performance.now();
    expect(asksThePerson("Bash", { command: `curl ${">&".repeat(5000)}>` })).toBe(false);
    // A new search from each later `curl` word took seconds.
    expect(asksThePerson("Bash", { command: "curl ".repeat(5000) })).toBe(false);
    expect(asksThePerson("Bash", { command: "gh api ".repeat(5000) })).toBe(false);
    // Two ways to match `>&>` made the first command take about one second.
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("summarizeToolCall", () => {
  test("names a skill by its name, not by its input as JSON", () => {
    expect(summarizeToolCall("Skill", { skill: "eva:about-me" })).toBe("Skill eva:about-me");
  });
});

describe("clock", () => {
  test("the system clock returns the current time", () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  test("a sequence counter only grows", () => {
    const counter = new SequenceCounter();
    expect([counter.next(), counter.next(), counter.next()]).toEqual([1, 2, 3]);
  });
});

describe("buildChildEnvironment", () => {
  test("keeps only allowlisted variables and adds the extras", () => {
    const environment = buildChildEnvironment(
      { PATH: "/bin", TELEGRAM_BOT_TOKEN: "secret", HOME: "/h", EMPTY: undefined },
      ["PATH", "HOME", "EMPTY"],
      { CLAUDE_CONFIG_DIR: "/c", SKIPPED: undefined },
    );
    expect(environment).toEqual({ PATH: "/bin", HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
  });

  test("an extra value wins over the inherited one", () => {
    expect(buildChildEnvironment({ HOME: "/old" }, ["HOME"], { HOME: "/new" })).toEqual({ HOME: "/new" });
  });

  // Bun's process.env on Windows finds `Path` under every case, as Windows does.
  const windowsEnvironment = (values: Record<string, string>): Record<string, string | undefined> =>
    new Proxy(values, {
      get: (target, name) => {
        const key = Object.keys(target).find((each) => each.toLowerCase() === String(name).toLowerCase());
        return key === undefined ? undefined : target[key];
      },
    });

  test("on Windows, a child gets one PATH, not both PATH and Path (#430)", () => {
    // Two keys keep git from finding sh.exe for the credential helper: it then ends with 128 and no message.
    const environment = buildChildEnvironment(
      windowsEnvironment({ Path: "C:\\Git\\cmd" }),
      ["PATH", "Path"],
      {},
      "win32",
    );
    expect(Object.keys(environment).filter((name) => name.toLowerCase() === "path")).toHaveLength(1);
    expect(Object.values(environment)).toEqual(["C:\\Git\\cmd"]);
  });

  test("on Windows, an extra value replaces the inherited one in another case", () => {
    const environment = buildChildEnvironment(
      windowsEnvironment({ Path: "C:\\Git\\cmd", SystemRoot: "C:\\Windows" }),
      ["PATH", "Path", "SYSTEMROOT", "SystemRoot"],
      { PATH: "C:\\eva\\bin;C:\\Git\\cmd" },
      "win32",
    );
    expect(environment).toEqual({ PATH: "C:\\eva\\bin;C:\\Git\\cmd", SYSTEMROOT: "C:\\Windows" });
  });

  test("on Linux, PATH and Path stay two variables", () => {
    expect(buildChildEnvironment({ PATH: "/bin", Path: "/other" }, ["PATH", "Path"], {}, "linux")).toEqual({
      PATH: "/bin",
      Path: "/other",
    });
  });
});

describe("Redactor", () => {
  test("replaces a known secret wherever it appears", () => {
    const redactor = new Redactor();
    redactor.addSecret("very-long-secret-value");
    expect(redactor.redact("a very-long-secret-value b very-long-secret-value")).toBe("a [redacted] b [redacted]");
  });

  test("ignores a short value, so normal words stay readable", () => {
    const redactor = new Redactor();
    redactor.addSecret("abc");
    redactor.addSecret(undefined);
    expect(redactor.redact("abc")).toBe("abc");
  });

  test("replaces the longer of two overlapping secrets first", () => {
    const redactor = new Redactor();
    redactor.addSecret("secret-12345");
    redactor.addSecret("secret-12345-and-more");
    redactor.addSecret("secret-12345");
    expect(redactor.redact("x secret-12345-and-more y")).toBe("x [redacted] y");
  });

  test("catches well-known token shapes it was never told about", () => {
    const redactor = new Redactor();
    const telegram = "123456789:" + "A".repeat(35);
    const github = "ghp_" + "b".repeat(36);
    expect(redactor.redact(`token ${telegram} and ${github}`)).toBe("token [redacted] and [redacted]");
  });
});

/** Built from parts, so the repository's secret scanner sees no key header in this file. */
const keyHeader = "-----BEGIN " + "PRIVATE KEY-----";

describe("containsSecretPattern", () => {
  test("finds a private key and an Anthropic token, and nothing in plain prose", () => {
    expect(containsSecretPattern("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecretPattern("key sk-ant-" + "x".repeat(20))).toBe(true);
    expect(containsSecretPattern("A note about keys and tokens.")).toBe(false);
    // Built from parts, so the secret scanner of this repository finds no real-looking token.
    for (const token of [
      "GOCSPX-" + "a".repeat(28),
      "ya29." + "d".repeat(40),
      "1//0" + "e".repeat(40),
      "sk-proj-" + "b".repeat(40),
      "xoxb-" + "1".repeat(12),
      "npm_" + "c".repeat(36),
      keyHeader + "\nMIIE cut short",
    ]) {
      expect(containsSecretPattern(`text ${token} more`)).toBe(true);
    }
    expect(new Redactor().redact(`key: ${keyHeader}\nMIIE`)).toBe("key: [redacted]");
    // A path with a double slash in a note is no Google token.
    expect(containsSecretPattern("see https://example.com/page/1//0" + "f".repeat(40))).toBe(false);
  });

  test("gives the same answer when asked twice", () => {
    const text = "github_pat_" + "c".repeat(30);
    expect(containsSecretPattern(text)).toBe(true);
    expect(containsSecretPattern(text)).toBe(true);
  });
});

describe("model tiers (#550)", () => {
  test("the interface names each model alias by its tier", () => {
    expect(modelAliases.map(modelTierName)).toEqual(["Smart", "Balanced", "Fast"]);
  });

  test("Claude Code's Fast model takes no effort level; every other model does", () => {
    expect(takesEffort("claude-code", "haiku")).toBe(false);
    expect(takesEffort("claude-code", "opus")).toBe(true);
    expect(takesEffort("claude-code", "sonnet")).toBe(true);
    expect(takesEffort("pi", "haiku")).toBe(true);
  });
});
