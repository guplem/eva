/**
 * The check of the input values of a widget (#691): the activation, an update (#693) and the
 * preview of a clone check each value against the manifest and the vault in the same way.
 */
import { EvaError } from "../../shared/errors.ts";
import { ownValue } from "./widget-approvals.ts";
import { checkManifest, checkWidget, manifestPath, type WidgetInput, type WidgetManifest } from "./widget-contract.ts";
import { placeOf } from "./widget-data.ts";
import { checkHost } from "./widget-hosts.ts";
import type { WidgetInputValue } from "./widget-list.ts";
import { isPlainName, isWritableName } from "./widget-places.ts";

/** The values to keep, trimmed. Throws `widget_invalid` for a required input with no value or a value that does not fit. */
export function checkValues(
  vaultPath: string,
  inputs: readonly WidgetInput[],
  values: Readonly<Record<string, WidgetInputValue>>,
): Record<string, WidgetInputValue> {
  const kept: Record<string, WidgetInputValue> = {};
  for (const input of inputs) {
    if (input.type === "eva-location") continue;
    const value = ownValue(values, input.id);
    const empty = value === undefined || (typeof value === "string" && value.trim() === "");
    if (empty) {
      if (input.required) throw new EvaError("widget_invalid", `${input.label} needs a value.`);
      continue;
    }
    const problem = valueProblem(vaultPath, input, value);
    if (problem !== null) throw new EvaError("widget_invalid", `${input.label}: ${problem}`);
    kept[input.id] = typeof value === "string" ? value.trim() : value;
  }
  return kept;
}

function valueProblem(vaultPath: string, input: WidgetInput, value: WidgetInputValue): string | null {
  switch (input.type) {
    case "folder":
    case "file": {
      if (typeof value !== "string") return "pick a place of the vault.";
      const path = value.trim();
      const place = placeOf(vaultPath, path);
      if (place === null) return "a widget may not reach this place.";
      if (input.type === "folder") return place === "folder" ? null : "pick a folder that exists.";
      if (place === "folder") return "pick a file, not a folder.";
      if (input.access === "write" && !isWritableName(path.split("/").at(-1) ?? ""))
        return "a widget writes only a JSON or YAML file that is not a rule file.";
      return place === "file" || input.access === "write" ? null : "pick a file that exists.";
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "give a number.";
    case "boolean":
      return typeof value === "boolean" ? null : "give yes or no.";
    case "choice":
      return typeof value === "string" && (input.choices ?? []).includes(value) ? null : "pick one of the choices.";
    case "url":
      return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim()) ? null : "give a web address.";
    default:
      return typeof value === "string" ? null : "give a text.";
  }
}

export interface FileCheck {
  /** The manifest as it reads, also when a schema or a host fails. Null when the manifest fails. */
  readonly manifest: WidgetManifest | null;
  readonly problems: readonly string[];
  readonly newerContract?: true;
}

/**
 * Checks the files of a widget: the manifest, each schema, each host and the entry page. A review
 * reads them at a commit, and the preview of a clone reads them from its folder (#693).
 */
export async function inspectFiles(
  read: (path: string) => Promise<string | null>,
  ownHosts: readonly string[],
): Promise<FileCheck> {
  const manifestText = await read(manifestPath);
  const parsed = manifestText === null ? null : checkManifest(manifestText);
  const files = new Map<string, string | null>([[manifestPath, manifestText]]);
  for (const input of parsed?.manifest?.inputs ?? []) {
    if (input.schema !== undefined) files.set(input.schema, await read(input.schema));
  }
  const check = checkWidget((path) => files.get(path) ?? null);
  const manifest = parsed?.manifest ?? null;
  const problems = [...check.manifest, ...check.schemas];
  if (manifest !== null) {
    for (const host of manifest.hosts) {
      const hostCheck = checkHost(host.url, ownHosts);
      if (!hostCheck.ok) problems.push(hostCheck.reason);
    }
    if ((await read(manifest.entry)) === null) problems.push(`The page ${manifest.entry} of the manifest is missing.`);
    // The widget route answers `data/` and `eva/` itself, and never serves a hidden file.
    const [top = ""] = manifest.entry.split("/");
    if (!manifest.entry.split("/").every(isPlainName) || ["data", "eva"].includes(top.toLowerCase()))
      problems.push(
        `Eva cannot serve the page ${manifest.entry}. Put the page outside data/ and eva/, with no hidden name.`,
      );
  }
  return { manifest, problems, ...(check.newerContract === true ? { newerContract: true as const } : {}) };
}
