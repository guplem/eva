import { describe, expect, test } from "bun:test";
import type { EvaStatus } from "../../../../src/core/eva.ts";
import {
  startTray,
  trayCommand,
  trayFaces,
  trayView,
  type TrayChoice,
  type TrayOptions,
  type TrayPhase,
  type TrayView,
} from "../../../../src/frontends/cli/tray.ts";
import { buildChildEnvironment, baseEnvironmentAllowlist } from "../../../../src/shared/environment.ts";
import type { LineProcess, LineProcessStarter } from "../../../../src/shared/line-process.ts";
import { systemLineProcessStarter } from "../../../../src/shared/line-process.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";

function status(fields: Partial<EvaStatus> = {}): EvaStatus {
  return { problems: [], busySessionIds: [], chatBlocker: null, ...fields } as unknown as EvaStatus;
}

function view(phase: TrayPhase, eva: EvaStatus | null = null): TrayView {
  return trayView({ instance: "example", phase, status: eva });
}

describe("trayView", () => {
  test("a running Eva with nothing to do has her face at rest, and her page opens", () => {
    expect(view({ kind: "running" }, status())).toEqual({
      face: "neutral",
      tooltip: "Eva (example)\nEva is online, and nothing runs",
      title: "Eva (example)",
      canOpen: true,
    });
  });

  test("a running Eva shows her work, a problem, and a setup step that stops the chats", () => {
    expect(view({ kind: "running" }, status({ busySessionIds: ["a", "b"] })).face).toBe("thinking");
    const problem = view({ kind: "running" }, status({ problems: ["The GitHub login expired."] }));
    expect(problem.face).toBe("error");
    expect(problem.tooltip).toContain("1 problem needs you");
    const blocked = view({ kind: "running" }, status({ chatBlocker: {} as EvaStatus["chatBlocker"] }));
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

  test("a status read before a stop never shows over the stop", () => {
    expect(view({ kind: "stopped", settingsNeedYou: false }, status()).face).toBe("asleep");
  });

  test("cuts a tooltip to the 63 characters that Windows allows", () => {
    const long = trayView({
      instance: "a-very-long-instance-name-for-a-test",
      phase: { kind: "waiting", afterMs: 30_000 },
      status: null,
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
      view({ kind: "running" }, status()),
      view({ kind: "running" }, status({ busySessionIds: ["a"] })),
      view({ kind: "running" }, status({ problems: ["x"] })),
    ].map((state) => state.face);
    for (const face of shown) expect(trayFaces).toContain(face);
  });
});

describe("trayCommand", () => {
  test("runs Windows PowerShell from the system folder, with the script in the command line", () => {
    const command = trayCommand("C:\\Windows");
    expect(command[0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(command).toContain("-Sta");
    const script = Buffer.from(command.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toContain("NotifyIcon");
    // Windows refuses a command line longer than 32,767 characters.
    expect(command.join(" ").length).toBeLessThan(32_767);
  });
});

interface FakeTrayProcess {
  readonly start: LineProcessStarter;
  readonly sent: string[];
  /** Writes a line as the script would, after a menu choice. */
  choose(line: string): void;
  /** Ends the script by itself. */
  end(stderr?: string): void;
  readonly closed: () => boolean;
}

function fakeTrayProcess(): FakeTrayProcess {
  const sent: string[] = [];
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let closed = false;
  let stderr = "";
  const exited = Promise.withResolvers<number>();
  const lines = async function* (): AsyncIterable<string> {
    for (;;) {
      const line = queue.shift();
      if (line !== undefined) {
        yield line;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
  const process: LineProcess = {
    send: (line) => sent.push(line),
    lines: lines(),
    exited: exited.promise,
    close: () => {
      closed = true;
      ended = true;
      wake?.();
      exited.resolve(0);
      return Promise.resolve();
    },
    stderrTail: () => stderr,
  };
  return {
    start: () => process,
    sent,
    choose: (line) => {
      queue.push(line);
      wake?.();
    },
    end: (text = "") => {
      stderr = text;
      ended = true;
      wake?.();
    },
    closed: () => closed,
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Bun.sleep(0);
}

function trayOptions(
  fake: FakeTrayProcess,
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
    instance: "example",
    readStatus: () => Promise.resolve(null),
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

function shownFaces(fake: FakeTrayProcess): string[] {
  return fake.sent.map((line) => (JSON.parse(line) as TrayView).face);
}

describe("startTray", () => {
  test("shows Eva starting, then her state once she answers, and sends a view only when it changes", async () => {
    const fake = fakeTrayProcess();
    const answers: (EvaStatus | null)[] = [null, status(), status(), status({ busySessionIds: ["a"] })];
    const { options, nextPoll } = trayOptions(fake, { readStatus: () => Promise.resolve(answers.shift() ?? null) });
    const tray = startTray(options);
    await settle();
    expect(shownFaces(fake)).toEqual(["listening"]);
    await nextPoll();
    await nextPoll();
    await nextPoll();
    expect(shownFaces(fake)).toEqual(["listening", "neutral", "thinking"]);
    await nextPoll();
    expect(shownFaces(fake).at(-1)).toBe("worried");
    await tray?.close();
  });

  test("the supervisor's phase replaces the old status, and no status is read while Eva is stopped", async () => {
    const fake = fakeTrayProcess();
    let reads = 0;
    const { options, nextPoll } = trayOptions(fake, {
      readStatus: () => {
        reads += 1;
        return Promise.resolve(status());
      },
    });
    const tray = startTray(options);
    await settle();
    expect(shownFaces(fake).at(-1)).toBe("neutral");
    tray?.setPhase({ kind: "stopped", settingsNeedYou: false });
    const readsAtStop = reads;
    await nextPoll();
    await nextPoll();
    expect(reads).toBe(readsAtStop);
    expect(shownFaces(fake).at(-1)).toBe("asleep");
    tray?.setPhase({ kind: "starting" });
    await nextPoll();
    expect(shownFaces(fake).slice(-2)).toEqual(["listening", "neutral"]);
    await tray?.close();
  });

  test("passes each menu choice on, and skips a line that is no choice", async () => {
    const fake = fakeTrayProcess();
    const { options, choices } = trayOptions(fake);
    const tray = startTray(options);
    for (const line of ["open", "hello", "restart", "quit"]) fake.choose(line);
    await settle();
    expect(choices).toEqual(["open", "restart", "quit"]);
    await tray?.close();
    expect(fake.closed()).toBe(true);
  });

  test("logs a script that ends by itself, with its error, but not a close", async () => {
    const fake = fakeTrayProcess();
    const { options, logs } = trayOptions(fake);
    startTray(options);
    fake.end("Add-Type failed");
    await settle();
    expect(logs).toEqual(["The tray icon stopped: Add-Type failed"]);
    const quiet = fakeTrayProcess();
    const second = trayOptions(quiet);
    await startTray(second.options)?.close();
    await settle();
    expect(second.logs).toEqual([]);
  });

  test("a script that cannot start gives no tray, and Eva runs on", () => {
    const logs: string[] = [];
    const fake = fakeTrayProcess();
    const { options } = trayOptions(fake, {
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

  test("Windows PowerShell parses the script with no error", async () => {
    const script = Buffer.from(trayCommand(systemRoot).at(-1) ?? "", "base64").toString("utf16le");
    const check =
      "$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$null, [ref]$errors); $errors | ForEach-Object { $_.ToString() }; exit $errors.Count";
    const result = await systemProcessRunner.run(
      [trayCommand(systemRoot)[0] ?? "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", check],
      {
        cwd: process.cwd(),
        environment: buildChildEnvironment(process.env, baseEnvironmentAllowlist),
        timeoutMs: 60_000,
        stdin: script,
      },
    );
    expect(result.stdout.trim()).toBe("");
    expect(result.exitCode).toBe(0);
  }, 60_000);

  test("the script draws each face, and ends with no error when its input ends", async () => {
    const child = systemLineProcessStarter(trayCommand(systemRoot), {
      cwd: process.cwd(),
      environment: buildChildEnvironment(process.env, baseEnvironmentAllowlist),
    });
    for (const face of trayFaces)
      child.send(JSON.stringify({ face, tooltip: "Eva (example)\nA test…", title: "Eva (example)", canOpen: true }));
    // The timer of the script reads the input every 200 ms.
    await Bun.sleep(3_000);
    await child.close(30_000);
    expect(child.stderrTail()).toBe("");
    expect(await child.exited).toBe(0);
  }, 60_000);
});
