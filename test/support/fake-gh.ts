/**
 * A runner that answers `gh` as gh would, and sends every other command to `base`, such as the
 * real git. No test may log in a real gh: it needs the network, and a real GitHub account.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessResult, ProcessRunOptions, ProcessRunner } from "../../src/shared/process-runner.ts";

export interface FakeGh extends ProcessRunner {
  /** Each gh command, with its stdin. */
  readonly calls: { readonly command: readonly string[]; readonly stdin: string | undefined }[];
}

/**
 * `gh auth login` writes the account to `hosts.yml` in `GH_CONFIG_DIR`, and `gh auth logout`
 * removes it. `refuse` makes the login fail, as for a token without the scopes that gh needs.
 */
export function fakeGh(base: ProcessRunner, refuse: string | null = null): FakeGh {
  const calls: { command: readonly string[]; stdin: string | undefined }[] = [];
  return {
    calls,
    run: (command: readonly string[], options: ProcessRunOptions): Promise<ProcessResult> => {
      if (command[0] !== "gh") return base.run(command, options);
      calls.push({ command, stdin: options.stdin });
      const folder = options.environment["GH_CONFIG_DIR"];
      if (command[1] === "auth" && command[2] === "login" && folder !== undefined) {
        if (refuse !== null) return Promise.resolve({ exitCode: 1, stdout: "", stderr: refuse });
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "hosts.yml"), "github.com:\n    git_protocol: https\n    user: example-user\n");
      }
      if (command[1] === "auth" && command[2] === "logout" && folder !== undefined)
        rmSync(join(folder, "hosts.yml"), { force: true });
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
  };
}
