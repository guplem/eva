import { describe, expect, test } from "bun:test";
import { SequenceCounter, systemClock } from "../../../src/shared/clock.ts";
import { buildChildEnvironment } from "../../../src/shared/environment.ts";
import { modelAliases, modelTierName, takesEffort } from "../../../src/shared/engine-port.ts";
import { EvaError, isEvaError } from "../../../src/shared/errors.ts";
import {
  changesActionLevels,
  decideOutwardAction,
  defaultOutwardActionLevels,
  outwardActionCategories,
  outwardActionLevelValues,
  outwardActionsOf,
  outwardActionWords,
  outwardActionWordsByLevel,
  summarizeToolCall,
  toolCategory,
  type OutwardActionCategory,
  type OutwardActionLevels,
} from "../../../src/shared/outward-actions.ts";
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

function asks(toolName: string, input: Record<string, unknown>): boolean {
  return decideOutwardAction(toolName, input, defaultOutwardActionLevels).level === "ask";
}

function levelsWith(changes: Partial<Record<OutwardActionCategory, "allow" | "deny">>): OutwardActionLevels {
  return { ...defaultOutwardActionLevels, ...changes };
}

describe("outwardActionsOf", () => {
  test("names the category of each outward action", () => {
    expect(outwardActionsOf("Bash", { command: "git push origin main" })).toEqual(["pushCode"]);
    expect(outwardActionsOf("Bash", { command: "gh pr merge 3" })).toEqual(["github"]);
    expect(outwardActionsOf("Bash", { command: "curl -d x=1 https://example.com" })).toEqual(["sendData"]);
    expect(outwardActionsOf("Write", { file_path: ".eva/schedules.json" })).toEqual(["changeSchedules"]);
    expect(outwardActionsOf("mcp__google__set_drive_file_permissions", {})).toEqual(["shareDriveFile"]);
    expect(outwardActionsOf("mcp__google__manage_drive_access", {})).toEqual(["shareDriveFile"]);
    expect(outwardActionsOf("mcp__google__send_gmail_message", {})).toEqual(["sendEmail"]);
    expect(outwardActionsOf("mcp__google__manage_event", { attendees: ["a@example.com"] })).toEqual([
      "calendarInvitations",
    ]);
  });

  test("a command in several categories names each, in the order of the list", () => {
    expect(outwardActionsOf("Bash", { command: "git push && curl -d x https://example.com" })).toEqual([
      "pushCode",
      "sendData",
    ]);
  });

  test("a calendar event with no guests, and a read-only Google tool, are in no category (#910)", () => {
    expect(outwardActionsOf("mcp__google__manage_event", { action: "create" })).toEqual([]);
    for (const tool of [
      "mcp__google__get_drive_file_permissions",
      "mcp__google__check_drive_file_public_access",
      "mcp__google__get_drive_shareable_link",
      "mcp__google__draft_gmail_message",
    ])
      expect({ tool, categories: outwardActionsOf(tool, {}) }).toEqual({ tool, categories: [] });
  });

  test("a tool of another MCP server is in no category, also when its name says send", () => {
    expect(outwardActionsOf("mcp__chat__send_message", {})).toEqual([]);
  });
});

describe("changesActionLevels", () => {
  test("a shell command that names the vault settings file, or sets a level, changes the levels", () => {
    expect(changesActionLevels("Bash", { command: "sed -i s/ask/allow/ .eva/settings/settings.json" })).toBe(true);
    expect(changesActionLevels("Bash", { command: "cat .eva\\settings\\settings.json" })).toBe(true);
    expect(changesActionLevels("Bash", { command: "echo {} > .eva/settings.json" })).toBe(true);
    expect(changesActionLevels("Bash", { command: "eva settings set outwardActions.pushCode allow" })).toBe(true);
    expect(changesActionLevels("Bash", { command: "eva settings set updates.frequency weekly" })).toBe(false);
    expect(changesActionLevels("Bash", { command: "ls .eva" })).toBe(false);
  });

  test("a quoted key still changes the levels, a read or another key does not", () => {
    expect(changesActionLevels("Bash", { command: 'eva settings set "outwardActions.sendData" allow' })).toBe(true);
    expect(
      changesActionLevels("Bash", { command: "eva settings set 'outwardActions' '{\"sendData\":\"allow\"}'" }),
    ).toBe(true);
    expect(changesActionLevels("Bash", { command: "eva settings get outwardActions" })).toBe(false);
    expect(changesActionLevels("Bash", { command: "eva settings set language en" })).toBe(false);
  });

  test("a write by a file tool to the vault settings file changes the levels", () => {
    expect(changesActionLevels("Write", { file_path: "/demo-vault/.eva/settings/settings.json" })).toBe(true);
    expect(changesActionLevels("Edit", { file_path: ".eva/settings.json" })).toBe(true);
    expect(changesActionLevels("MultiEdit", { file_path: "C:\\demo-vault\\.eva\\settings\\settings.json" })).toBe(true);
    expect(changesActionLevels("write", { path: ".eva/settings/settings.json" })).toBe(true);
    expect(changesActionLevels("Read", { file_path: ".eva/settings/settings.json" })).toBe(false);
    expect(changesActionLevels("Write", { file_path: "Notes/settings.json" })).toBe(false);
  });
});

