import { describe, expect, test } from "bun:test";
import { remoteAccessWatcher } from "../../../../src/frontends/cli/host.ts";
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
