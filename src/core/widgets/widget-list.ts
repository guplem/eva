/**
 * The person's widgets in the vault, in `.eva/widgets.json` (#691): each widget's address, on or
 * off, its place in the grid, and the values of its inputs. Every computer with the vault shows
 * the same widgets in the same order. An agent or the person can edit the file, so a read never
 * throws, and a value here never grants a permission: the approved record on the machine does.
 */
import { join } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { widgetAddress } from "./widget-address.ts";
import { widgetSizes } from "./widget-kinds.ts";
import { readLayout, type WidgetLayout } from "./widget-layout.ts";

export const widgetListVersion = 1;

/** The value of one input: a vault path, a text, a number or yes or no. */
export const widgetInputValueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()]);
export type WidgetInputValue = z.infer<typeof widgetInputValueSchema>;

const layoutSlotSchema = z.object({
  column: z.number().int().optional(),
  row: z.number().int().optional(),
  /** The shape of the card (#995). */
  columns: z.number().int().optional(),
  rows: z.number().int().optional(),
  /** The older form of the shape (#985): Eva still reads it, and no longer writes it. */
  size: z.enum(widgetSizes).optional(),
});

/** The stored names of one entry, for the stored-name check. The reader keeps every other key as it is. */
export const widgetEntrySchema = z.object({
  repository: z.string(),
  enabled: z.boolean(),
  inputs: z.record(z.string(), widgetInputValueSchema),
  /** The place and size on the home grid, for each form (#985). `readLayout` reads it. */
  layout: z
    .object({
      computer: layoutSlotSchema.optional(),
      phone: layoutSlotSchema.optional(),
      /** The header slot beside the greeting (#1007). */
      header: z.boolean().optional(),
    })
    .optional(),
});

export interface WidgetEntry {
  /** The id of `widget-address.ts`. */
  readonly id: string;
  /** The address in its one form. */
  readonly repository: string;
  readonly enabled: boolean;
  readonly inputs: Readonly<Record<string, WidgetInputValue>>;
  /** The saved layout, only when it holds a good value. A write keeps it unless `layouts` changes it. */
  readonly layout?: WidgetLayout;
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
 * file keeps its own, so a later Eva or another tool loses nothing. An entry that Eva cannot read
 * stays at the end. A second entry of one widget goes: a removed widget must not come back.
 * Throws `widget_invalid` for a file that Eva cannot read at all, so a write never drops the list.
 * `layouts` gives a new layout to some entries; an empty one removes the key.
 */
export function writeWidgetList(
  vaultPath: string,
  next: readonly WidgetEntry[],
  layouts: ReadonlyMap<string, WidgetLayout> = new Map(),
): void {
  assertVaultWritable(vaultPath);
  const { file, entries, readable } = readRaw(vaultPath);
  if (!readable)
    throw new EvaError(
      "widget_invalid",
      "Eva cannot read .eva/widgets.json in the vault, so she does not change it. Fix the file, or ask Eva to.",
    );
  const rawById = new Map(entries.flatMap(({ raw, entry }) => (entry === null ? [] : [[entry.id, raw] as const])));
  const unreadable = entries.flatMap(({ raw, entry, duplicate }) => (entry === null && !duplicate ? [raw] : []));
  const widgets = [
    ...next.map((entry) => {
      const written: JsonObject = {
        ...(rawById.get(entry.id) ?? {}),
        repository: entry.repository,
        enabled: entry.enabled,
        inputs: entry.inputs,
      };
      const layout = layouts.get(entry.id);
      if (layout === undefined) return written;
      const { layout: _old, ...rest } = written;
      return Object.keys(layout).length === 0 ? rest : { ...rest, layout };
    }),
    ...unreadable,
  ];
  const content = { ...file, version: widgetListVersion, widgets };
  writeFileAtomic(widgetListPath(vaultPath), `${JSON.stringify(content, null, 2)}\n`);
}

interface RawList {
  readonly file: JsonObject;
  readonly entries: readonly {
    readonly raw: unknown;
    readonly entry: WidgetEntry | null;
    readonly duplicate: boolean;
  }[];
  /** False for a file that exists but is not a JSON object with a `widgets` list. */
  readonly readable: boolean;
}

function readRaw(vaultPath: string): RawList {
  const read = readJsonTolerant(widgetListPath(vaultPath));
  const file = read.ok && isObject(read.value) ? read.value : {};
  const readable = read.ok
    ? isObject(read.value) && (file["widgets"] === undefined || Array.isArray(file["widgets"]))
    : read.reason === "missing";
  const list = Array.isArray(file["widgets"]) ? (file["widgets"] as unknown[]) : [];
  const seen = new Set<string>();
  const entries = list.map((raw) => {
    const entry = entryOf(raw);
    if (entry === null) return { raw, entry: null, duplicate: false };
    if (seen.has(entry.id)) return { raw, entry: null, duplicate: true };
    seen.add(entry.id);
    return { raw, entry, duplicate: false };
  });
  return { file, entries, readable };
}

function entryOf(raw: unknown): WidgetEntry | null {
  if (!isObject(raw) || typeof raw["repository"] !== "string") return null;
  const address = widgetAddress(raw["repository"]);
  if (address === null) return null;
  const inputs = isObject(raw["inputs"]) ? raw["inputs"] : {};
  const layout = readLayout(raw["layout"]);
  return {
    ...(Object.keys(layout).length > 0 ? { layout } : {}),
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
