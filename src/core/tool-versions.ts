/**
 * The tools that Eva uses, and how to read the version of each. `eva doctor` checks them, and
 * the status and the Updates page show their versions, so a phone sees them too.
 */
import type { EngineName } from "../shared/engine-port.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import { engineProgramCandidates, runnableCommand } from "./engine-install/engine-install.ts";

export interface ToolCheck {
  readonly program: string;
  readonly versionArguments: readonly string[];
  readonly feature: string;
  readonly required: boolean;
  /** The engine that this program runs: it is required when it is the default engine. */
  readonly engine?: EngineName;
  readonly install: string;
  readonly installOnLinux?: string;
  /** How to update the tool (lesson 94). */
  readonly update: string;
}

export const tools: readonly ToolCheck[] = [
  {
    program: "git",
    versionArguments: ["--version"],
    feature: "the vault and clones",
    required: true,
    install: "https://git-scm.com/downloads",
    update: "with the installer or package manager that installed git",
  },
  {
    program: "bun",
    versionArguments: ["--version"],
    feature: "Eva herself",
    required: true,
    install: "https://bun.sh",
    update: "bun upgrade",
  },
  {
    program: "claude",
    versionArguments: ["--version"],
    feature: "the Claude Code engine",
    required: false,
    engine: "claude-code",
    install: "https://code.claude.com, or run `eva setup`",
    installOnLinux: "eva setup",
    update: "claude update",
  },
  {
    program: "pi",
    versionArguments: ["--version"],
    feature: "the pi engine (ChatGPT, Copilot, API keys)",
    required: false,
    engine: "pi",
    install: "https://pi.dev, or run `eva setup`",
    installOnLinux: "eva setup",
    // Setup installs only a missing pi, so a new copy needs the old one gone.
    update: "delete ~/.local/lib/pi (on Windows, %LOCALAPPDATA%\\Programs\\pi), then run `eva setup`",
  },
  {
    program: "gh",
    versionArguments: ["--version"],
    feature: "pull request numbers",
    required: false,
    install: "https://cli.github.com",
    update: "with the installer or package manager that installed gh",
  },
  {
    program: "uv",
    versionArguments: ["--version"],
    feature: "pskill and the Google tools",
    required: false,
    install: "https://docs.astral.sh/uv/, or run `eva setup`",
    installOnLinux: "eva setup",
    update: "uv self update",
  },
  {
    program: "ffmpeg",
    versionArguments: ["-version"],
    feature: "voice notes",
    required: false,
    install: "https://ffmpeg.org/download.html",
    update: "with the installer or package manager that installed ffmpeg",
  },
  {
    program: "whisper-cli",
    versionArguments: ["--help"],
    feature: "voice notes",
    required: false,
    install: "https://github.com/ggml-org/whisper.cpp",
    update: "download a newer release, or build it again",
  },
  {
    program: "tailscale",
    versionArguments: ["version"],
    feature: "opening Eva on your phone and other computers",
    required: false,
    install: "https://tailscale.com/download, or run `eva setup` on Windows",
    installOnLinux: "eva setup",
    update: "with the installer or package manager that installed tailscale",
  },
  {
    program: "typst",
    versionArguments: ["--version"],
    feature: "PDFs",
    required: false,
    install: "https://github.com/typst/typst/releases",
    update: "typst update",
  },
];

export interface ToolPlaces {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
  /** The OS user's home folder, where the engine installers put their programs. */
  readonly userHome: string;
  /** True when Eva runs as one executable, which carries its own Bun. */
  readonly standalone: boolean;
  /** The engine programs that the settings name; they come before the usual places. */
  readonly executables?: Partial<Record<EngineName, string>>;
}

export interface ToolVersion {
  readonly program: string;
  readonly feature: string;
  /** The version number, "installed" when the tool prints none, or null when the tool is missing. */
  readonly version: string | null;
}

/** The tools that this Eva uses: the single executable carries its own Bun. */
export function usedTools(standalone: boolean): readonly ToolCheck[] {
  return tools.filter((tool) => !(standalone && tool.program === "bun"));
}

/** Asks every tool at once, so a slow tool does not hold up the others. */
export function readToolVersions(places: ToolPlaces): Promise<ToolVersion[]> {
  return Promise.all(
    usedTools(places.standalone).map(async (tool) => {
      const line = await readToolLine(tool, places);
      return { program: tool.program, feature: tool.feature, version: line === null ? null : shortVersion(line) };
    }),
  );
}

/** The first line that the tool prints. An engine counts in its installer's folder too, as setup installs it there. */
export async function readToolLine(tool: ToolCheck, places: ToolPlaces): Promise<string | null> {
  const named = tool.engine === undefined ? undefined : places.executables?.[tool.engine];
  const programs =
    tool.engine === undefined
      ? [tool.program]
      : [
          ...(named === undefined ? [] : [named]),
          ...engineProgramCandidates(tool.engine, places.platform, places.userHome, places.environment),
        ];
  for (const program of programs) {
    const line = await firstOutputLine(runnableCommand([program, ...tool.versionArguments], places.platform), places);
    if (line !== null) return line;
  }
  return null;
}

/** The version number in a tool's first line, such as 2.50.0 in "git version 2.50.0". */
export function shortVersion(line: string): string {
  return /\d+(?:\.\d+)+[^\s,()]*/.exec(line)?.[0] ?? "installed";
}

/** The first line that the command prints, or null when it fails or does not exist. */
export async function firstOutputLine(
  command: readonly string[],
  places: Pick<ToolPlaces, "runner" | "environment">,
): Promise<string | null> {
  try {
    const result = await places.runner.run(command, {
      cwd: process.cwd(),
      environment: places.environment,
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) return null;
    return (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] ?? "";
  } catch {
    return null;
  }
}
