/**
 * Installs Tailscale for the person. Windows uses winget. Linux gets the userspace build from
 * the guide (docs/guide/setup.md, Tailscale without root): a user service, no root, no sudo.
 * Other systems get the steps only.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { installPage } from "./steps.ts";
import { userspaceFolders } from "./tailscale.ts";

export interface InstallInputs {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly homeFolder: string;
  /** The Tailscale package server; a test points it at a fake server. */
  readonly packagesBaseUrl?: string;
}

/** The Windows installer can wait for the person to accept an administrator prompt. */
const wingetTimeoutMs = 15 * 60_000;
const downloadTimeoutMs = 10 * 60_000;
const commandTimeoutMs = 60_000;
const defaultPackagesBaseUrl = "https://pkgs.tailscale.com";
/** Node's processor names, as the static builds name them. */
const buildArch: Readonly<Record<string, string>> = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };
/** The programs of the static build that Eva keeps. */
const programs = ["tailscale", "tailscaled"] as const;

export function canInstallTailscale(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux";
}

/** Throws EvaError `tailscale_install_failed` with what to do instead. */
export async function installTailscale(inputs: InstallInputs): Promise<void> {
  if (inputs.platform === "win32") return installWithWinget(inputs);
  if (inputs.platform === "linux") return installUserspace(inputs);
  throw failure(`Eva cannot install Tailscale on this system. Install it from ${installPage}.`);
}

async function installWithWinget(inputs: InstallInputs): Promise<void> {
  const command = [
    "winget",
    "install",
    "--id",
    "Tailscale.Tailscale",
    "--exact",
    "--source",
    "winget",
    "--silent",
    "--disable-interactivity",
    "--accept-package-agreements",
    "--accept-source-agreements",
  ];
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await inputs.runner.run(command, {
      cwd: inputs.homeFolder,
      environment: inputs.environment,
      timeoutMs: wingetTimeoutMs,
    });
  } catch (error) {
    throw failure(
      `winget could not run (${error instanceof Error ? error.message : String(error)}). Install Tailscale from ${installPage}.`,
    );
  }
  if (result.exitCode !== 0)
    throw failure(`winget could not install Tailscale: ${lastLine(result)}. Install it from ${installPage}.`);
}

async function installUserspace(inputs: InstallInputs): Promise<void> {
  const arch = buildArch[inputs.arch];
  if (arch === undefined) throw failure(`Tailscale has no Linux build for ${inputs.arch}. See ${installPage}.`);
  const base = `${inputs.packagesBaseUrl ?? defaultPackagesBaseUrl}/stable`;
  const index = (await fetchOrFail(`${base}/?mode=json`).then((response) => response.json())) as {
    Tarballs?: Record<string, unknown>;
  };
  const name = index.Tarballs?.[arch];
  if (typeof name !== "string" || !/^[\w.-]+\.tgz$/.test(name))
    throw failure(`Tailscale lists no Linux build for ${arch}. See ${installPage}.`);
  const tarball = new Uint8Array(await (await fetchOrFail(`${base}/${name}`)).arrayBuffer());
  const expected = (await (await fetchOrFail(`${base}/${name}.sha256`)).text()).trim().split(/\s+/)[0] ?? "";
  if (createHash("sha256").update(tarball).digest("hex") !== expected.toLowerCase())
    throw failure("The Tailscale download does not match its checksum. Eva installed nothing.");

  const folders = userspaceFolders(inputs.homeFolder);
  mkdirSync(posix.dirname(folders.lib), { recursive: true });
  mkdirSync(folders.state, { recursive: true });
  // Its own staging folder: two installs at once, such as from eva setup and from Telegram, never share a file.
  const staging = mkdtempSync(posix.join(posix.dirname(folders.lib), "tailscale-download-"));
  try {
    const download = posix.join(staging, "download.tgz");
    writeFileSync(download, tarball);
    await run(inputs, ["tar", "-xzf", download, "--strip-components=1", "-C", staging]);
    mkdirSync(folders.lib, { recursive: true });
    for (const program of programs) renameSync(posix.join(staging, program), posix.join(folders.lib, program));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  // The person's own commands find the same daemon through this script.
  const wrapper = posix.join(inputs.homeFolder, ".local", "bin", "tailscale");
  if (!existsSync(wrapper)) {
    mkdirSync(posix.dirname(wrapper), { recursive: true });
    // $HOME, not the path itself: a quote or a `$` in a home path would break out of the script's quotes.
    writeFileAtomic(
      wrapper,
      '#!/bin/sh\nexec "$HOME/.local/lib/tailscale/tailscale" --socket="$HOME/.local/share/tailscale/tailscaled.sock" "$@"\n',
    );
    chmodSync(wrapper, 0o755);
  }
  const unitPath = posix.join(inputs.homeFolder, ".config", "systemd", "user", "tailscaled.service");
  mkdirSync(posix.dirname(unitPath), { recursive: true });
  writeFileAtomic(
    unitPath,
    [
      "[Unit]",
      "Description=Tailscale for this user",
      "After=network-online.target",
      "",
      "[Service]",
      // systemd's %h, not the path itself: a space or a `%` in a home path would split or change the line.
      "ExecStart=%h/.local/lib/tailscale/tailscaled --tun=userspace-networking --statedir=%h/.local/share/tailscale --socket=%h/.local/share/tailscale/tailscaled.sock",
      "Restart=on-failure",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  );
  try {
    await run(inputs, ["systemctl", "--user", "daemon-reload"]);
    await run(inputs, ["systemctl", "--user", "enable", "--now", "tailscaled"]);
  } catch (error) {
    // Programs with no service that runs them would hide the Install step for good: take them out again.
    for (const program of programs) rmSync(posix.join(folders.lib, program), { force: true });
    throw error;
  }
}

async function fetchOrFail(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  } catch (error) {
    throw failure(
      `Eva could not download Tailscale (${error instanceof Error ? error.message : String(error)}). See ${installPage}.`,
    );
  }
  if (!response.ok) throw failure(`Eva could not download Tailscale (${String(response.status)}). See ${installPage}.`);
  return response;
}

async function run(inputs: InstallInputs, command: readonly string[]): Promise<void> {
  const result = await inputs.runner.run(command, {
    cwd: inputs.homeFolder,
    environment: inputs.environment,
    timeoutMs: commandTimeoutMs,
  });
  if (result.exitCode !== 0) throw failure(`${command.slice(0, 2).join(" ")} failed: ${lastLine(result)}`);
}

function lastLine(result: { stdout: string; stderr: string }): string {
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "no output";
}

function failure(message: string): EvaError {
  return new EvaError("tailscale_install_failed", message);
}
