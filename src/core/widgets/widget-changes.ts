/**
 * What a new manifest asks for beyond the approved record (#693). Permissions decide an update,
 * not a version: an update with no new permission installs by itself, and any other waits for the
 * person. The preview of a clone uses the same rule, so the person approves only what the clone adds.
 *
 * A permission is each folder or file input with its access, type and file pattern, the location,
 * the calendar with its access, the cases, each ask, each host, the prompt line, and the text of each
 * written schema.
 */
import type { ApprovedPath, WidgetApproval } from "./widget-approvals.ts";
import { ownValue } from "./widget-approvals.ts";
import type { WidgetManifest } from "./widget-contract.ts";
import { widgetAskTypes, type WidgetAskType } from "./widget-kinds.ts";
import type { WidgetInputValue } from "./widget-list.ts";
import { oneLine } from "./widget-prompt.ts";

/** The sentence of each ask, as an update names it. */
const askLines: Readonly<Record<WidgetAskType, string>> = {
  chat: "Write a text in your message box, for you to send.",
  open: "Open a page of Eva for a place of your vault.",
};

/** What the approval grants, without the facts that grant nothing, such as the name. */
export type WidgetGrant = Pick<
  WidgetApproval,
  "paths" | "location" | "googleCalendar" | "cases" | "asks" | "hosts" | "prompt"
>;

export interface GrantChange {
  /** The grant that the new manifest asks for, with the person's values. */
  readonly grant: WidgetGrant;
  /** One sentence for each new permission. Empty: the change installs by itself. */
  readonly added: readonly string[];
}

/**
 * Compares the manifest with the approved grant. `changedSchemas` holds each input whose written
 * schema has another text than at the approved commit. A read-only fallback of #692 (an approved
 * read with no schema for an input that the old manifest wrote) stays read only: it is no new write.
 */
export function grantChange(
  approved: WidgetGrant | null,
  manifest: WidgetManifest,
  values: Readonly<Record<string, WidgetInputValue>>,
  changedSchemas: ReadonlySet<string>,
  readOnlyInputs: ReadonlySet<string>,
): GrantChange {
  const paths = manifest.inputs.flatMap((input): ApprovedPath[] => {
    if (input.type !== "folder" && input.type !== "file") return [];
    const value = ownValue(values, input.id);
    const path = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    const readOnly = readOnlyInputs.has(input.id);
    return [
      {
        input: input.id,
        type: input.type,
        path,
        access: readOnly ? "read" : (input.access ?? "read"),
        files: input.files ?? null,
        schema: readOnly ? null : (input.schema ?? null),
      },
    ];
  });
  const calendar = manifest.inputs.find((input) => input.type === "eva-google-calendar");
  const grant: WidgetGrant = {
    paths,
    location: manifest.inputs.some((input) => input.type === "eva-location"),
    googleCalendar: calendar === undefined ? null : (calendar.access ?? "read"),
    cases: manifest.inputs.some((input) => input.type === "eva-cases"),
    asks: widgetAskTypes.filter((type) => (manifest.asks ?? []).some((ask) => ask.type === type)),
    hosts: manifest.hosts.map((host) => origin(host.url)),
    prompt: manifest.prompt ?? null,
  };
  const added: string[] = [];
  for (const next of paths) {
    if (next.path === null) continue;
    const old = approved?.paths.find((each) => each.input === next.input && each.path === next.path) ?? null;
    const place = `${next.type === "folder" ? "the folder" : "the file"} ${next.path}`;
    const files = next.type === "folder" && next.files !== null ? ` (${next.files})` : "";
    if (old?.type !== next.type || (old.files !== next.files && next.type === "folder")) {
      added.push(`${next.access === "write" ? "Read and change" : "Read"} ${place}${files}.`);
    } else if (old.access === "read" && next.access === "write") {
      added.push(`Change ${place}, not only read it.`);
    } else if (next.access === "write" && (old.schema !== next.schema || changedSchemas.has(next.input))) {
      added.push(`Write ${place} in a new data format (${next.schema ?? "no schema"}).`);
    }
  }
  if (grant.location && approved?.location !== true) added.push("Read your last location.");
  const oldCalendar = approved?.googleCalendar ?? null;
  if (grant.googleCalendar === "write" && oldCalendar === "read")
    added.push("Change your Google Calendar, not only read it.");
  else if (grant.googleCalendar !== null && oldCalendar === null)
    added.push(
      grant.googleCalendar === "write" ? "Read and change your Google Calendar." : "Read your Google Calendar.",
    );
  if (grant.cases && approved?.cases !== true) added.push("Read your open cases.");
  for (const ask of grant.asks) if (!(approved?.asks ?? []).includes(ask)) added.push(askLines[ask]);
  for (const host of grant.hosts) if (!(approved?.hosts ?? []).includes(host)) added.push(`Send requests to ${host}.`);
  if (grant.prompt !== null && grant.prompt !== (approved?.prompt ?? null))
    added.push(`Tell Eva in each new chat: "${oneLine(grant.prompt)}"`);
  return { grant, added };
}

/** The inputs that the approval keeps as a read-only fallback: a read with no schema, where the manifest of that commit writes. */
export function readOnlyFallbacks(approved: WidgetGrant, approvedManifest: WidgetManifest | null): Set<string> {
  const writes = new Set(
    (approvedManifest?.inputs ?? []).flatMap((input) => (input.access === "write" ? [input.id] : [])),
  );
  return new Set(
    approved.paths.flatMap((path) =>
      path.access === "read" && path.schema === null && writes.has(path.input) ? [path.input] : [],
    ),
  );
}

/** The origin of a host address, as the approval stores it. A bad address stays as it is: the host check refuses it. */
function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
