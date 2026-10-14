/**
 * `eva doctor`: checks each tool that Eva uses, grouped by feature, so a missing optional
 * tool never blocks the core (docs/plan.md §11, lesson 94).
 */
import type { ProcessRunner } from "../../shared/process-runner.ts";

interface ToolCheck {
  readonly program: string;
  readonly versionArguments: readonly string[];
  readonly feature: string;
  readonly required: boolean;
  readonly install: string;
}

const tools: readonly ToolCheck[] = [
  {
    program: "git",
    versionArguments: ["--version"],
    feature: "the vault and clones",
    required: true,
    install: "https://git-scm.com/downloads",
  },
  {
    program: "bun",
    versionArguments: ["--version"],
    feature: "Eva herself",
    required: true,
    install: "https://bun.sh",
  },
  {
    program: "claude",
    versionArguments: ["--version"],
    feature: "the Claude Code engine",
    required: false,
    install: "https://code.claude.com",
  },
  {
    program: "pi",
    versionArguments: ["--version"],
    feature: "the pi engine (ChatGPT, Copilot, API keys)",
    required: false,
    install: "https://pi.dev",
  },
  {
    program: "gh",
    versionArguments: ["--version"],
    feature: "pull request numbers",
    required: false,
    install: "https://cli.github.com",
  },
  {
    program: "uv",
    versionArguments: ["--version"],
    feature: "pskill and the Google tools",
    required: false,
    install: "https://docs.astral.sh/uv/",
  },
  {
    program: "ffmpeg",
    versionArguments: ["-version"],
    feature: "voice notes",
    required: false,
    install: "https://ffmpeg.org/download.html",
  },
  {
    program: "whisper-cli",
    versionArguments: ["--help"],
    feature: "voice notes",
    required: false,
    install: "https://github.com/ggml-org/whisper.cpp",
  },
  {
    program: "typst",
    versionArguments: ["--version"],
    feature: "PDFs",
    required: false,
    install: "https://github.com/typst/typst/releases",
  },
];

export interface DoctorOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly write: (line: string) => void;
  /** True when Eva runs as one executable, which carries its own Bun (plan §11). */
  readonly standalone: boolean;
}

/** Prints one line per tool. Returns false when a required tool is missing. */
export async function runDoctor(options: DoctorOptions): Promise<boolean> {
  let healthy = true;
  for (const group of [true, false]) {
    options.write(group ? "Required:" : "Optional:");
    const needed = tools.filter((tool) => !(options.standalone && tool.program === "bun"));
    for (const tool of needed.filter((candidate) => candidate.required === group)) {
      const version = await versionOf(tool, options);
      if (version === null) {
        if (tool.required) healthy = false;
        options.write(`  missing ${tool.program} (for ${tool.feature}): install it from ${tool.install}`);
      } else {
        options.write(`  ok      ${tool.program}: ${version}`);
      }
    }
  }
  return healthy;
}

async function versionOf(tool: ToolCheck, options: DoctorOptions): Promise<string | null> {
  try {
    const result = await options.runner.run([tool.program, ...tool.versionArguments], {
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
