/** A CLI host for tests: it records the output, and runs each process through a given runner. */
import type { CliHost } from "../../src/frontends/cli/host.ts";
import type { ProcessResult, ProcessRunner } from "../../src/shared/process-runner.ts";
import { gitEnvironment } from "./git-sandbox.ts";

export interface FakeHost extends CliHost {
  /** Everything that the command wrote to stdout. */
  readonly output: string[];
  readonly errors: string[];
  /** The handlers that `onStopSignal` got; a test calls them as a signal would. */
  readonly stopHandlers: (() => void)[];
  /** The commands that the runner got. */
  readonly commands: string[][];
}

/** Answers each command with `answer`, or with exit code 0 and no output. */
export function scriptedRunner(
  commands: string[][],
  answer: (command: readonly string[]) => Partial<ProcessResult> | undefined = () => undefined,
): ProcessRunner {
  return {
    run: (command) => {
      commands.push([...command]);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", ...answer(command) });
    },
  };
}

export function fakeHost(overrides: Partial<CliHost> = {}, answers: string[] = []): FakeHost {
  const output: string[] = [];
  const errors: string[] = [];
  const stopHandlers: (() => void)[] = [];
  const commands: string[][] = [];
  return {
    environment: gitEnvironment,
    platform: "linux",
    arch: "x64",
    userHome: "/home/example",
    userName: "example",
    hostName: "server",
    pid: process.pid,
    parentPid: 1,
    runner: scriptedRunner(commands),
    write: (text) => output.push(text),
    writeError: (text) => errors.push(text),
    withPrompt: (work) => work(() => Promise.resolve(answers.shift() ?? "")),
    sleep: () => Promise.resolve(),
    standalone: false,
    execPath: "/usr/bin/bun",
    mainScript: "/opt/eva/src/main.ts",
    sourceFolder: "/opt/eva",
    isProcessAlive: () => false,
    bootId: null,
    onStopSignal: (handler) => stopHandlers.push(handler),
    ...overrides,
    output,
    errors,
    stopHandlers,
    commands,
  };
}
