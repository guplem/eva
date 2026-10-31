/**
 * The update state of each widget on this computer (#693), in `state/widget-updates.json`: when
 * Eva last checked it, the update that waits for the person, and the commit that the person
 * refused. Each computer has its own copy and approvals, so each one checks and asks on its own.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { widgetAddress } from "./widget-address.ts";
import { commitPattern } from "./widget-approvals.ts";

export const widgetUpdatesVersion = 1;

const waitingSchema = z.object({
  commit: z.string().regex(commitPattern),
  /** One sentence for each new permission. */
  permissions: z.array(z.string()),
  /** One sentence for each reason that stops the update, such as an invalid manifest. */
  reasons: z.array(z.string()),
  /** The release notes since the installed commit, or the commit subjects. */
  notes: z.array(z.string()),
  /** When Eva found the update. */
  foundAt: z.string(),
});

export const widgetUpdateSchema = z.object({
  repository: z.string(),
  checkedAt: z.string().nullable(),
  waiting: waitingSchema.nullable(),
  /** The newest commit that the person refused. Eva asks again only for a newer commit. */
  refused: z.string().regex(commitPattern).nullable(),
});

export const widgetUpdatesFileSchema = z.object({
  version: z.literal(widgetUpdatesVersion),
  widgets: z.array(widgetUpdateSchema),
});

export type WaitingUpdate = z.infer<typeof waitingSchema>;
export type WidgetUpdate = z.infer<typeof widgetUpdateSchema>;

/** The update states, read once and kept in memory. Only this Eva writes the file. */
export class WidgetUpdates {
  private readonly path: string;
  private readonly states: Map<string, WidgetUpdate>;

  constructor(path: string) {
    this.path = path;
    this.states = new Map();
    const read = readJsonTolerant(path);
    const list = read.ok ? (read.value as { widgets?: unknown } | null)?.widgets : undefined;
    // A broken entry is dropped: the next check finds its update again.
    for (const raw of Array.isArray(list) ? list : []) {
      const parsed = widgetUpdateSchema.safeParse(raw);
      const id = parsed.success ? widgetAddress(parsed.data.repository)?.id : undefined;
      if (parsed.success && id !== undefined) this.states.set(id, parsed.data);
    }
  }

  get(id: string): WidgetUpdate | null {
    return this.states.get(id) ?? null;
  }

  /** Changes the state of one widget. A state with nothing in it goes. */
  set(id: string, repository: string, change: Partial<Omit<WidgetUpdate, "repository">>): void {
    const old = this.states.get(id) ?? { repository, checkedAt: null, waiting: null, refused: null };
    const next = { ...old, ...change, repository };
    if (next.checkedAt === null && next.waiting === null && next.refused === null) this.states.delete(id);
    else this.states.set(id, next);
    this.write();
  }

  remove(id: string): void {
    if (this.states.delete(id)) this.write();
  }

  /** Each widget with an update that waits. */
  waiting(): { readonly id: string; readonly repository: string; readonly waiting: WaitingUpdate }[] {
    return [...this.states].flatMap(([id, state]) =>
      state.waiting === null ? [] : [{ id, repository: state.repository, waiting: state.waiting }],
    );
  }

  private write(): void {
    const file = { version: widgetUpdatesVersion, widgets: [...this.states.values()] };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }
}
