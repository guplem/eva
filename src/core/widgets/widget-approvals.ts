/**
 * What the person approved for each widget on this computer (#691), in
 * `state/widget-approvals.json`. A security setting never lives in the vault, because an agent
 * edits the vault. So the routes of a widget check each request against this record, never
 * against `.eva/widgets.json` or the manifest.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { widgetAddress } from "./widget-address.ts";
import type { WidgetEntry, WidgetInputValue } from "./widget-list.ts";

export const approvalsVersion = 1;

/** A git commit name: SHA-1, or SHA-256 for a repository that uses it. */
export const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const approvedPathSchema = z.object({
  input: z.string(),
  type: z.enum(["folder", "file"]),
  /** A forward-slash path from the vault root, or null for an input that the person left empty. */
  path: z.string().nullable(),
  access: z.enum(["read", "write"]),
  /** The `files` pattern of a folder input; null for a file input. */
  files: z.string().nullable(),
  /** The schema of a written input, by its path in the copy; null for a read. */
  schema: z.string().nullable(),
});

export const approvalSchema = z.object({
  repository: z.string(),
  commit: z.string().regex(commitPattern),
  name: z.string(),
  size: z.enum(["small", "medium", "large"]),
  entry: z.string(),
  paths: z.array(approvedPathSchema),
  location: z.boolean(),
  /** The approved origins, such as `https://api.example.com`. */
  hosts: z.array(z.string()),
  approvedAt: z.string(),
});

export const approvalsFileSchema = z.object({
  version: z.literal(approvalsVersion),
  approvals: z.array(approvalSchema),
});

export type ApprovedPath = z.infer<typeof approvedPathSchema>;
export type WidgetApproval = z.infer<typeof approvalSchema>;

/**
 * True when the approval still fits the vault entry: each folder or file input has the approved
 * path, and an input that the person left empty is still empty. A value that grants nothing,
 * such as a text, may change in the vault.
 */
export function matches(record: WidgetApproval | null, entry: WidgetEntry): boolean {
  if (record === null) return false;
  return record.paths.every((approved) => {
    const value = ownValue(entry.inputs, approved.input);
    const path = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    return path === approved.path;
  });
}

/** `config.json`: the values of the vault, with each path from the record. */
export function configOf(record: WidgetApproval, entry: WidgetEntry): Record<string, WidgetInputValue> {
  const paths = Object.fromEntries(
    record.paths.flatMap((approved) => (approved.path === null ? [] : [[approved.input, approved.path] as const])),
  );
  const values = Object.fromEntries(
    Object.entries(entry.inputs).filter(([key]) => !record.paths.some((approved) => approved.input === key)),
  );
  return { ...values, ...paths };
}

/** The value of a key of the record itself: an input id such as `constructor` must not read `Object.prototype`. */
export function ownValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The approved records, read once and kept in memory. Only this Eva writes the file. */
export class WidgetApprovals {
  private readonly path: string;
  private readonly records: Map<string, WidgetApproval>;

  constructor(path: string) {
    this.path = path;
    this.records = new Map();
    const read = readJsonTolerant(path);
    const list = read.ok ? (read.value as { approvals?: unknown } | null)?.approvals : undefined;
    // A broken record is dropped: the widget then asks for an approval again, which grants nothing by itself.
    for (const raw of Array.isArray(list) ? list : []) {
      const parsed = approvalSchema.safeParse(raw);
      const id = parsed.success ? widgetAddress(parsed.data.repository)?.id : undefined;
      if (parsed.success && id !== undefined) this.records.set(id, parsed.data);
    }
  }

  get(id: string): WidgetApproval | null {
    return this.records.get(id) ?? null;
  }

  save(id: string, record: WidgetApproval): void {
    this.records.set(id, record);
    this.write();
  }

  remove(id: string): void {
    if (this.records.delete(id)) this.write();
  }

  private write(): void {
    const file = { version: approvalsVersion, approvals: [...this.records.values()] };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }
}
