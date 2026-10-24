/**
 * `bun run smoke:live`: two real Claude Code turns through Eva's own adapter,
 * in a neutral demo vault with an isolated Claude config folder. It checks one turn end per
 * turn, that the second turn continues the first, and that the prompt cache answers.
 * It needs a subscription token from `claude setup-token`; without one it says so and stops.
 *
 *   CLAUDE_CODE_OAUTH_TOKEN=... bun run smoke:live
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeEngine } from "../src/engines/claude-code/claude-code-adapter.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment } from "../src/shared/environment.ts";
import type { TurnHistory, TurnRequest } from "../src/shared/engine-port.ts";
import type { EngineEventPayload } from "../src/shared/events.ts";

const token = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
if (token === undefined || token.length < 20) {
  console.log("No CLAUDE_CODE_OAUTH_TOKEN: skipped. Run `claude setup-token` and pass the token to run it.");
  process.exit(0);
}
const executable = process.env["EVA_CLAUDE_EXECUTABLE"] ?? Bun.which("claude");
if (executable === null) throw new Error("No claude program on PATH.");

const workRoot = mkdtempSync(join(tmpdir(), "eva-smoke-"));
const vault = join(workRoot, "demo-vault");
mkdirSync(join(vault, "Methods"), { recursive: true });
writeFileSync(join(vault, "AGENTS.md"), "# Demo vault\n\nNotes live in Methods/.\n");
writeFileSync(join(vault, "Methods", "Morning Routine.md"), "# Morning Routine\n\n1. Drink water.\n2. Stretch.\n");

const environment = buildChildEnvironment(process.env, baseEnvironmentAllowlist, {
  CLAUDE_CODE_OAUTH_TOKEN: token,
  CLAUDE_CONFIG_DIR: join(workRoot, "claude-config"),
});
const engine = new ClaudeCodeEngine({ executable });
const sessionId = crypto.randomUUID();

async function turn(prompt: string, history: TurnHistory): Promise<EngineEventPayload[]> {
  const request: TurnRequest = {
    mode: "assistant",
    history,
    startFolder: vault,
    prompt,
    model: "haiku",
    effort: "default",
    appendSystemPrompt: "Answer in one short sentence.",
    pluginFolders: [],
    mcpServers: {},
    trusted: true,
    environment,
    requestApproval: () => Promise.resolve("deny"),
    askQuestions: () => Promise.resolve("declined"),
    signal: AbortSignal.timeout(180_000),
  };
  const events: EngineEventPayload[] = [];
  for await (const event of engine.runTurn(request)) events.push(event);
  return events;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`smoke:live failed: ${message}`);
  console.log(`ok   ${message}`);
}

try {
  const first = await turn("Read Methods/Morning Routine.md and tell me its first step.", {
    kind: "new",
    engineSessionId: sessionId,
  });
  const firstEnd = first.at(-1);
  check(
    first.filter((event) => event.kind === "turn_finished" || event.kind === "turn_failed").length === 1,
    "one turn end",
  );
  check(firstEnd?.kind === "turn_finished", `the first turn finished (${JSON.stringify(firstEnd)})`);
  check(
    first.some((event) => event.kind === "tool_started"),
    "the first turn used a tool",
  );

  const second = await turn("And the second step?", { kind: "continue", engineSessionId: sessionId });
  const secondEnd = second.at(-1);
  check(secondEnd?.kind === "turn_finished", "the second turn continued the session");
  const cacheRead = secondEnd?.kind === "turn_finished" ? secondEnd.usage.cacheReadTokens : 0;
  check(cacheRead > 0, `the prompt cache answered (${String(cacheRead)} tokens read)`);
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
