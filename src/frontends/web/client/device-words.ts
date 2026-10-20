/** The words of the device list: a name, a browser and an icon from a stored label, and the allowed date. */
import { chatTime, daysBefore } from "./chat-list.ts";

export interface DeviceWords {
  readonly name: string;
  readonly browser: string;
  readonly account: string | null;
  readonly icon: "phone" | "laptop";
}

// The first match wins, so a tablet comes before the system that it runs.
const systems: readonly (readonly [RegExp, string, DeviceWords["icon"]])[] = [
  [/iPhone/, "iPhone", "phone"],
  [/iPad/, "iPad", "phone"],
  // The label often cuts the user agent before "Mobile", so it cannot tell an Android phone from a tablet.
  [/Android/, "Android", "phone"],
  [/Windows/, "Windows computer", "laptop"],
  [/CrOS/, "Chromebook", "laptop"],
  [/Macintosh|Mac OS X/, "Mac", "laptop"],
  [/Linux|X11/, "Linux computer", "laptop"],
];

// Edge and Opera also send "Chrome", and every browser on an iPhone sends "Safari", so they come first.
const browsers: readonly (readonly [RegExp, string])[] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\/|Version\//, "Safari"],
];

/**
 * The label is "account, user agent" (the local API makes it), and only its start: the API cuts a
 * long user agent. An older or unknown label keeps its text, so the person still tells devices apart.
 */
export function describeDevice(label: string): DeviceWords {
  const comma = label.indexOf(", ");
  const account = comma === -1 ? null : label.slice(0, comma);
  const agent = comma === -1 ? label : label.slice(comma + 2);
  const system = systems.find(([pattern]) => pattern.test(agent));
  const browser = browsers.find(([pattern]) => pattern.test(agent));
  return {
    name: system?.[1] ?? "Device",
    browser: browser?.[1] ?? agent,
    account,
    icon: system?.[2] ?? "laptop",
  };
}

/** "allowed today", "allowed 3 days ago" or "allowed 2 Sep". Eva stores no last use, only the allowed date. */
export function allowedWords(createdAt: string, now: Date): string {
  const at = new Date(createdAt);
  const days = daysBefore(at, now);
  if (Number.isNaN(days)) return "allowed";
  if (days <= 0) return "allowed today";
  if (days === 1) return "allowed yesterday";
  if (days < 7) return `allowed ${String(days)} days ago`;
  return `allowed ${chatTime(at, now)}`;
}
