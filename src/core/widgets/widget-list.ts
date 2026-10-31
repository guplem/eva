/**
 * The person's widgets in the vault, in `.eva/widgets.json` (#691): each widget's address, on or
 * off, its place in the grid, and the values of its inputs. Every computer with the vault shows
 * the same widgets in the same order. An agent or the person can edit the file, so a read never
 * throws, and a value here never grants a permission: the approved record on the machine does.
 */
import { join } from "node:path";
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { widgetAddress } from "./widget-address.ts";

export const widgetListVersion = 1;

/** The value of one input: a vault path, a text, a number or yes or no. */
export const widgetInputValueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()]);
export type WidgetInputValue = z.infer<typeof widgetInputValueSchema>;

/** The stored names of one entry, for the stored-name check. The reader keeps every other key as it is. */
export const widgetEntrySchema = z.object({
  repository: z.string(),
  enabled: z.boolean(),
  inputs: z.record(z.string(), widgetInputValueSchema),
});

export interface WidgetEntry {
  /** The id of `widget-address.ts`. */
  readonly id: string;
  /** The address in its one form. */
  readonly repository: string;
  readonly enabled: boolean;
  readonly inputs: Readonly<Record<string, WidgetInputValue>>;
}

type JsonObject = Record<string, unknown>;

export function widgetListPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "widgets.json");
}

/** The entries in the person's order. A bad entry, or a second entry of one widget, is skipped. */
export function readWidgetList(vaultPath: string): WidgetEntry[] {
  return readRaw(vaultPath).entries.flatMap(({ entry }) => (entry === null ? [] : [entry]));
}

/**
 * Replaces the entries with `next`, in its order. Each kept entry keeps its unknown keys, and the
 * file keeps its own, so a later Eva or another tool loses nothing. A bad entry stays at the end.
 */
export function writeWidgetList(vaultPath: string, next: readonly WidgetEntry[]): void {
  assertVaultWritable(vaultPath);
  const { file, entries } = readRaw(vaultPath);
  const rawById = new Map(entries.flatMap(({ raw, entry }) => (entry === null ? [] : [[entry.id, raw] as const])));
  const unreadable = entries.flatMap(({ raw, entry }) => (entry === null ? [raw] : []));
  const widgets = [
    ...next.map((entry) => ({
      ...(rawById.get(entry.id) ?? {}),
      repository: entry.repository,
      enabled: entry.enabled,
      inputs: entry.inputs,
    })),
    ...unreadable,
  ];
  const content = { ...file, version: widgetListVersion, widgets };
  writeFileAtomic(widgetListPath(vaultPath), `${JSON.stringify(content, null, 2)}\n`);
}

interface RawList {
  readonly file: JsonObject;
  readonly entries: readonly { readonly raw: unknown; readonly entry: WidgetEntry | null }[];
}

function readRaw(vaultPath: string): RawList {
  const read = readJsonTolerant(widgetListPath(vaultPath));
  const file = read.ok && isObject(read.value) ? read.value : {};
  const list = Array.isArray(file["widgets"]) ? (file["widgets"] as unknown[]) : [];
  const seen = new Set<string>();
  const entries = list.map((raw) => {
    const entry = entryOf(raw);
    if (entry === null || seen.has(entry.id)) return { raw, entry: null };
    seen.add(entry.id);
    return { raw, entry };
  });
  return { file, entries };
}

function entryOf(raw: unknown): WidgetEntry | null {
  if (!isObject(raw) || typeof raw["repository"] !== "string") return null;
  const address = widgetAddress(raw["repository"]);
  if (address === null) return null;
  const inputs = isObject(raw["inputs"]) ? raw["inputs"] : {};
  return {
    id: address.id,
    repository: address.url,
    // Only a real `true` turns a widget on: a typo leaves it off.
    enabled: raw["enabled"] === true,
    inputs: Object.fromEntries(
      Object.entries(inputs).filter(([, value]) => widgetInputValueSchema.safeParse(value).success),
    ) as Record<string, WidgetInputValue>,
  };
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
