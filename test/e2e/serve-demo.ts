/**
 * Starts Eva for the Playwright tests: a neutral demo vault in a temporary folder, a local bare
 * remote, a scripted engine, and the local API on the ports of `e2e-ports.ts`. No real login is used.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../src/core/settings/home.ts";
import { assistantBasePrompt } from "../../src/core/modes/assistant-base-prompt.ts";
import { templateParts } from "../../src/core/vault/vault-template.ts";
import { startLocalApi } from "../../src/frontends/api/local-api.ts";
import { systemProcessRunner, type ProcessRunner } from "../../src/shared/process-runner.ts";
import { evaRepository } from "../../src/shared/version.ts";
import type { PermissionContext } from "../../src/shared/permissions.ts";
import { describeClaudePermissions } from "../../src/engines/claude-code/claude-code-permissions.ts";
import { FakeEngine } from "../support/fake-engine.ts";
import { fakeGithub, fakeGithubWrite } from "../support/fake-github.ts";
import { fakeGh } from "../support/fake-gh.ts";
import { fakeGoogle } from "../support/fake-google.ts";
import { googleScopes } from "../../src/core/google/google-scopes.ts";
import { FakeTailscale, runningStatus } from "../support/fake-tailscale.ts";
import { createGitSandbox, gitEnvironment } from "../support/git-sandbox.ts";
import visorGallery from "./visor-gallery.html";
import { e2ePorts } from "./e2e-ports.ts";

const { demo: demoPort, gallery: galleryPort } = e2ePorts();
export const demoToken = "e2e-demo-token";

const sandbox = createGitSandbox();
const vault = sandbox.clone("vault");
const appRemote = createGitSandbox();
// A clone holds every repository of the project (issue 521). The demo never reaches the real GitHub,
// so a clone of the GitHub repository of the Example app copies a local remote instead.
const githubAppUrl = "https://github.com/example-owner/example-app";
const githubAppRemote = createGitSandbox();
sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
sandbox.write(
  vault,
  "Projects/2025-03-02-1015-example-app/AGENTS.md",
  `---\ncreated: 2025-03-02T10:15\nstatus: active\ntags: [web]\nrepos:\n  - ${appRemote.remote}\n  - ${githubAppUrl}\n---\n# Example app\n\nA web app for the client portal.\n`,
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
// The details test changes a project, so each browser run gets its own.
for (const run of ["desktop", "phone"]) {
  sandbox.write(
    vault,
    `Projects/2025-05-01-0800-${run}-draft/AGENTS.md`,
    `---\ncreated: 2025-05-01T08:00\nstatus: idea # idea, active, paused or closed\n---\n# Draft ${run}\n\nFirst thoughts.\n`,
  );
}
// The Files tests edit and rename notes, so each browser run gets its own.
for (const run of ["desktop", "phone"]) {
  sandbox.write(vault, `Notes/${run}-list.md`, "# Shopping\n\n- Milk\n");
  sandbox.write(vault, `Notes/${run}-draft.md`, "# Draft\n");
}
sandbox.write(vault, "Notes/settings.json", '{"theme":"dark","size":2}');
// The message box menu shows the examples that each vault gets (issue 661).
for (const path of [".eva/settings/text-actions/Polish.md", ".eva/settings/saved-prompts/Summary.md"]) {
  sandbox.write(vault, path, templateParts[path] ?? "");
}
// A date at the start of a name shows as a pill (issue 429).
sandbox.write(vault, "Journal/2027-trips.md", "# Trips\n");
// Real names can be long, and a long word has no break point. narrow-phone.spec.ts checks that no page then
// scrolls sideways on a narrow phone (issue 675). No button name or test search holds these words.
sandbox.write(
  vault,
  "Projects/2025-07-01-1200-quarterly-infrastructure-migration-of-the-northwind-holdings-reporting-backend/AGENTS.md",
  "---\ncreated: 2025-07-01T12:00\nstatus: active\n---\n# Quarterly infrastructure migration of the Northwind Holdings reporting backend\n",
);
sandbox.write(
  vault,
  "Notes/Benachrichtigungseinstellungen-Datenschutzrichtlinien-Zusammenfassung.md",
  "# Zusammenfassung\n",
);
sandbox.git(vault, "add", "-A");
sandbox.git(vault, "commit", "-q", "-m", "demo vault");
sandbox.git(vault, "push", "-q", "origin", "main");

const writtenNotes = new Set<string>();
const engine = new FakeEngine(async function* (request, turnNumber) {
  if (request.mode === "model-call" && request.prompt.startsWith("Summarize this chat.")) {
    yield* FakeEngine.answer(request, "Goal: the demo summary.");
    return;
  }
  // A text action of the message box menu, such as Polish (issue 661).
  const typed = /<text>\n([\s\S]*)\n<\/text>$/.exec(request.prompt)?.[1];
  if (request.mode === "model-call" && typed !== undefined) {
    yield* FakeEngine.answer(request, `${typed.charAt(0).toUpperCase()}${typed.slice(1).trim()}. (polished)`);
    return;
  }
  const lastLine = request.prompt.split("\n").at(-1) ?? "";
  yield {
    kind: "task_changed",
    taskId: `task-${String(turnNumber)}`,
    description: "Search the notes",
    state: "running",
  };
  yield {
    kind: "tool_started",
    toolUseId: `tool-${String(turnNumber)}`,
    name: "Grep",
    category: "tool",
    summary: "Grep notes",
    input: '{\n  "pattern": "notes"\n}',
  };
  yield {
    kind: "tool_finished",
    toolUseId: `tool-${String(turnNumber)}`,
    isError: false,
    output: "Notes/ideas.md\nNotes/settings.json",
  };
  yield {
    kind: "tool_started",
    toolUseId: `command-${String(turnNumber)}`,
    name: "Bash",
    category: "command",
    summary: "ls",
    input: '{\n  "command": "ls"\n}',
  };
  yield {
    kind: "tool_finished",
    toolUseId: `command-${String(turnNumber)}`,
    isError: false,
    output: "Journal\nNotes",
  };
  if (lastLine.includes("stream")) {
    // The approval holds the turn, so the page shows the draft for as long as the test needs.
    const words = "Streaming the words of this answer while the engine writes them. ".repeat(3);
    yield { kind: "text_delta", text: words };
    yield { kind: "text_delta", text: "More words " };
    await request.requestApproval({ requestId: "", toolName: "Bash", summary: "echo streamed" });
    yield* FakeEngine.answer(request, `${words}More words to end it.`);
    return;
  }
  if (lastLine.includes("code block")) {
    // The approval holds the turn, so the test sees the live block before the stored one.
    // The redactor holds back the tail of a draft, as long as the longest secret: more words push the block out.
    const answer = `Run this:\n\n\`\`\`sh\necho one && echo <two>\n\`\`\`\n\n${"Then read what it prints. ".repeat(8)}`;
    yield { kind: "text_delta", text: answer };
    await request.requestApproval({ requestId: "", toolName: "Bash", summary: "echo code" });
    yield* FakeEngine.answer(request, answer);
    return;
  }
  if (lastLine.includes("approve")) {
    const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "gh issue create" });
    yield* FakeEngine.answer(request, `The person answered: ${answer}`);
    return;
  }
  if (lastLine.includes("ask me")) {
    const outcome = await request.askQuestions("AskUserQuestion", [
      {
        question: "Which format should the review take?",
        header: "Format",
        options: [
          { label: "A one-to-one talk", description: "A talk with each person." },
          { label: "A form with scores", description: "A template with criteria and a score." },
        ],
        multiSelect: false,
      },
      {
        question: "Which notes should Eva read?",
        header: "Notes",
        options: [
          { label: "Journal", description: "" },
          { label: "Ideas", description: "" },
        ],
        multiSelect: true,
      },
    ]);
    yield* FakeEngine.answer(request, `The person answered: ${JSON.stringify(outcome)}`);
    return;
  }
  yield { kind: "task_changed", taskId: `task-${String(turnNumber)}`, description: "Search the notes", state: "done" };
  if (lastLine.includes("limit")) {
    // The real engine sends the limit after the first answer text.
    const [text, end] = FakeEngine.answer(request, `**Echo ${String(turnNumber)}**: ${lastLine}`);
    if (text !== undefined) yield text;
    yield {
      kind: "usage_limit",
      status: "warning",
      window: "five_hour",
      usedPercent: 86,
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    if (end !== undefined) yield end;
    return;
  }
  if (lastLine.includes("calendar")) {
    yield { kind: "notice", text: 'Eva could not start the MCP server "google": no uvx' };
    yield* FakeEngine.answer(request, "No calendar today.");
    return;
  }
  // An answer that writes a note, once, then echoes: the retry of the undo test starts from the files before it (#525).
  const note = /write the note (\S+)/.exec(lastLine)?.[1];
  if (note !== undefined && !writtenNotes.has(note)) {
    writtenNotes.add(note);
    writeFileSync(join(vault, "Notes", `${note}.md`), "Written by an answer.\n");
  }
  // The chat takes these words as its title, and a title shows as a button in the list. So they
  // hold no word of a button that another test looks for, such as "Send".
  if (lastLine.includes("hand me the parcel")) {
    yield* FakeEngine.answer(request, "Here are the trips.\n[[attach: Journal/2027-trips.md]]");
    return;
  }
  if (lastLine.includes("list")) {
    yield* FakeEngine.answer(request, "Two steps:\n- first\n- second\n\nDone.");
    return;
  }
  // Like `eva work` in the shell of the turn: the Project chat becomes a task of this answer (#571).
  if (request.mode === "assistant" && lastLine.includes("give work")) {
    await eva.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix the login bug.",
      reportToSessionId: request.environment["EVA_SESSION_ID"] ?? null,
    });
    yield* FakeEngine.answer(request, "Started the work.");
    return;
  }
  // The work of "give work" answers in two paragraphs, so its result card has more to show than its summary.
  if (request.mode === "project" && lastLine === "Fix the login bug.") {
    yield* FakeEngine.answer(request, `**Echo ${String(turnNumber)}**: ${lastLine}\n\nThe tests pass.`);
    return;
  }
  // Long enough for the person to open another chat before the answer comes.
  if (lastLine.includes("slow")) await Bun.sleep(2_000);
  yield* FakeEngine.answer(request, `**Echo ${String(turnNumber)}**: ${lastLine}`);
});

/** A machine without Tailscale, where the Install button makes the address ready. */
const tailscale = new FakeTailscale();
const demoRemoteAccess = tailscale.watcher({
  install: () => {
    tailscale.status = runningStatus(true, "owner@example.com", "eva.example-tailnet.ts.net");
    return Promise.resolve();
  },
});
await demoRemoteAccess.refresh();

