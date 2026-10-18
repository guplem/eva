import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canInstallTailscale, installTailscale } from "../../../../src/core/remote-access/tailscale-install.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

const tarball = new TextEncoder().encode("a pretend tarball");
const tarballHash = createHash("sha256").update(tarball).digest("hex");

interface FakePackages {
  readonly url: string;
  stop(): void;
}

function servePackages(options: { hash?: string; missingArch?: boolean } = {}): FakePackages {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/stable/")
        return Response.json({
          TarballsVersion: "1.90.1",
          Tarballs: options.missingArch === true ? {} : { amd64: "tailscale_1.90.1_amd64.tgz" },
        });
      if (path === "/stable/tailscale_1.90.1_amd64.tgz") return new Response(tarball);
      if (path === "/stable/tailscale_1.90.1_amd64.tgz.sha256") return new Response(`${options.hash ?? tarballHash}\n`);
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${String(server.port)}`, stop: () => void server.stop(true) };
}

/** Runs `tar` by writing the two programs, and records every command. */
function fakeRunner(commands: string[][], failing: string | null = null): ProcessRunner {
  return {
    run: (command): Promise<ProcessResult> => {
      commands.push([...command]);
      if (command[0] === failing) return Promise.resolve({ exitCode: 1, stdout: "", stderr: `${failing} broke\n` });
      if (command[0] === "tar") {
        const folder = command[command.indexOf("-C") + 1] ?? "";
        writeFileSync(join(folder, "tailscale"), "#!/bin/sh\n");
        writeFileSync(join(folder, "tailscaled"), "#!/bin/sh\n");
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
  };
}

describe("installTailscale", () => {
  let home: string;
  let packages: FakePackages | null;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "eva-tailscale-install-"));
    packages = null;
  });

  afterEach(() => {
    packages?.stop();
    rmSync(home, { recursive: true, force: true });
  });

  test("Eva installs Tailscale on Windows and Linux; elsewhere the steps say what to do", () => {
    expect(canInstallTailscale("win32")).toBe(true);
    expect(canInstallTailscale("linux")).toBe(true);
    expect(canInstallTailscale("darwin")).toBe(false);
  });

  test("Windows installs with winget, and accepts the agreements so nothing waits for a key", async () => {
    const commands: string[][] = [];
    await installTailscale({
      runner: fakeRunner(commands),
      environment: {},
      platform: "win32",
      arch: "x64",
      homeFolder: home,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.slice(0, 4)).toEqual(["winget", "install", "--id", "Tailscale.Tailscale"]);
    expect(commands[0]).toContain("--accept-package-agreements");
    expect(commands[0]).toContain("--accept-source-agreements");
  });

  test("a failed winget names the download page", async () => {
    const error = await installTailscale({
      runner: fakeRunner([], "winget"),
      environment: {},
      platform: "win32",
      arch: "x64",
      homeFolder: home,
    }).catch((caught: unknown) => caught);
    expect(isEvaError(error, "tailscale_install_failed")).toBe(true);
    expect((error as Error).message).toContain("https://tailscale.com/download");
    const missing: ProcessRunner = { run: () => Promise.reject(new Error("Could not start winget.")) };
    const noWinget = await installTailscale({
      runner: missing,
      environment: {},
      platform: "win32",
      arch: "x64",
      homeFolder: home,
    }).catch((caught: unknown) => caught);
    expect((noWinget as Error).message).toContain("winget");
  });

  test("Linux gets the userspace build: checked download, own socket, user service, no root", async () => {
    packages = servePackages();
    const commands: string[][] = [];
    await installTailscale({
      runner: fakeRunner(commands),
      environment: {},
      platform: "linux",
      arch: "x64",
      homeFolder: home,
      packagesBaseUrl: packages.url,
    });
    const lib = join(home, ".local", "lib", "tailscale");
    expect(existsSync(join(lib, "tailscale"))).toBe(true);
    expect(existsSync(join(lib, "tailscaled"))).toBe(true);
    expect(existsSync(join(lib, "download.tgz"))).toBe(false);
    expect(commands[0]?.[0]).toBe("tar");
    const unit = readFileSync(join(home, ".config", "systemd", "user", "tailscaled.service"), "utf8");
    expect(unit).toContain("--tun=userspace-networking");
    expect(unit).toContain(`--socket=${join(home, ".local", "share", "tailscale", "tailscaled.sock")}`);
    const wrapper = join(home, ".local", "bin", "tailscale");
    expect(readFileSync(wrapper, "utf8")).toContain("--socket=");
    expect(statSync(wrapper).mode & 0o111).not.toBe(0);
    expect(commands.slice(1)).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "tailscaled"],
    ]);
    expect(commands.flat()).not.toContain("sudo");
  });

  test("Eva keeps a wrapper script that the person already has", async () => {
    packages = servePackages();
    const wrapper = join(home, ".local", "bin", "tailscale");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(wrapper, "my own script\n");
    await installTailscale({
      runner: fakeRunner([]),
      environment: {},
      platform: "linux",
      arch: "x64",
      homeFolder: home,
      packagesBaseUrl: packages.url,
    });
    expect(readFileSync(wrapper, "utf8")).toBe("my own script\n");
  });

  test("a download that does not match its checksum installs nothing", async () => {
    packages = servePackages({ hash: "0".repeat(64) });
    const commands: string[][] = [];
    const error = await installTailscale({
      runner: fakeRunner(commands),
      environment: {},
      platform: "linux",
      arch: "x64",
      homeFolder: home,
      packagesBaseUrl: packages.url,
    }).catch((caught: unknown) => caught);
    expect(isEvaError(error, "tailscale_install_failed")).toBe(true);
    expect((error as Error).message).toContain("checksum");
    expect(commands).toEqual([]);
  });

  test("an unknown processor, a missing build or a failed service start names the problem", async () => {
    packages = servePackages();
    const inputs = {
      environment: {},
      platform: "linux" as const,
      homeFolder: home,
      packagesBaseUrl: packages.url,
    };
    const odd = await installTailscale({ ...inputs, runner: fakeRunner([]), arch: "mips" }).catch(
      (caught: unknown) => caught,
    );
    expect((odd as Error).message).toContain("mips");
    const noBuild = await installTailscale({ ...inputs, runner: fakeRunner([]), arch: "arm64" }).catch(
      (caught: unknown) => caught,
    );
    expect((noBuild as Error).message).toContain("arm64");
    const noService = await installTailscale({ ...inputs, runner: fakeRunner([], "systemctl"), arch: "x64" }).catch(
      (caught: unknown) => caught,
    );
    expect((noService as Error).message).toContain("systemctl broke");
    const offline = await installTailscale({
      ...inputs,
      runner: fakeRunner([]),
      arch: "x64",
      packagesBaseUrl: "http://127.0.0.1:1",
    }).catch((caught: unknown) => caught);
    expect(isEvaError(offline, "tailscale_install_failed")).toBe(true);
  });

  test("macOS gets no install", async () => {
    const error = await installTailscale({
      runner: fakeRunner([]),
      environment: {},
      platform: "darwin",
      arch: "arm64",
      homeFolder: home,
    }).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("https://tailscale.com/download");
  });
});
