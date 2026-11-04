/**
 * Fires the schedules of `.eva/schedules.json`. Only the hub fires them,
 * because every machine runs an instance (lesson 118). A new or changed schedule fires at its
 * next time, with no setup card (#855). Each firing with a prompt starts a fresh chat named after
 * the schedule (lesson 126).
 */
import { join } from "node:path";
import { modelAliases, type ModelAlias } from "../../shared/engine-port.ts";
import type { Logger } from "../../shared/logger.ts";
import {
  announcedFields,
  changedFields,
  editScheduleDefinition,
  readScheduleDefinitions,
  removeScheduleDefinition,
  runsOnce,
  saveScheduleDefinition,
  setScheduleEnabled,
  type Schedule,
} from "./schedule-definitions.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { ScheduleStateStore, type ScheduleState } from "./schedule-state.ts";
import { dueSlot, isLate, nextSlot, runsOnDay, wallClockOf } from "./schedule-timing.ts";
import { EvaError } from "../../shared/errors.ts";
import { extractFileMarkers } from "../../shared/file-markers.ts";

export type ScheduleEvent =
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
  | {
      /**
       * A scheduled run ended with something to tell, or failed (#687). A front end shows the answer
       * now: it held the run's text back, so a quiet run reaches nobody.
       */
      readonly kind: "schedule_answered";
      readonly scheduleId: string;
      readonly name: string;
      readonly sessionId: string;
      /** The answer of the run, with its marker lines: a front end reads them as in any answer. */
      readonly text: string;
      /** The reason of a failed run, or null. */
      readonly failure: string | null;
    }
  | { readonly kind: "schedule_problems"; readonly problems: readonly string[] };

/** A listener may return a promise: the scheduler waits for it, so a front end can open a topic first. */
type ScheduleListener = (event: ScheduleEvent) => unknown;

export interface ScheduledChatStarter {
  /** Without a model, the settings' model for new chats. */
  createChat(name: string, model: ModelAlias | undefined): string;
  /**
   * Resolves when the chat is free again, to the failure reason of its last turn, or null.
   * A failed turn is no rejection: the session manager turns it into an event.
   */
  send(sessionId: string, prompt: string): Promise<string | null>;
  /**
   * The whole answer of the chat's run, and whether the person wrote in the chat during it. A
   * scheduled run has a fresh chat, so every turn of the chat belongs to the run.
   */
  answerOf(sessionId: string): { readonly text: string; readonly personWrote: boolean };
  /** The run is over. `deliver` false: a quiet run, so its push goes nowhere and its chat goes. */
  endRun(sessionId: string, deliver: boolean): void;
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
}

export interface ScheduleView {
  readonly schedule: Schedule;
  readonly nextRun: string | null;
  /** The `HH:MM` of each run today, for the day line. */
  readonly runsToday: readonly string[];
  /** The slot of the last firing and whether it failed, or null before the first firing. */
  /** `quiet`: the run had nothing to tell (#687). */
  readonly lastRun: { readonly slot: string; readonly failed: boolean; readonly quiet?: boolean | undefined } | null;
  /** The newest runs, newest first. */
  readonly runs: readonly ScheduleRun[];
  /** The slot when the schedule ended, as "Ended" shows it, or null while it can still run. */
  readonly ended: string | null;
}

/** One run of a schedule. `sessionId` is its chat, or null: no prompt, no chat, or a quiet run whose chat Eva deleted. */
export type ScheduleRun = NonNullable<ScheduleState["runs"]>[number];

/** The page shows the newest runs. An hourly schedule must not grow the state file for good. */
const keptRuns = 20;

