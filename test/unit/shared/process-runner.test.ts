import { describe, expect, test } from "bun:test";
import { isEvaError } from "../../../src/shared/errors.ts";
import { failureReason, systemProcessRunner } from "../../../src/shared/process-runner.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

describe("systemProcessRunner", () => {
  test("returns the exit code, stdout and stderr", async () => {
    const result = await systemProcessRunner.run(
      [bun, "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      { cwd: process.cwd(), environment, timeoutMs: 10_000 },
    );
    expect(result).toEqual({ exitCode: 3, stdout: "out", stderr: "err" });
  });

  test("passes stdin to the process", async () => {
    const result = await systemProcessRunner.run(
      [bun, "-e", "process.stdin.on('data', (chunk) => process.stdout.write(String(chunk).toUpperCase()))"],
      { cwd: process.cwd(), environment, timeoutMs: 10_000, stdin: "hello" },
    );
    expect(result.stdout).toBe("HELLO");
  });

  test("gives the child only the environment it was given", async () => {
    const result = await systemProcessRunner.run(
      [bun, "-e", "process.stdout.write(String(process.env.EVA_SECRET_PROBE))"],
      { cwd: process.cwd(), environment, timeoutMs: 10_000 },
    );
    expect(result.stdout).toBe("undefined");
  });

  test("stops a process that runs past its timeout", async () => {
    const started = Date.now();
    const run = systemProcessRunner.run([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
      timeoutMs: 300,
    });
    const error: unknown = await run.catch((caught: unknown) => caught);
    expect(isEvaError(error, "process_timeout")).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test("reports a program that cannot start", async () => {
    const error: unknown = await systemProcessRunner
      .run(["eva-program-that-does-not-exist"], { cwd: process.cwd(), environment, timeoutMs: 5_000 })
      .catch((caught: unknown) => caught);
    expect(isEvaError(error, "process_failed")).toBe(true);
  });
});

describe("failureReason", () => {
  test("gives the error output when there is one", () => {
    expect(failureReason({ exitCode: 128, stdout: "", stderr: "fatal: no remote\n" }, "git")).toBe("fatal: no remote");
  });

  test("gives the exit code when the error output is empty (#430)", () => {
    expect(failureReason({ exitCode: 128, stdout: "", stderr: "  \n" }, "git")).toBe(
      "git ended with exit code 128 and wrote no error.",
    );
  });

  test("adds the normal output when the error output is empty", () => {
    expect(failureReason({ exitCode: 1, stdout: "nothing to commit\n", stderr: "" }, "git")).toBe(
      "git ended with exit code 1 and wrote no error. Its output: nothing to commit",
    );
  });

  test("keeps a long output short", () => {
    expect(failureReason({ exitCode: 1, stdout: "", stderr: "x".repeat(2000) }, "git").length).toBeLessThanOrEqual(500);
  });
});
