/**
 * What Eva learned about each schedule, in the instance home (lesson 64): when she first saw
 * it, the slot it last fired, the result of its last run, and the fields its last setup card showed. Losing this file
 * costs one new setup card per schedule, so a broken file starts empty (lesson 54).
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

const stateSchema = z.object({
  firstSeen: z.string(),
  lastFired: z.string().nullable(),
  /**
   * The slot of the last firing and whether it failed. Unlike `lastFired`, a slot that a setup
   * card skipped never counts. Optional: a state file from before this field reads as no run yet.
   */
  lastResult: z.object({ slot: z.string(), failed: z.boolean() }).nullable().optional(),
  /** The fields that the last setup card showed. Null: no card yet. */
  announced: z.record(z.string(), z.string()).nullable(),
});

export type ScheduleState = z.infer<typeof stateSchema>;

const fileSchema = z.object({ version: z.literal(1), schedules: z.record(z.string(), z.unknown()) });

export class ScheduleStateStore {
  private readonly path: string;
  private readonly states: Map<string, ScheduleState>;

  constructor(path: string) {
    this.path = path;
    this.states = new Map();
    const read = readJsonTolerant(path);
    const file = read.ok ? fileSchema.safeParse(read.value) : null;
    if (file?.success !== true) return;
    for (const [id, value] of Object.entries(file.data.schedules)) {
      // Skip one bad entry, not the whole file (lesson 69).
      const state = stateSchema.safeParse(value);
      if (state.success) this.states.set(id, state.data);
    }
  }

  /** The schedule's state; records `now` as its first sight when it has none. */
  see(scheduleId: string, now: string): ScheduleState {
    const existing = this.states.get(scheduleId);
    if (existing !== undefined) return existing;
    const created: ScheduleState = { firstSeen: now, lastFired: null, announced: null };
    this.states.set(scheduleId, created);
    this.write();
    return created;
  }

  /** The schedule's state, or undefined. Unlike `see`, it never brings back a removed schedule. */
  peek(scheduleId: string): ScheduleState | undefined {
    return this.states.get(scheduleId);
  }

  update(scheduleId: string, change: Partial<ScheduleState>): void {
    const current = this.states.get(scheduleId);
    // A schedule removed during its firing stays removed.
    if (current === undefined) return;
    this.states.set(scheduleId, { ...current, ...change });
    this.write();
  }

  forget(scheduleId: string): void {
    if (this.states.delete(scheduleId)) this.write();
  }

  private write(): void {
    writeFileAtomic(
      this.path,
      JSON.stringify({ version: 1, schedules: Object.fromEntries(this.states) }, null, 2) + "\n",
    );
  }
}