export interface ScheduleList {
  readonly schedules: ScheduleView[];
  readonly problems: readonly string[];
  /** The zone of every slot, so a front end can draw today in the instance's time. */
  readonly timeZone: string;
  /** The wall-clock time now, as a slot. */
  readonly now: string;
}

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

  /** Every valid schedule with its next and last run, and the problems of the file. */
  list(): ScheduleList {
    const now = wallClockOf(this.options.now(), this.options.timeZone);
    const definitions = readScheduleDefinitions(this.definitionsPath);
    return {
      schedules: definitions.schedules.map((schedule) => {
        const ended = this.endedAt(schedule, now);
        return {
          schedule,
          nextRun: schedule.enabled && ended === null ? this.nextRunOf(schedule, now) : null,
          runsToday: runsOnDay(schedule, now),
          lastRun: this.state.peek(schedule.id)?.lastResult ?? null,
          runs: runsOf(this.state.peek(schedule.id)),
          ended,
        };
      }),
      problems: definitions.problems,
      timeZone: this.options.timeZone,
      now,
    };
  }

  save(entry: Readonly<Record<string, unknown>>): Schedule {
    assertVaultWritable(this.options.vaultPath);
    this.refusePastOnce(entry, null);
    return saveScheduleDefinition(this.definitionsPath, entry);
  }

  /** Changes the form's fields of one schedule. A slot that is due at the next check does not fire. */
  edit(scheduleId: string, fields: Readonly<Record<string, unknown>>): Schedule | null {
    assertVaultWritable(this.options.vaultPath);
    const before = readScheduleDefinitions(this.definitionsPath).schedules.find((entry) => entry.id === scheduleId);
    this.refusePastOnce(fields, before !== undefined && runsOnce(before) ? before.from : null);
    return editScheduleDefinition(this.definitionsPath, scheduleId, fields);
  }

  /**
   * A one-off at a past time would never run, so a save of one throws. An edit that keeps the
   * old time of a one-off passes: a one-off that already ran can still get a new name.
   */
  private refusePastOnce(fields: Readonly<Record<string, unknown>>, keptFrom: string | null): void {
    const from = fields["from"];
    const every = fields["every"];
    if (typeof from !== "string" || (every !== undefined && every !== null) || from === keptFrom) return;
    if (from <= wallClockOf(this.options.now(), this.options.timeZone))
      throw new EvaError("schedule_invalid", `The time ${from.replace("T", " ")} is in the past: pick a later one.`);
  }

  /**
   * The slot when a schedule ended, or null: a [[done]] stopped it, no run is left before its
   * `until` day, or a one-off ran or its time passed before Eva saw it.
   */
  private endedAt(schedule: Schedule, now: string): string | null {
    const state = this.state.peek(schedule.id);
    // A [[done]] ends the schedule, also while it is off (#687).
    if (state?.done !== undefined && state.done !== null) return state.done;
    // No run remains after the until day: the next slot would be after it.
    if (schedule.until !== null && !runsOnce(schedule) && nextSlot(schedule, now) === null)
      return `${schedule.until}T23:59`;
    if (!runsOnce(schedule) || schedule.from === null || schedule.from > now) return null;
    if (state === undefined || state.lastFired === schedule.from || onceSeenAt(schedule, state, now) > schedule.from)
      return schedule.from;
    return null;
  }

  /** The next run. A one-off whose time passed while Eva was off runs at the next check. */
  private nextRunOf(schedule: Schedule, now: string): string | null {
    if (runsOnce(schedule) && this.endedAt(schedule, now) === null && (schedule.from ?? now) <= now) return now;
    return nextSlot(schedule, now);
  }

  remove(scheduleId: string): boolean {
    assertVaultWritable(this.options.vaultPath);
    const removed = removeScheduleDefinition(this.definitionsPath, scheduleId);
    if (removed) this.state.forget(scheduleId);
    return removed;
  }

  /** Turns a schedule off or on. Turning it on skips a slot that is due then. */
  setEnabled(scheduleId: string, enabled: boolean): boolean {
    assertVaultWritable(this.options.vaultPath);
    const changed = setScheduleEnabled(this.definitionsPath, scheduleId, enabled);
    // A check may not run between off and on, so the pause counts now, or on would fire a due slot.
    if (changed && !enabled) this.pause(scheduleId);
    // On again starts a new watch, so the end of the last one goes (#687).
    if (changed && enabled && (this.state.peek(scheduleId)?.done ?? null) !== null)
      this.state.update(scheduleId, { done: null });
    return changed;
  }

  /** True while a check runs: a schedule may be between its chat and its first message. */
  isFiring(): boolean {
    return this.ticking;
  }

  /** One check of every schedule. The core calls it every 30 seconds. */
  async tick(): Promise<void> {
    if (!this.options.isHub()) return;
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
  }

  private async check(schedule: Schedule, now: string): Promise<void> {
    if (!schedule.enabled) {
      this.pause(schedule.id);
      return;
    }
    const seen = this.state.see(schedule.id, now);
    // A one-off counts from when Eva first saw its time, not its id.
    if (runsOnce(schedule) && schedule.from !== null && seen.onceSeen?.from !== schedule.from)
      this.state.update(schedule.id, { onceSeen: { from: schedule.from, at: now } });
    if (!this.isKnown(schedule)) this.learn(schedule, now);
    const state = this.state.peek(schedule.id) ?? seen;
    const slot = dueSlot(schedule, { ...state, firstSeen: onceSeenAt(schedule, state, now) }, now);
    if (slot !== null) await this.fire(schedule, slot, now);
  }

  /** An off schedule never fires. Its state remembers the pause, so on again skips a due slot. */
  private pause(scheduleId: string): void {
    const state = this.state.peek(scheduleId);
    if (state !== undefined && state.paused !== true) this.state.update(scheduleId, { paused: true });
  }

  /** True when Eva saw the schedule's current fields, and no pause came after it. */
  private isKnown(schedule: Schedule): boolean {
    const state = this.state.peek(schedule.id);
    const known = state?.announced ?? null;
    return known !== null && state?.paused !== true && changedFields(known, announcedFields(schedule)).length === 0;
  }

  /**
   * Eva sees a new, changed or resumed schedule. A slot that is already due is skipped, so a
   * change to a time that just passed waits for the next one.
   */
  private learn(schedule: Schedule, now: string): void {
    const state = this.state.peek(schedule.id);
    if (state === undefined) return;
    // A one-off has no later slot, so its run, also a late one, comes at once.
    const slot = runsOnce(schedule) ? null : dueSlot(schedule, state, now);
    this.state.update(schedule.id, {
      announced: announcedFields(schedule),
      paused: false,
      // A schedule that is on again: the end of its last watch goes (#687).
      ...((state.done ?? null) === null ? {} : { done: null }),
      ...(slot === null ? {} : { lastFired: slot }),
    });
  }

  private async fire(schedule: Schedule, slot: string, now: string): Promise<void> {
    const late = isLate(slot, now) ? lateNotes(slot) : null;
    const model = modelAliases.find((alias) => alias === schedule.model);
    // The chat comes first: when it cannot start, the slot does not count as fired, and the next check tries again.
    let sessionId: string | null;
    try {
      sessionId = schedule.prompt === null ? null : this.options.chats.createChat(schedule.name, model);
    } catch (error) {
      this.recordResult(schedule.id, slot, true);
      throw error;
    }
    this.state.update(schedule.id, {
      lastFired: slot,
      ...this.resultChange(schedule.id, { slot, failed: false }, sessionId),
    });
    await this.emit({
      kind: "schedule_fired",
      scheduleId: schedule.id,
      name: schedule.name,
      text:
        late === null || schedule.prompt !== null
          ? schedule.text
          : [late.text, schedule.text].filter(Boolean).join("\n\n"),
      file: schedule.file,
      sessionId,
    });
    this.options.reportFiring?.(schedule, null);
    if (sessionId !== null && schedule.prompt !== null) {
      // Nobody awaits the turn, so its failure goes to the log here (lesson 50).
      const prompt = `${schedule.prompt}\n\n${runNote}`;
      void this.options.chats
        .send(sessionId, late === null ? prompt : `${late.prompt}\n\n${prompt}`)
        .catch((error: unknown) => errorText(error))
        .then((failure) => this.runEnded(schedule, slot, sessionId, failure))
        .catch((error: unknown) => {
          this.options.logger?.log("error", "Eva could not end a scheduled run.", {
            scheduleId: schedule.id,
            reason: errorText(error),
          });
        });
    }
  }

  /**
   * The chat of a run is free. A run with nothing to tell reaches nobody, and a [[done]] ends the
   * schedule (#687). A failed run is never quiet and never ends it: the person must learn of it.
   */
  private runEnded(schedule: Schedule, slot: string, sessionId: string, failure: string | null): void {
    // The run always ends, also when its chat is gone: a held push and "typing" must not wait for good.
    let deliver = true;
    try {
      deliver = this.judgeRun(schedule, slot, sessionId, failure);
    } finally {
      this.options.chats.endRun(sessionId, deliver);
    }
  }

  /** Tells the front ends the answer of the run, and false when the run was quiet. */
  private judgeRun(schedule: Schedule, slot: string, sessionId: string, failure: string | null): boolean {
    const answer = this.options.chats.answerOf(sessionId);
    const markers = extractFileMarkers(answer.text);
    // A [[quiet]] line silences the run, also after text that it wrote while it worked, such as
    // "I check Gmail now". So does a [[done]] with no words. A file still goes out. An answer with
    // no words and no marker, such as a stopped run, is no word from the agent, so it stays.
    const files = markers.attach.length + markers.offer.length;
    const silent = files === 0 && (markers.quiet || (markers.done && markers.text === ""));
    const answered = { kind: "schedule_answered", scheduleId: schedule.id, name: schedule.name, sessionId } as const;
    if (failure !== null) {
      this.promptFailed(schedule, slot, failure);
      void this.emit({ ...answered, text: answer.text, failure });
      return true;
    }
    // Someone who wrote during the run waits for its answer.
    const quiet = !answer.personWrote && silent;
    if (!quiet) void this.emit({ ...answered, text: answer.text, failure: null });
    else if (this.state.peek(schedule.id)?.lastResult?.slot === slot)
      // Eva deletes the chat of a quiet run, so the run keeps no chat.
      this.state.update(schedule.id, this.resultChange(schedule.id, { slot, failed: false, quiet: true }, null));
    if (markers.done) this.endByDone(schedule, slot);
    return !quiet;
  }

  /** A [[done]] works like the person's pause, so turning the schedule on again skips a due slot. */
  private endByDone(schedule: Schedule, slot: string): void {
    try {
      this.setEnabled(schedule.id, false);
    } catch (error) {
      // The vault may be read-only. The phone must still learn that the watch did not stop.
      this.options.reportFiring?.(
        schedule,
        `The run asked to stop the schedule, but Eva could not turn it off: ${errorText(error)}`,
      );
    }
    // The schedule is off now. Only the "Ended" mark may fail, and the list then shows it as off.
    try {
      if (
        readScheduleDefinitions(this.definitionsPath).schedules.find((entry) => entry.id === schedule.id)?.enabled ===
        false
      )
        this.state.update(schedule.id, { done: slot });
    } catch (error) {
      this.options.logger?.log("error", "Eva could not mark the end of a watch.", {
        scheduleId: schedule.id,
        reason: errorText(error),
      });
    }
  }

  private promptFailed(schedule: Schedule, slot: string, failure: string): void {
    this.options.logger?.log("error", "A scheduled prompt failed.", { scheduleId: schedule.id, reason: failure });
    // A turn can end after the next slot fired. That newer run owns the result and the alert now.
    // Not lastFired: a change moves it to a skipped slot, which is no run.
    if (this.state.peek(schedule.id)?.lastResult?.slot !== slot) return;
    // The alert first: a state file that cannot be written must not hide the failure from the phone.
    try {
      this.options.reportFiring?.(schedule, failure);
    } catch (error) {
      this.options.logger?.log("error", "Eva could not report the failed run.", {
        scheduleId: schedule.id,
        reason: errorText(error),
      });
    }
    try {
      this.recordResult(schedule.id, slot, true);
    } catch (error) {
      this.options.logger?.log("error", "Eva could not record the failed run.", {
        scheduleId: schedule.id,
        reason: errorText(error),
      });
    }
  }

  private recordResult(scheduleId: string, slot: string, failed: boolean): void {
    const current = this.state.peek(scheduleId)?.lastResult;
    // A chat that cannot start fails at every check, so the file is written only on a change.
    if (current?.slot === slot && current.failed === failed) return;
    this.state.update(scheduleId, this.resultChange(scheduleId, { slot, failed }));
  }

  /**
   * The last result and the past runs after a result. A result for a slot that is already in the
   * list replaces it, and keeps its chat unless `sessionId` gives one.
   */
  private resultChange(
    scheduleId: string,
    result: { readonly slot: string; readonly failed: boolean; readonly quiet?: boolean },
    sessionId?: string | null,
  ): Pick<ScheduleState, "lastResult" | "runs"> {
    const runs = runsOf(this.state.peek(scheduleId));
    const same = runs.find((run) => run.slot === result.slot);
    const run: ScheduleRun = { ...result, sessionId: sessionId === undefined ? (same?.sessionId ?? null) : sessionId };
    return {
      lastResult: result,
      runs: [run, ...runs.filter((other) => other.slot !== result.slot)].slice(0, keptRuns),
    };
  }

  /** Tells every listener. A listener that throws stops no other. */
  private async emit(event: ScheduleEvent): Promise<void> {
    await Promise.allSettled([...this.listeners].map(async (listener) => await listener(event)));
  }
}

