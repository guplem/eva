/**
 * What the person approved for each widget on this computer (#691), in
 * `state/widget-approvals.json`. A security setting never lives in the vault, because an agent
 * edits the vault. So the routes of a widget check each request against this record, never
 * against `.eva/widgets.json` or the manifest.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { widgetAddress } from "./widget-address.ts";

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
