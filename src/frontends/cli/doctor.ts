/**
 * `eva doctor`: checks each tool that Eva uses, grouped by feature, so a missing optional
 * tool never blocks the core (lesson 94).
 */
import type { EngineName } from "../../shared/engine-port.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

interface ToolCheck {
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

const tools: readonly ToolCheck[] = [
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
    install: "https://code.claude.com",
    installOnLinux: "curl -fsSL https://claude.ai/install.sh | bash",
    update: "claude update",
  },
  {
    program: "pi",
    versionArguments: ["--version"],
    feature: "the pi engine (ChatGPT, Copilot, API keys)",
    required: false,
    engine: "pi",
    install: "https://pi.dev",
    update: "npm install -g @mariozechner/pi-coding-agent@latest",
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
    install: "https://docs.astral.sh/uv/",
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
    install: "https://tailscale.com/download",
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

export interface DoctorOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly write: (line: string) => void;
  /** True when Eva runs as one executable, which carries its own Bun. */
  readonly standalone: boolean;
  readonly platform: NodeJS.Platform;
  /** The OS user, for the Linux check that the user's services run while the user is logged out. */
  readonly userName: string;
  /** The default engine's program is required: without it, no chat works. */
  readonly defaultEngine: EngineName;
}

/** Prints one line per tool. Returns false when a required tool is missing. */
export async function runDoctor(options: DoctorOptions): Promise<boolean> {
  let healthy = true;
  const needed = tools
    .filter((tool) => !(options.standalone && tool.program === "bun"))
    .map((tool) => ({ ...tool, required: tool.required || tool.engine === options.defaultEngine }));
  for (const group of [true, false]) {
    options.write(group ? "Required:" : "Optional:");
    for (const tool of needed.filter((candidate) => candidate.required === group)) {
      const version = await firstOutputLine([tool.program, ...tool.versionArguments], options);
      if (version === null) {
        if (tool.required) healthy = false;
        const install =
          options.platform === "linux" && tool.installOnLinux !== undefined
            ? `run \`${tool.installOnLinux}\``
            : `install it from ${tool.install}`;
        options.write(`  missing ${tool.program} (for ${tool.feature}): ${install}`);
      } else {
        options.write(`  ok      ${tool.program}: ${version} (update: ${tool.update})`);
      }
    }
  }
  if (options.platform === "linux") options.write(await describeLinger(options));
  return healthy;
}

/** Without linger, systemd stops the user's services, Eva too, when the user logs out (lesson 85). */
async function describeLinger(options: DoctorOptions): Promise<string> {
  const answer = await firstOutputLine(["loginctl", "show-user", options.userName, "--property=Linger"], options);
  return answer === "Linger=yes"
    ? "  ok      linger: Eva keeps running when you log out"
    : "  missing linger (for Eva while you are logged out): run `loginctl enable-linger`";
}

/** The first line that the command prints, or null when it fails or does not exist. */
async function firstOutputLine(command: readonly string[], options: DoctorOptions): Promise<string | null> {
  try {
    const result = await options.runner.run(command, {
      cwd: process.cwd(),
      environment: options.environment,
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) return null;
    return (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] ?? "";
  } catch {
    return null;
  }
}