/** A state file from before the past runs knows only the last result. */
function runsOf(state: ScheduleState | undefined): ScheduleRun[] {
  if (state?.runs !== undefined) return state.runs;
  const last = state?.lastResult ?? null;
  return last === null ? [] : [{ ...last, sessionId: null }];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Only a one-off fires long after its slot (#822), so the person must learn that it comes late.
 * With a prompt, the answer says it; without one, a line before the text says it.
 */
function lateNotes(slot: string): { text: string; prompt: string } {
  // No cause: Eva was off, or a chat could not start.
  const due = `it was due at ${slot.replace("T", " ")}`;
  return {
    text: `This message comes late: ${due}.`,
    prompt: `[This scheduled run comes late: ${due}. Say so in one short sentence at the start of your answer.]`,
  };
}

/**
 * Each scheduled prompt ends with this note, so the agent learns the markers. A normal chat gets
 * no note and pays no tokens for it (#687).
 */
const runNote =
  "[A scheduled run. When nothing is worth telling the person, end your answer with a line [[quiet]]: nobody gets a message. When the job of this schedule is over for good, add a line [[done]]: Eva turns the schedule off.]";

/**
 * When Eva first saw the time of a one-off. A time that she did not check yet counts as seen now,
 * as the next check records it. Any other schedule counts from when Eva first saw its id.
 */
function onceSeenAt(schedule: Schedule, state: ScheduleState, now: string): string {
  if (!runsOnce(schedule)) return state.firstSeen;
  return state.onceSeen?.from === schedule.from ? state.onceSeen.at : now;
}
