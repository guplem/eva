/** The words and the buttons of the Versions card, apart from the component so that unit tests reach them. */
import { isNewerVersion } from "../../../core/updates/version-order.ts";
import type { EvaVersions } from "./api.ts";

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
