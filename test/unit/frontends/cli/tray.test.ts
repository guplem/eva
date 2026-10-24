import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startTray,
  trayCommand,
  trayFaces,
  trayView,
  type TrayChoice,
  type TrayOptions,
  type TrayPhase,
  type TrayReading,
  type TrayView,
  startPolls,
} from "../../../../src/frontends/cli/tray.ts";
import { buildChildEnvironment, baseEnvironmentAllowlist } from "../../../../src/shared/environment.ts";
import { systemLineProcessStarter } from "../../../../src/shared/line-process.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { fakeTray, type FakeTray } from "../../../support/fake-tray.ts";

function reading(fields: Partial<TrayReading["status"]> = {}, approvals = 0): TrayReading {
  return { status: { problems: [], busySessionIds: [], chatBlocker: null, ...fields }, approvals };
}

function view(phase: TrayPhase, answer: TrayReading | null = null): TrayView {
  return trayView({ instance: "example", phase, reading: answer });
}

describe("trayView", () => {
  test("a running Eva with nothing to do has her face at rest, and her page opens", () => {
    expect(view({ kind: "running" }, reading())).toEqual({
      face: "neutral",
      tooltip: "Eva (example)\nEva is online, and nothing runs",
      title: "Eva (example)",
      canOpen: true,
    });
  });

  test("a running Eva shows her work, an approval, a problem, and a setup step that stops the chats", () => {
    expect(view({ kind: "running" }, reading({ busySessionIds: ["a", "b"] })).face).toBe("thinking");
    const approval = view({ kind: "running" }, reading({}, 2));
    expect(approval.face).toBe("firm");
    expect(approval.tooltip).toContain("2 approvals wait for you");
    const problem = view({ kind: "running" }, reading({ problems: ["The GitHub login expired."] }));
    expect(problem.face).toBe("error");
    expect(problem.tooltip).toContain("1 problem needs you");
    const blocked = view({ kind: "running" }, reading({ chatBlocker: "engine" }));
    expect(blocked.face).toBe("asleep");
    expect(blocked.tooltip).toContain("A setup step stops the chats");
  });

  test("a start, a lost answer, a wait after a crash and a stop each have their own face, and no Open", () => {
    const states = [
      view({ kind: "starting" }),
      view({ kind: "running" }),
      view({ kind: "waiting", afterMs: 4_500 }),
      view({ kind: "stopped", settingsNeedYou: false }),
      view({ kind: "stopped", settingsNeedYou: true }),
    ];
    expect(states.map((state) => state.face)).toEqual(["listening", "worried", "sad", "asleep", "error"]);
    expect(states.every((state) => !state.canOpen)).toBe(true);
    expect(states[2]?.tooltip).toContain("Starts in 5 s.");
  });

  test("an answer from before a stop never shows over the stop", () => {
    expect(view({ kind: "stopped", settingsNeedYou: false }, reading()).face).toBe("asleep");
  });

  test("cuts a tooltip to the 63 characters that Windows allows", () => {
    const long = trayView({
      instance: "a-very-long-instance-name-for-a-test",
      phase: { kind: "waiting", afterMs: 30_000 },
      reading: null,
    });
    expect(long.tooltip.length).toBe(63);
    expect(long.tooltip.endsWith("…")).toBe(true);
  });

  test("the script draws every face that the view can show", () => {
    const shown = [
      view({ kind: "starting" }),
      view({ kind: "running" }),
      view({ kind: "waiting", afterMs: 0 }),
      view({ kind: "stopped", settingsNeedYou: false }),
      view({ kind: "stopped", settingsNeedYou: true }),
      view({ kind: "running" }, reading()),
      view({ kind: "running" }, reading({}, 1)),
      view({ kind: "running" }, reading({ busySessionIds: ["a"] })),
      view({ kind: "running" }, reading({ problems: ["x"] })),
    ].map((state) => state.face);
    for (const face of shown) expect(trayFaces).toContain(face);
  });
});

