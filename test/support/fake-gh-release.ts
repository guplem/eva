/**
 * A fake latest gh release, as GitHub's API describes it, and a runner whose `tar` unpacks it.
 * Each `gh` answers `--version` only after the install, as a fresh machine does.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner, ProcessRunOptions } from "../../src/shared/process-runner.ts";

export interface FakeGhRelease {
  /** The value for `ghReleaseUrl`. */
  readonly url: string;
  stop(): Promise<void>;
}

const archive = new TextEncoder().encode("a pretend gh archive");
const name = "gh_2.62.0_linux_amd64.tar.gz";

export function serveGhRelease(): FakeGhRelease {
  const hash = createHash("sha256").update(archive).digest("hex");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const base = `http://127.0.0.1:${String(server.port ?? 0)}`;
      const path = new URL(request.url).pathname;
      if (path === "/latest")
        return Response.json({
          tag_name: "v2.62.0",
          assets: ["gh_2.62.0_checksums.txt", name].map((asset) => ({
            name: asset,
            browser_download_url: `${base}/${asset}`,
          })),
        });
      if (path === "/gh_2.62.0_checksums.txt") return new Response(`${hash}  ${name}\n`);
      if (path === `/${name}`) return new Response(archive);
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${String(server.port)}/latest`, stop: () => server.stop(true) };
}

/** `installed` starts as the gh of the machine: null for none, or its version. */
export function ghInstallRunner(
  base: ProcessRunner,
  installed: { version: string | null },
): ProcessRunner & { readonly installs: number } {
  let installs = 0;
  return {
    get installs() {
      return installs;
    },
    run: (command: readonly string[], options: ProcessRunOptions): Promise<ProcessResult> => {
      const program = command[0] ?? "";
      if (program === "tar") {
        const target = command[command.indexOf("-C") + 1] ?? "";
        mkdirSync(join(target, "bin"), { recursive: true });
        writeFileSync(join(target, "bin", "gh"), "pretend gh");
        installs += 1;
        installed.version = "2.62.0";
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }
      if (/(^|[\\/])gh(\.exe)?$/.test(program) && command[1] === "--version") {
        if (installed.version === null) return Promise.reject(new EvaError("process_failed", "Could not start gh."));
        return Promise.resolve({ exitCode: 0, stdout: `gh version ${installed.version}\n`, stderr: "" });
      }
      return base.run(command, options);
    },
  };
}
