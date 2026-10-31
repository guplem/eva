/**
 * The activation form of a widget (#691): a control for each input of its manifest, and the list
 * of what the person approves. The core checks each value again: this only guides the person.
 */
import type { WidgetInput, WidgetManifest } from "../../../core/widgets/widget-contract.ts";
import type { WidgetInputValue } from "../../../core/widgets/widget-list.ts";
import { isClosedPlace, isPlainName } from "../../../core/widgets/widget-places.ts";
import type { IconName } from "./icons.tsx";

export type FormValues = Readonly<Record<string, WidgetInputValue | undefined>>;

/** The inputs that the form shows: the location is a permission, not a value. */
export function formInputs(manifest: WidgetManifest): WidgetInput[] {
  return manifest.inputs.filter((input) => input.type !== "eva-location");
}

/** The value of each input: the one in the vault, or else the manifest's default. */
export function initialValues(
  manifest: WidgetManifest,
  current: FormValues,
): Record<string, WidgetInputValue | undefined> {
  const values: Record<string, WidgetInputValue | undefined> = {};
  for (const input of formInputs(manifest)) {
    const value = ownValue(current, input.id) ?? input.default;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[input.id] = value;
  }
  return values;
}

function isEmpty(value: WidgetInputValue | undefined): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

/** The labels of the required inputs with no value yet. A form with any of them cannot approve. */
export function missingInputs(manifest: WidgetManifest, values: FormValues): string[] {
  return formInputs(manifest)
    .filter((input) => input.required && isEmpty(ownValue(values, input.id)))
    .map((input) => input.label);
}

/** The values to send: each input with a value. */
export function sentValues(manifest: WidgetManifest, values: FormValues): Record<string, WidgetInputValue> {
  const sent: Record<string, WidgetInputValue> = {};
  for (const input of formInputs(manifest)) {
    const value = ownValue(values, input.id);
    if (value !== undefined && !isEmpty(value)) sent[input.id] = typeof value === "string" ? value.trim() : value;
  }
  return sent;
}

export interface PermissionLine {
  readonly icon: IconName;
  readonly text: string;
  readonly why: string;
}

/** What the person approves, in words, each with its reason: the places, the location and the hosts. */
export function permissionLines(manifest: WidgetManifest, values: FormValues): PermissionLine[] {
  const places = manifest.inputs.flatMap((input): PermissionLine[] => {
    if (input.type !== "folder" && input.type !== "file") return [];
    const value = ownValue(values, input.id);
    if (typeof value !== "string" || value.trim() === "") return [];
    const verb = input.access === "write" ? "Reads and writes" : "Reads";
    const what = input.type === "folder" ? "the folder" : "the file";
    return [
      { icon: input.type === "folder" ? "folder" : "file", text: `${verb} ${what} ${value.trim()}`, why: input.why },
    ];
  });
  const location = manifest.inputs
    .filter((input) => input.type === "eva-location")
    .map((input): PermissionLine => ({ icon: "globe", text: "Reads your last location", why: input.why }));
  const hosts = manifest.hosts.map((host): PermissionLine => ({
    icon: "external",
    text: `Calls ${host.url}`,
    why: host.why,
  }));
  return [...places, ...location, ...hosts];
}

/** True for an entry of the vault picker that a widget may reach, by its path from the vault root. */
export function isPickable(path: string): boolean {
  const segments = path.split("/");
  return segments.every(isPlainName) && !isClosedPlace(segments);
}

/** The value of a key of the record itself: an input id such as `constructor` must not read `Object.prototype`. */
export function ownValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