describe("trayCommand", () => {
  test("runs Windows PowerShell from the system folder, with the script in the command line", () => {
    const command = trayCommand("C:\\Windows");
    expect(command[0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(command).toContain("-Sta");
    // PowerShell must leave the input to the script.
    expect(command.slice(command.indexOf("-InputFormat"), command.indexOf("-InputFormat") + 2)).toEqual([
      "-InputFormat",
      "None",
    ]);
    const script = Buffer.from(command.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toContain("NotifyIcon");
    // Windows refuses a command line longer than 32,767 characters.
    expect(command.join(" ").length).toBeLessThan(32_767);
  });
});

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Bun.sleep(0);
}

function trayOptions(
  fake: FakeTray,
  overrides: Partial<TrayOptions> = {},
): { options: TrayOptions; choices: TrayChoice[]; logs: string[]; nextPoll: () => Promise<void> } {
  const choices: TrayChoice[] = [];
  const logs: string[] = [];
  const polls: (() => void)[] = [];
  const options: TrayOptions = {
    start: fake.start,
    command: ["powershell.exe"],
    cwd: "/h",
    environment: {},
    viewFile: "/h/tray-view.json",
    instance: "example",
    read: () => Promise.resolve(null),
    onChoice: (choice) => choices.push(choice),
    // Each poll waits until the test lets it go on.
    sleep: () =>
      new Promise<void>((resolve) => {
        polls.push(resolve);
      }),
    log: (message) => logs.push(message),
    ...overrides,
  };
  const nextPoll = async (): Promise<void> => {
    polls.shift()?.();
    await settle();
  };
  return { options, choices, logs, nextPoll };
}

describe("startTray", () => {
  test("shows Eva starting, then her state once she answers, and sends a view only when it changes", async () => {
    const fake = fakeTray();
    const answers: (TrayReading | null)[] = [null, reading(), reading(), reading({ busySessionIds: ["a"] })];
    const { options, nextPoll } = trayOptions(fake, { read: () => Promise.resolve(answers.shift() ?? null) });
    const tray = startTray(options);
    await settle();
    expect(fake.faces()).toEqual(["listening"]);
    await nextPoll();
    await nextPoll();
    await nextPoll();
    expect(fake.faces()).toEqual(["listening", "neutral", "thinking"]);
    await nextPoll();
    expect(fake.faces().at(-1)).toBe("worried");
    await tray?.close();
  });

  test("the supervisor's phase replaces the old answer, and nothing is read while Eva is stopped", async () => {
    const fake = fakeTray();
    let reads = 0;
    const { options, nextPoll } = trayOptions(fake, {
      read: () => {
        reads += 1;
        return Promise.resolve(reading());
      },
    });
    const tray = startTray(options);
    await settle();
    expect(fake.faces().at(-1)).toBe("neutral");
    tray?.setPhase({ kind: "stopped", settingsNeedYou: false });
    const readsAtStop = reads;
    await nextPoll();
    await nextPoll();
    expect(reads).toBe(readsAtStop);
    expect(fake.faces().at(-1)).toBe("asleep");
    tray?.setPhase({ kind: "starting" });
    await nextPoll();
    expect(fake.faces().slice(-2)).toEqual(["listening", "neutral"]);
    await tray?.close();
  });

  test("an answer that comes after a new phase never overwrites it", async () => {
    const fake = fakeTray();
    const late = Promise.withResolvers<TrayReading | null>();
    const { options } = trayOptions(fake, { read: () => late.promise });
    const tray = startTray(options);
    await settle();
    tray?.setPhase({ kind: "stopped", settingsNeedYou: false });
    late.resolve(reading());
    await settle();
    expect(fake.faces()).toEqual(["listening", "asleep"]);
    await tray?.close();
  });

  test("a read that fails counts as no answer, and is logged", async () => {
    const fake = fakeTray();
    const { options, logs } = trayOptions(fake, { read: () => Promise.reject(new Error("config_invalid")) });
    const tray = startTray(options);
    await settle();
    expect(logs).toEqual(["The tray icon could not read Eva's status: config_invalid"]);
    expect(tray?.alive()).toBe(true);
    await tray?.close();
    expect(tray?.alive()).toBe(false);
  });

  test("passes each menu choice on, and skips a line that is no choice", async () => {
    const fake = fakeTray();
    const { options, choices } = trayOptions(fake);
    const tray = startTray(options);
    for (const line of ["open", "hello", "restart", "quit"]) fake.choose(line);
    await settle();
    expect(choices).toEqual(["open", "restart", "quit"]);
    await tray?.close();
    expect(fake.closed()).toBe(true);
  });

  test("logs a script that ends by itself, with its error, and is no longer alive; a close logs nothing", async () => {
    const fake = fakeTray();
    const { options, logs } = trayOptions(fake);
    const tray = startTray(options);
    fake.end("Add-Type failed");
    await tray?.ended;
    expect(logs).toEqual(["The tray icon stopped: Add-Type failed"]);
    expect(tray?.alive()).toBe(false);
    expect(fake.closed()).toBe(true);
    const quiet = fakeTray();
    const second = trayOptions(quiet);
    await startTray(second.options)?.close();
    await settle();
    expect(second.logs).toEqual([]);
  });

  test("a choice that throws is logged, and the icon stays", async () => {
    const fake = fakeTray();
    const { options, logs, choices } = trayOptions(fake, {
      onChoice: (choice) => {
        if (choice === "open") throw new Error("broken");
        choices.push(choice);
      },
    });
    const tray = startTray(options);
    fake.choose("open");
    fake.choose("quit");
    await settle();
    expect(logs).toEqual(["The tray menu choice open failed: broken"]);
    expect(choices).toEqual(["quit"]);
    expect(tray?.alive()).toBe(true);
    await tray?.close();
  });

  test("an output that fails is logged, and the script is closed", async () => {
    let closed = false;
    const { options, logs } = trayOptions(fakeTray(), {
      start: () => ({
        publish: () => true,
        lines: (async function* (): AsyncIterable<string> {
          await Promise.resolve();
          yield* [];
          throw new Error("pipe broke");
        })(),
        exited: Promise.resolve(1),
        close: () => {
          closed = true;
          return Promise.resolve();
        },
        stderrTail: () => "",
      }),
    });
    const tray = startTray(options);
    await tray?.ended;
    expect(logs).toEqual(["The tray icon failed: pipe broke", "The tray icon stopped."]);
    expect(closed).toBe(true);
  });

  test("a start with no answer for about a minute shows as a hang", async () => {
    const fake = fakeTray();
    const { options, nextPoll } = trayOptions(fake);
    const tray = startTray(options);
    await settle();
    for (let poll = 1; poll < startPolls; poll += 1) await nextPoll();
    expect(fake.faces()).toEqual(["listening", "worried"]);
    await tray?.close();
  });

  test("a script that cannot start gives no tray, and Eva keeps running", () => {
    const logs: string[] = [];
    const { options } = trayOptions(fakeTray(), {
      start: () => {
        throw new Error("no powershell");
      },
      log: (message) => logs.push(message),
    });
    expect(startTray(options)).toBeNull();
    expect(logs).toEqual(["The tray icon did not start: no powershell"]);
  });
});

describe.if(process.platform === "win32")("tray.ps1 on Windows", () => {
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const environment = buildChildEnvironment(process.env, baseEnvironmentAllowlist);
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "eva-tray-"));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  test("Windows PowerShell parses the script with no error", async () => {
    const script = Buffer.from(trayCommand(systemRoot).at(-1) ?? "", "base64").toString("utf16le");
    const file = join(folder, "tray.ps1");
    writeFileSync(file, script);
    // The path goes through the environment: quotes and backslashes in a command can break on Windows.
    const check =
      "$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:EVA_TRAY_FILE, [ref]$tokens, [ref]$errors); if ($tokens.Count -lt 100) { 'no script'; exit 99 }; $errors | ForEach-Object { $_.ToString() }; exit $errors.Count";
    const result = await systemProcessRunner.run(
      [trayCommand(systemRoot)[0] ?? "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", check],
      { cwd: folder, environment: { ...environment, EVA_TRAY_FILE: file }, timeoutMs: 60_000 },
    );
    expect(result.stdout.trim()).toBe("");
    expect(result.exitCode).toBe(0);
  }, 60_000);

  test("the script shows each view from the file, and ends with no other error when the file goes", async () => {
    // The trace shows how far the script got, if it fails.
    const child = systemLineProcessStarter(trayCommand(systemRoot), {
      cwd: folder,
      environment: { ...environment, EVA_TRAY_TRACE: "1" },
      lineFile: join(folder, "tray-view.json"),
    });
    const count = (text: string): number => child.stderrTail().split(text).length - 1;
    // Waits with a bound: the first start of PowerShell can take seconds.
    const waitUntil = async (done: () => boolean): Promise<void> => {
      for (let waited = 0; waited < 30_000 && !done(); waited += 100) await Bun.sleep(100);
    };
    for (const [index, face] of trayFaces.entries()) {
      const view = JSON.stringify({ face, tooltip: "Eva (example)\nA test…", title: "Eva (example)", canOpen: true });
      // A write fails while the script reads the file: it goes again.
      await waitUntil(() => child.publish(view));
      await waitUntil(() => count("trace: view shown") > index);
    }
    // A line that is not JSON makes the script write an error, and the script runs on.
    child.publish("not json");
    await waitUntil(() => count("could not show a view") > 0);
    await child.close(10_000);
    // With the error output in the text, a failure shows why.
    const result = `${String(await child.exited)} ${child.stderrTail()}`;
    expect(result).toStartWith("0 ");
    expect(count("trace: view shown")).toBe(trayFaces.length);
    expect(result).toContain("The tray icon could not show a view:");
    expect(result).toContain("trace: view file removed");
    expect(result).not.toContain("Exception calling");
  }, 90_000);
});
