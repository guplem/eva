import { describe, expect, test } from "bun:test";
import {
  installEnvironment,
  remoteAccessWatcher,
  wantsColor,
  withLinePrompt,
  type LinePrompt,
} from "../../../../src/frontends/cli/host.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { fakeHost } from "../../../support/fake-host.ts";

/** No Tailscale until winget installs it; then a machine that waits for a sign-in. */
function windowsMachine(commands: string[][]): ProcessRunner {
  let installed = false;
  return {
    run: (command): Promise<ProcessResult> => {
      commands.push([...command]);
      if (command[0] === "winget") {
        installed = true;
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }
      if (!installed) return Promise.reject(new EvaError("process_failed", "Could not start tailscale."));
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ BackendState: "NeedsLogin" }), stderr: "" });
    },
  };
}

describe("remoteAccessWatcher", () => {
  test("on Windows, the watcher installs Tailscale with winget through the host's runner", async () => {
    const commands: string[][] = [];
    const watcher = remoteAccessWatcher(fakeHost({ platform: "win32", runner: windowsMachine(commands) }), 7420);
    expect(await watcher.refresh()).toMatchObject({ step: "install", canInstall: true });
    expect(await watcher.install()).toMatchObject({ step: "sign_in", busy: null });
    expect(commands.some((command) => command[0] === "winget")).toBe(true);
  });

  test("on macOS, the watcher offers no install, and reports each change", async () => {
    const steps: string[] = [];
    const watcher = remoteAccessWatcher(fakeHost({ platform: "darwin", runner: windowsMachine([]) }), 7420, (access) =>
      steps.push(access.step ?? ""),
    );
    expect(await watcher.refresh()).toMatchObject({ step: "install", canInstall: false });
    expect(steps).toEqual(["install"]);
  });
});

describe("installEnvironment", () => {
  test("keeps the person's proxy settings, which an installer needs, and drops Eva's own secrets", () => {
    const host = fakeHost({
      environment: { PATH: "/usr/bin", HTTPS_PROXY: "http://proxy.example:3128", EVA_TELEGRAM_BOT_TOKEN: "secret" },
    });
    expect(installEnvironment(host)).toEqual({ PATH: "/usr/bin", HTTPS_PROXY: "http://proxy.example:3128" });
  });
});

/** A readline stand-in: each question waits until the test answers, closes or presses Ctrl+C. */
function fakeLinePrompt(): LinePrompt & {
  readonly pressCtrlC: () => void;
  readonly failQuestion: (error: Error) => void;
  closed: boolean;
} {
  const listeners: (() => void)[] = [];
  let reject: (error: Error) => void = () => undefined;
  return {
    closed: false,
    question() {
      return new Promise<string>((_resolve, rejectQuestion) => {
        reject = rejectQuestion;
      });
    },
    on(_event, listener) {
      listeners.push(listener);
    },
    close() {
      this.closed = true;
    },
    pressCtrlC: () => {
      for (const listener of listeners) listener();
    },
    failQuestion: (error) => {
      reject(error);
    },
  };
}

describe("withLinePrompt", () => {
  test("Ctrl+C at a question stops the work with prompt_stopped, and closes the prompt", async () => {
    const prompt = fakeLinePrompt();
    const done = withLinePrompt(prompt, async (ask) => {
      await ask("Time zone: ");
    });
    prompt.pressCtrlC();
    expect(
      await done.then(
        () => null,
        (error: unknown) => error,
      ),
    ).toBeInstanceOf(EvaError);
    expect(await done.catch((error: unknown) => (error as EvaError).code)).toBe("prompt_stopped");
    expect(prompt.closed).toBe(true);
  });

  test("Ctrl+C between two questions stops the work at once", async () => {
    const prompt = fakeLinePrompt();
    let asked = false;
    const done = withLinePrompt(prompt, async () => {
      await new Promise(() => undefined);
      asked = true;
    });
    prompt.pressCtrlC();
    expect(await done.catch((error: unknown) => (error as EvaError).code)).toBe("prompt_stopped");
    expect(asked).toBe(false);
  });

  test("a prompt that closes, such as at the end of the input, stops the work the same way", async () => {
    const prompt = fakeLinePrompt();
    const done = withLinePrompt(prompt, async (ask) => {
      await ask("Name: ");
    });
    const aborted = new Error("Aborted with Ctrl+C");
    aborted.name = "AbortError";
    prompt.failQuestion(aborted);
    expect(await done.catch((error: unknown) => (error as EvaError).code)).toBe("prompt_stopped");
  });

  test("another failure of the work passes through as it is", async () => {
    const prompt = fakeLinePrompt();
    const done = withLinePrompt(prompt, () => Promise.reject(new Error("disk full")));
    expect(await done.catch((error: unknown) => (error as Error).message)).toBe("disk full");
    expect(prompt.closed).toBe(true);
  });
});

describe("wantsColor", () => {
  test("colors a terminal, never a file or a pipe", () => {
    expect(wantsColor(fakeHost({ outputIsTerminal: true, environment: {} }))).toBe(true);
    expect(wantsColor(fakeHost({ outputIsTerminal: false, environment: {} }))).toBe(false);
  });

  test("NO_COLOR and TERM=dumb turn the colors off", () => {
    expect(wantsColor(fakeHost({ outputIsTerminal: true, environment: { NO_COLOR: "1" } }))).toBe(false);
    expect(wantsColor(fakeHost({ outputIsTerminal: true, environment: { NO_COLOR: "" } }))).toBe(true);
    expect(wantsColor(fakeHost({ outputIsTerminal: true, environment: { TERM: "dumb" } }))).toBe(false);
  });
});
