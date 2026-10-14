/**
 * Fires the schedules of `.eva/schedules.json` (docs/plan.md §9). Only the hub fires them,
 * because every machine runs an instance (lesson 118). A new or changed schedule gets a
 * setup card before it first fires (lesson 66). Each firing with a prompt starts a fresh
 * chat named after the schedule (lesson 126).
 */
import { join } from "node:path";
import type { ModelAlias } from "../../shared/engine-port.ts";
import {
  announcedFields,
  changedFields,
  readScheduleDefinitions,
  removeScheduleDefinition,
  saveScheduleDefinition,
  type Schedule,
  type ScheduleFieldName,
} from "./schedule-definitions.ts";
import { ScheduleStateStore } from "./schedule-state.ts";
import { dueSlot, nextSlot, wallClockOf } from "./schedule-timing.ts";

export type ScheduleEvent =
  | {
      readonly kind: "schedule_card";
      readonly scheduleId: string;
      readonly name: string;
      readonly fields: Partial<Record<ScheduleFieldName, string>>;
      /** Empty for a new schedule. */
      readonly changed: readonly ScheduleFieldName[];
      readonly nextRun: string | null;
      readonly timeZone: string;
    }
  | {
      readonly kind: "schedule_fired";
      readonly scheduleId: string;
      readonly name: string;
      readonly text: string | null;
      /** A path from the vault root. */
      readonly file: string | null;
      /** The fresh chat that answers the prompt, or null when the schedule has no prompt. */
      readonly sessionId: string | null;
    }
  | { readonly kind: "schedule_problems"; readonly problems: readonly string[] };

/** A listener may return a promise: the scheduler waits for it, so a front end can open a topic first. */
type ScheduleListener = (event: ScheduleEvent) => Promise<void> | void;

export interface ScheduledChatStarter {
  createChat(name: string, model: ModelAlias): string;
  send(sessionId: string, prompt: string): Promise<void>;
}

export interface SchedulerOptions {
  readonly vaultPath: string;
  readonly statePath: string;
  readonly timeZone: string;
  readonly isHub: boolean;
  readonly now: () => Date;
  readonly chats: ScheduledChatStarter;
}

export interface ScheduleView {
  readonly schedule: Schedule;
  readonly nextRun: string | null;
}

const modelAliases: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

export class Scheduler {
  private readonly options: SchedulerOptions;
  private readonly state: ScheduleStateStore;
  private readonly listeners: Set<ScheduleListener>;
  private lastProblems: string;
  private ticking: boolean;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.state = new ScheduleStateStore(options.statePath);
    this.listeners = new Set();
    this.lastProblems = "";
    this.ticking = false;
  }

  get definitionsPath(): string {
    return join(this.options.vaultPath, ".eva", "schedules.json");
  }

  subscribe(listener: ScheduleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every valid schedule with its next run, and the problems of the file. */
  list(): { schedules: ScheduleView[]; problems: readonly string[] } {
    const now = wallClockOf(this.options.now(), this.options.timeZone);
    const definitions = readScheduleDefinitions(this.definitionsPath);
    return {
      schedules: definitions.schedules.map((schedule) => ({ schedule, nextRun: nextSlot(schedule, now) })),
      problems: definitions.problems,
    };
  }

  save(entry: Readonly<Record<string, unknown>>): Schedule {
    return saveScheduleDefinition(this.definitionsPath, entry);
  }

  remove(scheduleId: string): boolean {
    const removed = removeScheduleDefinition(this.definitionsPath, scheduleId);
    if (removed) this.state.forget(scheduleId);
    return removed;
  }

  /** One check of every schedule. The core calls it every 30 seconds. */
  async tick(): Promise<void> {
    if (!this.options.isHub || this.ticking) return;
    this.ticking = true;
    try {
      await this.checkAll();
    } finally {
      this.ticking = false;
    }
  }

  private async checkAll(): Promise<void> {
    const now = wallClockOf(this.options.now(), this.options.timeZone);
    const definitions = readScheduleDefinitions(this.definitionsPath);
    const problems = definitions.problems.join("\n");
    if (problems !== this.lastProblems) {
      this.lastProblems = problems;
      // Say each new set of problems once, not on every tick.
      if (problems.length > 0) await this.emit({ kind: "schedule_problems", problems: definitions.problems });
    }
    for (const schedule of definitions.schedules) {
      const state = this.state.see(schedule.id, now);
      const fields = announcedFields(schedule);
      if (state.announced === null || changedFields(state.announced, fields).length > 0) {
        await this.emit({
          kind: "schedule_card",
          scheduleId: schedule.id,
          name: schedule.name,
          fields,
          changed: state.announced === null ? [] : changedFields(state.announced, fields),
          nextRun: nextSlot(schedule, now),
          timeZone: this.options.timeZone,
        });
        this.state.update(schedule.id, { announced: fields });
      }
      const slot = dueSlot(schedule, state, now);
      if (slot === null) continue;
      this.state.update(schedule.id, { lastFired: slot });
      await this.fire(schedule);
    }
  }

  private async fire(schedule: Schedule): Promise<void> {
    const model = modelAliases.find((alias) => alias === schedule.model) ?? "default";
    const sessionId = schedule.prompt === null ? null : this.options.chats.createChat(schedule.name, model);
    await this.emit({
      kind: "schedule_fired",
      scheduleId: schedule.id,
      name: schedule.name,
      text: schedule.text,
      file: schedule.file,
      sessionId,
    });
    if (sessionId !== null && schedule.prompt !== null) void this.options.chats.send(sessionId, schedule.prompt);
  }

  private async emit(event: ScheduleEvent): Promise<void> {
    await Promise.allSettled([...this.listeners].map(async (listener) => listener(event)));
  }
}
