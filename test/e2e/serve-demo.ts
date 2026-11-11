/**
 * Starts Eva for the Playwright tests: a neutral demo vault in a temporary folder, a local bare
 * remote, a scripted engine, and the local API on the ports of `e2e-ports.ts`. No real login is used.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../src/core/settings/home.ts";
import { assistantBasePrompt } from "../../src/core/modes/assistant-base-prompt.ts";
import { templateParts } from "../../src/core/vault/vault-template.ts";
import { createVaultKey, encryptFile } from "../../src/core/vault/vault-crypto.ts";
import { widgetTemplate } from "../../src/core/widgets/widget-template.ts";
import { startLocalApi } from "../../src/frontends/api/local-api.ts";
import { systemProcessRunner, type ProcessRunner } from "../../src/shared/process-runner.ts";
import { evaRepository } from "../../src/shared/version.ts";
import type { PermissionContext } from "../../src/shared/permissions.ts";
import { describeClaudePermissions } from "../../src/engines/claude-code/claude-code-permissions.ts";
import { describeClaudeContext } from "../../src/engines/claude-code/claude-code-context.ts";
import type { EngineContextInput } from "../../src/shared/chat-context.ts";
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
  `---\ncreated: 2025-03-02T10:15\nstatus: active\nresult: https://example-owner.github.io/example-app\ndeadline: 2025-06-30\ndesign_url: https://www.figma.com/file/example-app\ntags: [web]\nrepos:\n  - ${appRemote.remote}\n  - ${githubAppUrl}\n---\n# Example app\n\nA web app for the client portal.\n`,
);
sandbox.write(
  vault,
  "Projects/2019-03-old-tool/AGENTS.md",
  "---\ncreated: 2019-03\nstatus: closed\nclosed: 2020-06-30\ntags: [legacy]\n---\n# Old tool\n",
);
// A project that the person uses, and no longer develops (#690, #859). It closed a week ago, so the
// timeline of the last 12 months draws it up to that day.
const recipesClosed = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
sandbox.write(
  vault,
  "Projects/2024-09-01-0900-family-recipes/AGENTS.md",
  `---\ncreated: 2024-09-01T09:00\nstatus: closed\nclosed: ${recipesClosed}\nin-use: true\ntags: [home]\n---\n# Family recipes\n\nThe recipes and the menus of each week.\n`,
);
// A project whose work stopped: the timeline draws it with stripes (#857).
sandbox.write(
  vault,
  "Projects/2025-11-01-0900-garden-plan/AGENTS.md",
  "---\ncreated: 2025-11-01T09:00\nstatus: paused\ntags: [home]\n---\n# Garden plan\n\nThe beds and the seeds of the garden.\n",
);
sandbox.write(
  vault,
  "Projects/2024-06-01-0900-broken-notes/AGENTS.md",
  "---\ncreated: 2024-06-01T09:00\nstatus: active\nrepos: nope\n---\n# Broken notes\n",
);
// The details test changes a project, so each browser run gets its own. Its old `idea` status and
// comment show that the migration of #859 rewrites them when Eva starts.
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
// A browser shows an image and plays a sound, so the Files page shows them too (issue 737).
mkdirSync(join(vault, "Media"), { recursive: true });
writeFileSync(join(vault, "Media/landscape.png"), readFileSync(join(import.meta.dir, "demo-landscape.png")));
writeFileSync(join(vault, "Media/silence.wav"), silentWave());
writeFileSync(join(vault, "Media/data.bin"), new Uint8Array([0, 159, 146, 150, 255, 0, 1]));
// The vault has a key, so the demo shows no "no password" notice. The tests unlock it with this password.
const vaultKey = await createVaultKey("a long demo password", { logN: 10 });
sandbox.write(vault, ".eva/vault-key.json", `${JSON.stringify(vaultKey, null, 2)}\n`);
// A secret file of each browser run, encrypted, as Eva leaves it (#707).
for (const run of ["desktop", "phone"])
  sandbox.write(
    vault,
    `Private/${run}.secrets`,
    new TextDecoder().decode(
      encryptFile(new TextEncoder().encode("API_KEY=demo-value\n"), vaultKey, `Private/${run}.secrets`),
    ),
  );
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
// The habits widget of the template, approved for `Life/Health/Habits`, so the home page shows a widget (#691).
// The demo never reaches the real GitHub: its copy comes from a local remote.
const habitsWidget = createGitSandbox();
const habitsWidgetFiles = widgetTemplate({ owner: "example-owner", repository: "habits-widget", title: "Habits" });
const habitsWidgetWork = habitsWidget.clone("work");
for (const [path, text] of Object.entries(habitsWidgetFiles)) habitsWidget.write(habitsWidgetWork, path, text);
habitsWidget.git(habitsWidgetWork, "add", "-A");
habitsWidget.git(habitsWidgetWork, "commit", "-q", "-m", "widget");
habitsWidget.git(habitsWidgetWork, "push", "-q", "origin", "main");
for (const [path, text] of Object.entries(habitsWidgetFiles)) {
  if (path.startsWith("data/habits/") && path !== "data/habits/index.json")
    sandbox.write(vault, `Life/Health/Habits/${path.slice("data/habits/".length)}`, text);
}
// A widget project of the same widget, with one clone, so its page shows Preview (#693). The person
// still builds it and uses it, so the timeline draws a ring around its solid bar (#859).
const widgetProject = "Projects/2026-01-01-0900-habits-widget";
sandbox.write(
  vault,
  `${widgetProject}/AGENTS.md`,
  `---\ncreated: 2026-01-01T09:00\nstatus: active\nin-use: true\nrepos:\n  - https://github.com/example-owner/habits-widget\nrepo_types:\n  https://github.com/example-owner/habits-widget: widget\n---\n# Habits widget\n\nThe habits of the home page.\n`,
);
// The entities of the Life pages (#911). A date of 2099 stays in the future, and a date of 2025
// has passed, so the open, waiting and overdue cases keep their state on any day of a run.
const lifeSamples: Readonly<Record<string, string>> = {
  "Life/Cases/2026-05-15-phone-repair/Case.md": [
    "---",
    "opened: 2026-05-15",
    "closed:",
    "steps:",
    "  - { step: Back up the phone, done-on: 2026-05-15 }",
    "  - { step: Take the phone to the repair shop, due-by: 2099-06-01 }",
    "  - { step: Collect the phone and the invoice }",
    "deadline:",
    "summary: The screen of the phone broke. The backup is done.",
    "---",
    "# Phone repair",
    "",
    "- 2026-05-15: The screen broke. Backed up the phone.",
    "",
  ].join("\n"),
  "Life/Cases/2026-05-15-phone-repair/Repair quote.md": "# Repair quote\n\nA new screen costs 120 euros.\n",
  "Life/Cases/2026-09-01-bumper-claim/Case.md": [
    "---",
    "opened: 2026-09-01",
    "closed:",
    "steps:",
    "  - { step: Send the photos to the insurer, done-on: 2026-09-02 }",
    "  - { step: Get the insurer's answer, waiting-for: Example Insurance, due-by: 2099-01-15 }",
    '  - { step: "Take the car to the garage, and ask for the invoice" }',
    "deadline: { date: 2099-02-01, cost: The right to claim expires }",
    "aliases: [the bumper claim]",
    "summary: Claim for a broken bumper. The insurer has the photos.",
    "---",
    "# Bumper claim",
    "",
    "The case is about Life/Objects/Car - Example Model - 1234ABC.",
    "",
    "- 2026-09-02: Sent the photos to Example Insurance.",
    "",
  ].join("\n"),
  "Life/Cases/2025-11-03-gym-refund/Case.md": [
    "---",
    "opened: 2025-11-03",
    "closed:",
    "steps:",
    "  - { step: Ask the gym for the refund, done-on: 2025-11-03 }",
    "  - { step: Call the gym again, due-by: 2025-12-01 }",
    "summary: Refund of a month of the gym that was closed.",
    "---",
    "# Gym refund",
    "",
    "- 2025-11-03: Sent the request by email.",
    "",
  ].join("\n"),
  "Life/Cases/2025-02-10-flat-move/Case.md": [
    "---",
    "opened: 2025-02-10",
    "closed: 2025-04-30",
    "steps:",
    "  - { step: Book the van, done-on: 2025-03-01 }",
    "  - { step: Move the boxes, done-on: 2025-04-12 }",
    "summary: Moved to the new flat on 2025-04-12.",
    "---",
    "# Flat move",
    "",
    "- 2025-04-12: Moved with the help of Life/People/Sam Example.",
    "",
  ].join("\n"),
  "Life/People/Alex Example/Person.md":
    "---\nrelation: friend from university\naliases: [Al]\nsummary: Lives in the city. Vegetarian.\n---\n\nLikes board games.\n",
  "Life/People/Sam Example/Person.md":
    "---\nrelation: sister of Life/People/Alex Example\nsummary: Plays the piano.\n---\n\nAllergic to cats.\n",
  "Life/People/Jordan Example/Person.md":
    "---\nrelation: colleague at Example Corp\nsummary: Works on the example app.\n---\n\nPrefers short meetings.\n",
  "Life/Objects/Car - Example Model - 1234ABC/Object.md":
    "---\nstatus: in-use\ntype: car\nowner:\nids: { plate: 1234ABC, vin: EXAMPLEVIN0000000 }\naliases: [the car]\nsummary: The family car. The insurance ends on 2099-03-01.\n---\n\nThe service is every 15000 km.\n",
  "Life/Objects/Drill - Example Tools - 2022/Object.md":
    "---\nstatus: lent\ntype: drill\nowner: Life/People/Sam Example\nsummary: Sam's drill, lent to Jordan Example.\n---\n\nIt needs a new battery.\n",
  "Life/Objects/Phone - Example Phone 12 - 4321/Object.md":
    "---\nstatus: sold\ntype: phone\nowner:\nids: { imei: '4321' }\nsummary: The old phone. Sold on 2026-03-01.\n---\n\nSold with its case.\n",
  "Life/Pets/Luna/Pet.md":
    '---\nspecies: dog\nbreed: Border collie\nbirth: 2020-08-01\ndeath:\nchip: "941000012345678"\nsummary: Border collie. Allergic to chicken.\n---\n\nEats twice a day.\n',
  "Life/Pets/Milo/Pet.md":
    "---\nspecies: cat\nbirth: 2008\ndeath: 2024-03-10\nsummary: A calm cat.\n---\n\nLiked the sun on the balcony.\n",
  "Life/Periods/2024-09-01-example-corp-engineer/Period.md":
    "---\ntype: job\nfrom: 2024-09-01\nto:\norg: Example Corp\nrole: Software engineer\nsummary: Software engineer at Example Corp, a company that makes example apps.\n---\n\nThe first job after the sabbatical.\n\n## Work and achievements\n\n- Built the example app.\n",
  "Life/Periods/2019-09-01-example-university-study/Period.md":
    "---\ntype: study\nfrom: 2019-09-01\nto: 2023-06-30\norg: Example University\nrole: Computer science student\nsummary: A degree in computer science.\n---\n\nFour years of study.\n",
  "Life/Periods/2023-07-01-sabbatical/Period.md":
    "---\ntype: sabbatical\nfrom: 2023-07-01\nto: 2024-08-31\nsummary: A year of travel.\n---\n\nA year to travel and rest.\n",
};
for (const [path, text] of Object.entries(lifeSamples)) sandbox.write(vault, path, text);
sandbox.write(vault, ".gitignore", "Projects/*/repos/\n");
sandbox.git(vault, "add", "-A");
sandbox.git(vault, "commit", "-q", "-m", "demo vault");
sandbox.git(vault, "push", "-q", "origin", "main");
mkdirSync(join(vault, widgetProject, "repos", "clone-0"), { recursive: true });
habitsWidget.git(join(vault, widgetProject, "repos", "clone-0"), "clone", "-q", habitsWidget.remote, "habits-widget");
// A change that is not pushed: the preview shows it, and the installed widget does not.
writeFileSync(
  join(vault, widgetProject, "repos", "clone-0", "habits-widget", "config.json"),
  `${JSON.stringify({ title: "Mock habits", habits: "Life/Health/Habits" }, null, 2)}\n`,
);

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
  // The vault upgrade request holds its turn too, so a test sees its message while the turn runs (#804).
  if (lastLine.includes("approve") || lastLine.includes("vault-upgrade skill")) {
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
  describeContext: (input: EngineContextInput) => describeClaudeContext(input),
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
  // The demo branch requires checks, so a file fix shows its pull request (#717).
  githubWrite: fakeGithubWrite({ requiredChecks: true }),
  widgetRemote: () => habitsWidget.remote,
  // Every widget address leads to the one local remote, so a base widget would show the habits template.
  baseWidgets: [],
});
const habitsWidgetId = "example-owner/habits-widget";
const demoHosts = ["127.0.0.1", "localhost"];
eva.widgets?.add(`https://github.com/${habitsWidgetId}`);
const habitsReview = await eva.widgets?.review(habitsWidgetId, demoHosts);
if (habitsReview !== undefined)
  await eva.widgets?.approve(habitsWidgetId, habitsReview.commit, { habits: "Life/Health/Habits" }, demoHosts);
// No front end confirms a card here, so each new schedule's card waits for the web UI. A short
// check keeps the browser tests fast; Eva itself checks every 30 seconds.
setInterval(() => void eva.schedules?.tick(), 300);
// The faces get their own port, so the product's server has no test route.
Bun.serve({ hostname: "127.0.0.1", port: galleryPort, routes: { "/": visorGallery }, development: false });
startLocalApi({ eva, port: demoPort, token: demoToken, extraHosts: [], allowedTailscaleIdentities: [] });
process.stdout.write(`Eva demo ready on http://127.0.0.1:${String(demoPort)}\n`);

/** A tenth of a second of silence: a WAV file of 8 kHz, 8-bit mono samples. */
function silentWave(): Uint8Array {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples).fill(128, 44);
  const view = new DataView(bytes.buffer);
  const text = (at: number, word: string): void => {
    bytes.set(new TextEncoder().encode(word), at);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  return bytes;
}
