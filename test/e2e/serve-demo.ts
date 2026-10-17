/**
 * Starts Eva for the Playwright tests: a neutral demo vault in a temporary folder, a local
 * bare remote, a scripted engine, and the local API on a fixed port. No real login is used.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../src/core/settings/home.ts";
import { assistantBasePrompt } from "../../src/core/modes/assistant-base-prompt.ts";
import { startLocalApi } from "../../src/frontends/api/local-api.ts";
import { systemProcessRunner } from "../../src/shared/process-runner.ts";
import { FakeEngine } from "../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment } from "../support/git-sandbox.ts";

export const demoPort = 7499;
export const demoToken = "e2e-demo-token";

const sandbox = createGitSandbox();
const vault = sandbox.clone("vault");
const appRemote = createGitSandbox();
sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
sandbox.write(
  vault,
  "Projects/2025-03-02-1015-example-app/AGENTS.md",
  `---\ncreated: 2025-03-02T10:15\nstatus: active\ntags: [web]\nrepos:\n  - ${appRemote.remote}\n---\n# Example app\n`,
);
sandbox.write(
  vault,
  "Projects/2019-03-old-tool/AGENTS.md",
  "---\ncreated: 2019-03\nstatus: closed\ntags: [legacy]\n---\n# Old tool\n",
);
sandbox.write(
  vault,
  "Projects/2024-06-01-0900-broken-notes/AGENTS.md",
  "---\ncreated: 2024-06-01T09:00\nstatus: active\nrepos: nope\n---\n# Broken notes\n",
);
sandbox.git(vault, "add", "-A");
sandbox.git(vault, "commit", "-q", "-m", "demo vault");
sandbox.git(vault, "push", "-q", "origin", "main");

const engine = new FakeEngine(async function* (request, turnNumber) {
  const lastLine = request.prompt.split("\n").at(-1) ?? "";
  yield {
    kind: "task_changed",
    taskId: `task-${String(turnNumber)}`,
    description: "Search the notes",
    state: "running",
  };
  yield { kind: "tool_started", toolUseId: `tool-${String(turnNumber)}`, name: "Grep", summary: "Grep notes" };
  yield { kind: "tool_finished", toolUseId: `tool-${String(turnNumber)}`, isError: false };
  if (lastLine.includes("approve")) {
    const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "gh issue create" });
    yield* FakeEngine.answer(request, `The person answered: ${answer}`);
    return;
  }
  yield { kind: "task_changed", taskId: `task-${String(turnNumber)}`, description: "Search the notes", state: "done" };
  yield* FakeEngine.answer(request, `**Echo ${String(turnNumber)}**: ${lastLine}`);
});

const home = mkdtempSync(join(tmpdir(), "eva-e2e-home-"));
const eva = new Eva({
  paths: homePaths(home),
  config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
  secrets: { localApiToken: demoToken },
  engines: [engine],
  runner: systemProcessRunner,
  processEnvironment: gitEnvironment,
  now: () => new Date(),
  basePrompt: assistantBasePrompt,
  gatherMs: 20,
});
startLocalApi({ eva, port: demoPort, token: demoToken, extraHosts: [], allowedTailscaleIdentities: [] });
process.stdout.write(`Eva demo ready on http://127.0.0.1:${String(demoPort)}\n`);
