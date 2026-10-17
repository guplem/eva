/**
 * Captures real Claude Agent SDK output as test fixtures (lesson 101). It runs only with
 * EVA_LIVE=1 and a subscription token in CLAUDE_CODE_OAUTH_TOKEN, against a neutral demo
 * vault and an isolated Claude config folder, so no personal skill, path or setting is
 * recorded. Every absolute path in the output is replaced.
 *
 *   EVA_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... bun run scripts/capture-claude-fixtures.ts
 */
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env["EVA_LIVE"] !== "1") {
  console.log("Set EVA_LIVE=1 to capture fixtures with a real Claude login.");
  process.exit(0);
}
const token = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
// An empty token would make every split() below insert "[token]" between all characters.
if (token === undefined || token.length < 20) throw new Error("CLAUDE_CODE_OAUTH_TOKEN must hold a real token.");
const executable = process.env["EVA_CLAUDE_EXECUTABLE"] ?? Bun.which("claude");
if (executable === null) throw new Error("No claude program on PATH.");

const workRoot = mkdtempSync(join(tmpdir(), "eva-capture-"));
const demoVault = join(workRoot, "demo-vault");
mkdirSync(join(demoVault, "Methods"), { recursive: true });
writeFileSync(join(demoVault, "AGENTS.md"), "# Demo vault\n\nNotes live in Methods/.\n");
writeFileSync(join(demoVault, "Methods", "Morning Routine.md"), "# Morning Routine\n\n1. Drink water.\n2. Stretch.\n");
const fixtureFolder = join(import.meta.dir, "..", "test", "fixtures", "claude-code");
mkdirSync(fixtureFolder, { recursive: true });

const environment: Record<string, string> = {
  CLAUDE_CODE_OAUTH_TOKEN: token,
  CLAUDE_CONFIG_DIR: join(workRoot, "claude-config"),
  PATH: process.env["PATH"] ?? "",
};
for (const name of [
  "SYSTEMROOT",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "COMSPEC",
  "PATHEXT",
]) {
  const value = process.env[name];
  if (value !== undefined) environment[name] = value;
}

const common: Options = {
  cwd: demoVault,
  pathToClaudeCodeExecutable: executable,
  model: "haiku",
  env: environment,
  settingSources: [],
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "Answer in one short sentence.",
    excludeDynamicSections: true,
  },
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
};

interface Capture {
  readonly name: string;
  readonly prompt: string;
  readonly options: Options;
}

const sessionId = crypto.randomUUID();
const captures: Capture[] = [
  {
    name: "new-turn-with-tool",
    prompt: "Read Methods/Morning Routine.md and tell me its first step.",
    options: { ...common, sessionId },
  },
  { name: "resumed-turn", prompt: "And the second step?", options: { ...common, resume: sessionId } },
  { name: "missing-session", prompt: "Hello.", options: { ...common, resume: crypto.randomUUID() } },
  {
    name: "subagent-task",
    prompt:
      "Start one subagent with the Agent tool, in the foreground, not in the background. It reads Methods/Morning Routine.md and reports the title.",
    options: { ...common, sessionId: crypto.randomUUID() },
  },
];

const replacements: [string, string][] = [];
function sanitize(text: string): string {
  let result = text;
  for (const [from, to] of replacements) result = result.split(from).join(to);
  return result;
}

for (const capture of captures) {
  const lines: string[] = [];
  try {
    for await (const message of query({
      prompt: capture.prompt,
      options: capture.options,
    }) as AsyncIterable<SDKMessage>) {
      lines.push(JSON.stringify(message));
    }
  } catch (error) {
    lines.push(
      JSON.stringify({ type: "eva_capture_error", message: error instanceof Error ? error.message : String(error) }),
    );
  }
  replacements.push(
    [demoVault.replaceAll("\\", "\\\\"), "/demo-vault"],
    [demoVault, "/demo-vault"],
    [workRoot.replaceAll("\\", "\\\\"), "/capture"],
    [workRoot, "/capture"],
    // Claude names its project folders after the path, with each other character as "-".
    [workRoot.replace(/[^a-zA-Z0-9]/g, "-"), "-capture"],
    [token, "[token]"],
  );
  const home = process.env["USERPROFILE"] ?? process.env["HOME"];
  if (home !== undefined) replacements.push([home.replaceAll("\\", "\\\\"), "/home/demo"], [home, "/home/demo"]);
  writeFileSync(join(fixtureFolder, `${capture.name}.jsonl`), sanitize(lines.join("\n")) + "\n");
  console.log(`captured ${capture.name}: ${String(lines.length)} messages`);
}

rmSync(workRoot, { recursive: true, force: true });