// The Google Test runs `uvx --version`, and a CI machine has no uv.
// A saved GitHub token logs in gh, which must never reach the real GitHub (#244).
const demoGh = fakeGh(systemProcessRunner);
const demoRunner: ProcessRunner = {
  run: (command, options) =>
    // An exact argument of the command, never a part of a longer text.
    command[0] === "git" && command.includes("clone") && command.some((part) => part === githubAppUrl)
      ? systemProcessRunner.run(
          command.map((part) => (part === githubAppUrl ? githubAppRemote.remote : part)),
          options,
        )
      : command[0] === "uvx"
        ? Promise.resolve({ exitCode: 0, stdout: "uv 0.9.0\n", stderr: "" })
        : command[0] === "gh" && command[1] === "auth"
          ? demoGh.run(command, options)
          : systemProcessRunner.run(command, options),
};

// Google allows every scope that Eva asks for, so the Test passes after the login.
const google = fakeGoogle();
google.grantedScope = googleScopes(defaultConfig.google).join(" ");

const home = mkdtempSync(join(tmpdir(), "eva-e2e-home-"));
// The demo engine counts as logged in, so the chats can answer (issue 214).
mkdirSync(join(home, "engines", "claude"), { recursive: true });
writeFileSync(join(home, "engines", "claude", ".credentials.json"), "{}");
// The Engines page lists the real words of Claude Code's permissions, and rules of the person's own.
writeFileSync(
  join(home, "engines", "claude", "settings.json"),
  JSON.stringify({ permissions: { allow: ["Bash(npm test:*)"], deny: ["Read(./.env)"] } }),
);
const demoEngine = Object.assign(engine, {
  describePermissions: (context: PermissionContext) => describeClaudePermissions("auto", context),
});
const eva = new Eva({
  remoteAccess: demoRemoteAccess,
  paths: homePaths(home),
  config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
  secrets: { localApiToken: demoToken },
  engines: [demoEngine],
  runner: demoRunner,
  processEnvironment: gitEnvironment,
  now: () => new Date(),
  basePrompt: assistantBasePrompt,
  gatherMs: 20,
  googleBaseUrl: google.url,
  // The Versions card never reaches npm or GitHub: a test answers for the latest versions.
  toolLatestSources: { npmBaseUrl: "http://127.0.0.1:1", githubApiBaseUrl: "http://127.0.0.1:1" },
  // GitHub shows a code, and nobody types it: the demo never reaches the real GitHub.
  githubBrowserLogin: (show) => {
    show("WXYZ-1234", "https://github.com/login/device");
    return new Promise<string>(() => undefined);
  },
  // The reference has a skill that the project's repository lacks, and auto-merge is off there.
  githubRequest: fakeGithub({
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
  githubWrite: fakeGithubWrite(),
});
// No front end confirms a card here, so each new schedule's card waits for the web UI. A short
// check keeps the browser tests fast; Eva itself checks every 30 seconds.
setInterval(() => void eva.schedules?.tick(), 300);
// The faces get their own port, so the product's server has no test route.
Bun.serve({ hostname: "127.0.0.1", port: galleryPort, routes: { "/": visorGallery }, development: false });
startLocalApi({ eva, port: demoPort, token: demoToken, extraHosts: [], allowedTailscaleIdentities: [] });
process.stdout.write(`Eva demo ready on http://127.0.0.1:${String(demoPort)}\n`);
