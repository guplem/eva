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
import { evaRepository } from "../../src/shared/version.ts";
import { FakeEngine } from "../support/fake-engine.ts";
import { fakeGithub } from "../support/fake-github.ts";
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
  `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${appRemote.remote}\n  - https://github.com/example-owner/example-app\n---\n# Example app\n`,
);
sandbox.write(vault, "Projects/2019-03-old-tool/AGENTS.md", "---\ncreated: 2019-03\nstatus: closed\n---\n# Old tool\n");
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
  if (lastLine.includes("list")) {
    yield* FakeEngine.answer(request, "Two steps:\n- first\n- second\n\nDone.");
    return;
  }
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
  // The reference has a skill that the project's repository lacks, and auto-merge is off there.
  githubGet: fakeGithub({
    [evaRepository]: {
      repository: { allow_auto_merge: true },
      files: {
        "AGENTS.md": "# Rules\n",
        ".agents/skills/write-commit/SKILL.md": "# Commits\n",
        ".claude/settings.json": '{"permissions":{"allow":["Read"]}}',
      },
      labels: ["bug"],
    },
    "example-owner/example-app": {
      repository: { allow_auto_merge: false },
      files: { "AGENTS.md": "# Rules\n" },
      labels: ["bug"],
    },
  }),
});
startLocalApi({ eva, port: demoPort, token: demoToken, extraHosts: [], allowedTailscaleIdentities: [] });
process.stdout.write(`Eva demo ready on http://127.0.0.1:${String(demoPort)}\n`);
