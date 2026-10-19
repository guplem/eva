/**
 * Fires the schedules of `.eva/schedules.json`. Only the hub fires them,
 * because every machine runs an instance (lesson 118). A new or changed schedule fires
 * only after a front end showed its setup card (lesson 66). Each firing with a prompt starts a fresh
 * chat named after the schedule (lesson 126).
 */
import { join } from "node:path";
import type { ModelAlias } from "../../shared/engine-port.ts";
import type { Logger } from "../../shared/logger.ts";
import {
  announcedFields,
  changedFields,
  readScheduleDefinitions,
  removeScheduleDefinition,
  saveScheduleDefinition,
  type Schedule,
  type ScheduleFieldName,
} from "./schedule-definitions.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
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

export type ScheduleCard = Extract<ScheduleEvent, { kind: "schedule_card" }>;

/**
 * A listener returns true when it showed the event to the person; only then does a setup card
 * count. It may return a promise: the scheduler waits for it, so a front end can open a topic first.
 */
type ScheduleListener = (event: ScheduleEvent) => Promise<boolean | undefined> | boolean | undefined;

export interface ScheduledChatStarter {
  createChat(name: string, model: ModelAlias): string;
  send(sessionId: string, prompt: string): Promise<void>;
}

export interface SchedulerOptions {
  readonly vaultPath: string;
  readonly statePath: string;
  readonly timeZone: string;
  /** Only the hub runs schedules; the hub can move while Eva runs. */
  readonly isHub: () => boolean;
  readonly now: () => Date;
  readonly chats: ScheduledChatStarter;
  readonly logger?: Logger;
  /** Hears the result of each firing: the reason of a failure, or null when it fired. */
  readonly reportFiring?: (schedule: Schedule, failure: string | null) => void;
  /** Hears when a setup card starts to wait for a front end, and when it stops waiting. */
  readonly reportCard?: (scheduleId: string, name: string, waiting: boolean) => void;
}

export interface ScheduleView {
  readonly schedule: Schedule;
  readonly nextRun: string | null;
  /** The slot of the last firing and whether it failed, or null before the first firing. */
  readonly lastRun: { readonly slot: string; readonly failed: boolean } | null;
}

export interface ScheduleList {
  readonly schedules: ScheduleView[];
  readonly problems: readonly string[];
  /** The zone of every slot, so a front end can draw today in the instance's time. */
  readonly timeZone: string;
  /** The wall-clock time now, as a slot. */
  readonly now: string;
}

const modelAliases: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

export class Scheduler {
  private readonly options: SchedulerOptions;
  private readonly state: ScheduleStateStore;
  private readonly listeners: Set<ScheduleListener>;
  /** The cards that no front end showed yet, by schedule id. */
  private readonly waiting: Map<string, ScheduleCard>;
  private lastProblems: string;
  private ticking: boolean;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.state = new ScheduleStateStore(options.statePath);
    this.listeners = new Set();
    this.waiting = new Map();
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

  /** Every valid schedule with its next and last run, and the problems of the file. */
  list(): ScheduleList {
    const now = wallClockOf(this.options.now(), this.options.timeZone);
    const definitions = readScheduleDefinitions(this.definitionsPath);
    return {
      schedules: definitions.schedules.map((schedule) => ({
        schedule,
        nextRun: nextSlot(schedule, now),
        lastRun: this.state.peek(schedule.id)?.lastResult ?? null,
      })),
      problems: definitions.problems,
      timeZone: this.options.timeZone,
      now,
    };
  }

  save(entry: Readonly<Record<string, unknown>>): Schedule {
    assertVaultWritable(this.options.vaultPath);
    return saveScheduleDefinition(this.definitionsPath, entry);
  }

  remove(scheduleId: string): boolean {
    assertVaultWritable(this.options.vaultPath);
    const removed = removeScheduleDefinition(this.definitionsPath, scheduleId);
    if (removed) {
      this.state.forget(scheduleId);
      this.stopWaiting(scheduleId);
    }
    return removed;
  }

  /** The setup cards that wait for a front end to show them. */
  waitingCards(): ScheduleCard[] {
    return [...this.waiting.values()];
  }

  /**
   * A front end says that the person saw the card with these fields. It counts only when the
   * fields still match the waiting card and the file, so a change pushed meanwhile gets its own card.
   */
  confirmCard(scheduleId: string, fields: Readonly<Record<string, string>>): boolean {
    if (!this.options.isHub()) return false;
    const schedule = readScheduleDefinitions(this.definitionsPath).schedules.find((entry) => entry.id === scheduleId);
    if (schedule === undefined || changedFields(announcedFields(schedule), fields).length > 0) return false;
    const now = wallClockOf(this.options.now(), this.options.timeZone);
    // Another front end showed this card first: the tap only agrees, and must not skip a due slot again.
    if (this.isAnnounced(schedule)) return true;
    const card = this.waiting.get(scheduleId);
    if (card === undefined || changedFields(card.fields, fields).length > 0) return false;
    this.recordCard(schedule, now);
    return true;
  }

  /** True while a check runs: a schedule may be between its chat and its first message. */
  isFiring(): boolean {
    return this.ticking;
  }