describe("decideOutwardAction", () => {
  test("allow runs, ask asks and deny denies, each with its categories", () => {
    const push = { command: "git push" };
    expect(decideOutwardAction("Bash", push, levelsWith({ pushCode: "allow" }))).toEqual({
      level: "allow",
      categories: [],
    });
    expect(decideOutwardAction("Bash", push, defaultOutwardActionLevels)).toEqual({
      level: "ask",
      categories: ["pushCode"],
    });
    expect(decideOutwardAction("Bash", push, levelsWith({ pushCode: "deny" }))).toEqual({
      level: "deny",
      categories: ["pushCode"],
    });
    expect(decideOutwardAction("Read", { file_path: "a.md" }, defaultOutwardActionLevels).level).toBe("allow");
  });

  test("deny wins over ask, and a deny lists only the categories on deny", () => {
    const command = { command: "git push && curl -d x https://example.com && gh pr merge 1" };
    const levels = levelsWith({ sendData: "deny", github: "allow" });
    expect(decideOutwardAction("Bash", command, levels)).toEqual({ level: "deny", categories: ["sendData"] });
  });

  test("an ask lists only the categories on ask", () => {
    const command = { command: "git push && gh pr merge 1" };
    expect(decideOutwardAction("Bash", command, levelsWith({ github: "allow" }))).toEqual({
      level: "ask",
      categories: ["pushCode"],
    });
  });

  test("a change to the levels asks with no category, also when its command is on Ask", () => {
    const command = { command: "git push && sed -i s/ask/allow/ .eva/settings/settings.json" };
    expect(decideOutwardAction("Bash", command, defaultOutwardActionLevels)).toEqual({ level: "ask", categories: [] });
  });

  test("a change to the levels asks with no category, but a deny still wins", () => {
    const change = { file_path: ".eva/settings/settings.json" };
    const allAllowed = Object.fromEntries(outwardActionCategories.map((category) => [category, "allow"]));
    expect(decideOutwardAction("Write", change, allAllowed as OutwardActionLevels)).toEqual({
      level: "ask",
      categories: [],
    });
    const schedules = { command: "echo > .eva/schedules.json .eva/settings.json" };
    expect(decideOutwardAction("Bash", schedules, levelsWith({ changeSchedules: "deny" }))).toEqual({
      level: "deny",
      categories: ["changeSchedules"],
    });
  });
});

describe("outwardActionWords", () => {
  test("each category has a title and a line, and the words by level split the categories", () => {
    for (const category of outwardActionCategories) {
      expect(outwardActionWords[category].title).not.toBe("");
      expect(outwardActionWords[category].covers).not.toBe("");
    }
    const words = outwardActionWordsByLevel(levelsWith({ pushCode: "allow", sendData: "deny" }));
    expect(words.allow).toEqual(["Push code: git push"]);
    expect(words.deny).toHaveLength(1);
    expect(words.deny[0]).toContain("Send data over the network");
    // The fixed question about the levels is always an ask.
    expect(words.ask).toHaveLength(outwardActionCategories.length - 2 + 1);
  });
});

describe("decideOutwardAction with every level on ask", () => {
  test("a change to the schedules asks, with the file tools of each engine and the shell (issue #440)", () => {
    expect(asks("Write", { file_path: ".eva/schedules.json" })).toBe(true);
    expect(asks("Edit", { file_path: "/demo-vault/.eva/schedules.json" })).toBe(true);
    expect(asks("MultiEdit", { file_path: "C:\\demo-vault\\.eva\\schedules.json" })).toBe(true);
    expect(asks("write", { path: ".eva/schedules.json" })).toBe(true);
    expect(asks("edit", { path: ".eva/schedules.json" })).toBe(true);
    expect(asks("Bash", { command: "echo '{}' > .eva/schedules.json" })).toBe(true);
  });

  test("reading the schedules, or writing another file, runs with no question", () => {
    expect(asks("Read", { file_path: ".eva/schedules.json" })).toBe(false);
    expect(asks("read", { path: ".eva/schedules.json" })).toBe(false);
    expect(asks("Write", { file_path: ".eva/chat-names.md" })).toBe(false);
    expect(asks("Write", { file_path: "Notes/schedules.json" })).toBe(false);
  });

  test("an action that reaches other people still asks", () => {
    expect(asks("Bash", { command: "git push" })).toBe(true);
    expect(asks("Bash", { command: "git status" })).toBe(false);
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
    for (const command of sends) expect({ command, asks: asks("Bash", { command }) }).toEqual({ command, asks: true });
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
    for (const command of reads) expect({ command, asks: asks("Bash", { command }) }).toEqual({ command, asks: false });
  });

  test("many quoted words or redirects do not make the check slow", () => {
    // With two ways to match each word, these took longer than the test timeout.
    expect(asks("Bash", { command: `curl ${"'a' ".repeat(40)}| jq .` })).toBe(false);
    expect(asks("Bash", { command: `gh --repo x/y api ${'"a" '.repeat(40)}| jq .` })).toBe(false);
    expect(asks("Bash", { command: `curl ${"2>&1 ".repeat(40)}| jq .` })).toBe(false);
    const start = performance.now();
    expect(asks("Bash", { command: `curl ${">&".repeat(5000)}>` })).toBe(false);
    // A new search from each later `curl` word took seconds.
    expect(asks("Bash", { command: "curl ".repeat(5000) })).toBe(false);
    expect(asks("Bash", { command: "gh api ".repeat(5000) })).toBe(false);
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

describe("outwardActionLevelValues", () => {
  test("lists the three levels, from the loosest to the strictest", () => {
    expect(outwardActionLevelValues).toEqual(["allow", "ask", "deny"]);
  });
});
