/** The one line that every front end shows for a usage limit, so they all say the same thing. */
import type { EngineEventPayload, UsageWindow } from "./events.ts";

export type UsageLimit = Extract<EngineEventPayload, { kind: "usage_limit" }>;

const windowNames: Record<UsageWindow, string> = {
  five_hour: "5-hour usage limit",
  seven_day: "weekly usage limit",
  seven_day_opus: "weekly Opus usage limit",
  seven_day_sonnet: "weekly Sonnet usage limit",
  overage: "extra usage limit",
  other: "usage limit",
};

/** With no time zone, the line uses the zone of the machine or the browser. */
export function describeUsageLimit(limit: UsageLimit, now: Date, timeZone?: string): string {
  const name = windowNames[limit.window];
  const state =
    limit.status === "rejected"
      ? `You reached your ${name}.`
      : limit.usedPercent === null
        ? `You are near your ${name}.`
        : `You used ${String(limit.usedPercent)}% of your ${name}.`;
  const resetsAt = new Date(limit.resetsAt ?? Number.NaN);
  // A stored or relayed event can hold any text, and Intl throws on an invalid date.
  if (Number.isNaN(resetsAt.getTime())) return state;
  return `${state} It resets ${resetText(resetsAt, now, validZone(timeZone))}.`;
}

/** True once the window has reset, so a line that stays on screen stops saying the person is blocked. */
export function hasReset(limit: UsageLimit, now: Date): boolean {
  return limit.resetsAt !== null && new Date(limit.resetsAt).getTime() <= now.getTime();
}

function resetText(at: Date, now: Date, timeZone: string | undefined): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" });
  if (date.format(at) === date.format(now)) return `at ${time.format(at)}`;
  return `on ${date.format(at).replace(",", "")} at ${time.format(at)}`;
}

/** A bad time zone setting must never stop the line. */
function validZone(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined) return undefined;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}