  /** One check of every schedule. The core calls it every 30 seconds. */
  async tick(): Promise<void> {
    if (!this.options.isHub()) {
      // A machine that is no longer the hub shows no cards, so nothing waits on it.
      for (const scheduleId of [...this.waiting.keys()]) this.stopWaiting(scheduleId);
      return;
    }
    if (this.ticking) return;
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
      // One schedule that fails must never stop the others.
      try {
        await this.check(schedule, now);
      } catch (error) {
        this.options.logger?.log("error", "A schedule failed to fire.", {
          scheduleId: schedule.id,
          reason: errorText(error),
        });
        this.options.reportFiring?.(schedule, errorText(error));
      }
    }
    // A schedule removed by hand or by a vault pull never calls remove().
    const ids = new Set(definitions.schedules.map((schedule) => schedule.id));
    for (const scheduleId of [...this.waiting.keys()]) if (!ids.has(scheduleId)) this.stopWaiting(scheduleId);
  }

  private async check(schedule: Schedule, now: string): Promise<void> {
    const state = this.state.see(schedule.id, now);
    const fields = announcedFields(schedule);
    if (!this.isAnnounced(schedule)) {
      const card: ScheduleCard = {
        kind: "schedule_card",
        scheduleId: schedule.id,
        name: schedule.name,
        fields,
        changed: state.announced === null ? [] : changedFields(state.announced, fields),
        nextRun: nextSlot(schedule, now),
        timeZone: this.options.timeZone,
      };
      // The card is the check against a schedule that someone pushed (lessons 66, 67). Until a
      // front end shows it, the schedule writes no state and never fires.
      const shown = await this.emit(card);
      // A remove or a confirm can come in while a front end still sends the card.
      if (this.state.peek(schedule.id) === undefined || this.isAnnounced(schedule)) return;
      if (shown) this.recordCard(schedule, now);
      else {
        this.waiting.set(schedule.id, card);
        this.options.reportCard?.(schedule.id, schedule.name, true);
      }
      return;
    }
    // The change was undone before anyone saw its card, so that card no longer waits.
    this.stopWaiting(schedule.id);
    const slot = dueSlot(schedule, state, now);
    if (slot !== null) await this.fire(schedule, slot);
  }

  /** True when a front end showed a card with the schedule's current fields. */
  private isAnnounced(schedule: Schedule): boolean {
    const announced = this.state.peek(schedule.id)?.announced ?? null;
    return announced !== null && changedFields(announced, announcedFields(schedule)).length === 0;
  }

  /** The person saw the card: a slot that is already due is skipped, so nothing runs before the card. */
  private recordCard(schedule: Schedule, now: string): void {
    const state = this.state.peek(schedule.id);
    // A removed schedule stays removed (lesson 67): a later push of it needs a new card.
    if (state === undefined) return;
    const slot = dueSlot(schedule, state, now);
    this.state.update(schedule.id, {
      announced: announcedFields(schedule),
      ...(slot === null ? {} : { lastFired: slot }),
    });
    this.stopWaiting(schedule.id);
  }

  private stopWaiting(scheduleId: string): void {
    const card = this.waiting.get(scheduleId);
    if (card === undefined) return;
    this.waiting.delete(scheduleId);
    this.options.reportCard?.(scheduleId, card.name, false);
  }

  private async fire(schedule: Schedule, slot: string): Promise<void> {
    const model = modelAliases.find((alias) => alias === schedule.model) ?? "default";
    // The chat comes first: when it cannot start, the slot does not count as fired, and the next check tries again.
    let sessionId: string | null;
    try {
      sessionId = schedule.prompt === null ? null : this.options.chats.createChat(schedule.name, model);
    } catch (error) {
      this.recordResult(schedule.id, slot, true);
      throw error;
    }
    this.state.update(schedule.id, { lastFired: slot, lastResult: { slot, failed: false } });
    await this.emit({
      kind: "schedule_fired",
      scheduleId: schedule.id,
      name: schedule.name,
      text: schedule.text,
      file: schedule.file,
      sessionId,
    });
    this.options.reportFiring?.(schedule, null);
    if (sessionId !== null && schedule.prompt !== null) {
      // Nobody awaits the turn, so its failure goes to the log here (lesson 50).
      this.options.chats.send(sessionId, schedule.prompt).catch((error: unknown) => {
        this.options.logger?.log("error", "A scheduled prompt failed.", {
          scheduleId: schedule.id,
          reason: errorText(error),
        });
        this.recordResult(schedule.id, slot, true);
        this.options.reportFiring?.(schedule, errorText(error));
      });
    }
  }

  private recordResult(scheduleId: string, slot: string, failed: boolean): void {
    const current = this.state.peek(scheduleId)?.lastResult;
    // A chat that cannot start fails at every check, so the file is written only on a change.
    if (current?.slot === slot && current.failed === failed) return;
    this.state.update(scheduleId, { lastResult: { slot, failed } });
  }

  /** True when a listener showed the event to the person. A listener that throws showed nothing. */
  private async emit(event: ScheduleEvent): Promise<boolean> {
    const results = await Promise.allSettled([...this.listeners].map(async (listener) => listener(event)));
    return results.some((result) => result.status === "fulfilled" && result.value === true);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
