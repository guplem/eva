/** The words and the buttons of the Versions card, apart from the component so that unit tests reach them. */
import { isNewerVersion } from "../../../core/updates/version-order.ts";
import type { EvaVersions, InstallableTool } from "./api.ts";

type Tool = EvaVersions["tools"][number];

/** Whether voice notes run, and what they still need. */
export function voiceNotesText(state: EvaVersions["voiceNotes"]): string {
  if (state.missing.length > 0) return `Off, needs ${state.missing.join(", ")}`;
  return state.on ? "On" : "Installed, restart Eva to turn them on";
}

/**
 * Whether an installed tool is older than the newest version. A tool that prints no version
 * number, or a newest version that Eva could not read, gives "unknown".
 */
export function freshness(tool: Tool, newest: string | undefined): "old" | "latest" | "unknown" {
  if (tool.version === null || newest === undefined || !/\d/.test(tool.version)) return "unknown";
  return isNewerVersion(newest, tool.version) ? "old" : "latest";
}

/** The version, and the newest one when it is newer. */
export function versionText(tool: Tool, newest: string | undefined): string {
  if (tool.version === null) return "Not installed";
  if (tool.tooOld) return `${tool.version}, too old`;
  return freshness(tool, newest) === "old" ? `${tool.version} (${newest ?? ""} available)` : tool.version;
}

/**
 * "Install" for a missing tool, "Update" for an old one, or null for no button. Without the
 * newest version, Eva cannot tell whether the tool is old, so it keeps its Update button.
 */
export function toolAction(tool: Tool, newest: string | undefined): "Install" | "Update" | null {
  if (!tool.installable) return null;
  if (tool.version === null) return "Install";
  return !tool.tooOld && freshness(tool, newest) === "latest" ? null : "Update";
}

/** True when the tool's button is a clear call to act, so the button is primary. */
export function needsAction(tool: Tool, newest: string | undefined): boolean {
  if (toolAction(tool, newest) === null) return false;
  return tool.version === null || tool.tooOld || freshness(tool, newest) === "old";
}

/** One step of Update all. */
export type UpdateAllStep =
  | { readonly kind: "install"; readonly program: InstallableTool }
  | { readonly kind: "voice notes" }
  | { readonly kind: "claude update" }
  | { readonly kind: "eva" };

/**
 * The steps of Update all: each primary button of the card, in an order that never overlaps two
 * installs. The page holds the installs while `claude update` runs, so claude comes after them.
 * A tool whose newest version is unknown has no clear update, so it stays out. Eva comes last, as
 * her update restarts her and opens the version dialog, so a major update shows its warning.
 */
export function updateAllSteps(input: {
  readonly versions: EvaVersions;
  readonly latest: ReadonlyMap<string, string>;
  /** True when Eva found a claude program, which then updates with `claude update`. */
  readonly claudeUpdatesItself: boolean;
  readonly newestEva: string | null;
}): UpdateAllStep[] {
  const steps: UpdateAllStep[] = [];
  let claudeUpdate = false;
  for (const tool of input.versions.tools) {
    const newest = input.latest.get(tool.program);
    if (!needsAction(tool, newest)) continue;
    if (tool.program === "claude" && input.claudeUpdatesItself && toolAction(tool, newest) === "Update") {
      claudeUpdate = true;
      continue;
    }
    steps.push({ kind: "install", program: tool.program as InstallableTool });
  }
  if (input.versions.voiceNotes.missing.length > 0) steps.push({ kind: "voice notes" });
  if (claudeUpdate) steps.push({ kind: "claude update" });
  if (input.newestEva !== null) steps.push({ kind: "eva" });
  return steps;
}
