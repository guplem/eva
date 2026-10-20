/**
 * `eva doctor`: checks each tool that Eva uses, grouped by feature, so a missing optional
 * tool never blocks the core (lesson 94).
 */
import type { CheckResult } from "../../core/checks.ts";
import { firstOutputLine, readToolLine, usedTools } from "../../core/tool-versions.ts";
import type { EngineName } from "../../shared/engine-port.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface DoctorOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly write: (line: string) => void;
  /** True when Eva runs as one executable, which carries its own Bun. */
  readonly standalone: boolean;
  readonly platform: NodeJS.Platform;
  /** The OS user, for the Linux check that the user's services run while the user is logged out. */
  readonly userName: string;
  /** The OS user's home folder, where the engine installers put their programs. */
  readonly userHome: string;
  /** The default engine's program is required: without it, no chat works. */
  readonly defaultEngine: EngineName;
  /**
   * The Google check without the service reads, or null when Google is not set up. Google is
   * optional, so its state never fails the doctor.
   */
  readonly google: () => Promise<CheckResult | null>;
}

/** Prints one line per tool. Returns false when a required tool is missing. */
export async function runDoctor(options: DoctorOptions): Promise<boolean> {
  let healthy = true;
  const needed = usedTools(options.standalone).map((tool) => ({
    ...tool,
    required: tool.required || tool.engine === options.defaultEngine,
  }));
  for (const group of [true, false]) {
    options.write(group ? "Required:" : "Optional:");
    for (const tool of needed.filter((candidate) => candidate.required === group)) {
      const version = await readToolLine(tool, options);
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
  options.write(await describeGoogle(options));
  if (options.platform === "linux") options.write(await describeLinger(options));
  return healthy;
}

/** Google is set up on the web app, in Settings, so every line points there. */
async function describeGoogle(options: DoctorOptions): Promise<string> {
  const result = await options.google();
  if (result === null) return "  off     Google: not set up. To set it up, open Settings in the web app.";
  return result.ok ? `  ok      Google: ${result.detail}` : `  failed  Google: ${result.detail}`;
}

/** Without linger, systemd stops the user's services, Eva too, when the user logs out (lesson 85). */
async function describeLinger(options: DoctorOptions): Promise<string> {
  const answer = await firstOutputLine(["loginctl", "show-user", options.userName, "--property=Linger"], options);
  return answer === "Linger=yes"
    ? "  ok      linger: Eva keeps running when you log out"
    : "  missing linger (for Eva while you are logged out): run `loginctl enable-linger`";
}
