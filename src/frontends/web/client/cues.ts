/**
 * EVE's sounds and the phone's vibration for the moments of a chat: a tap, a send, an answer, a
 * question, a save and a problem. The browser makes each sound from sine waves at play time, so the
 * page loads no audio file. The sounds copy EVE of WALL·E: short, glassy chirps that glide in pitch,
 * and her two-note call "Ee-vah" for an answer.
 *
 * Each browser keeps its own levels in `localStorage`, as the appearance: a phone on a train needs
 * other levels than a desktop.
 */
import type { SessionEvent } from "../../../shared/events.ts";

export type Cue = "tap" | "send" | "answer" | "question" | "saved" | "problem";
export type SoundLevel = "off" | "quiet" | "normal" | "loud";
export type VibrationLevel = "off" | "light" | "strong";

export interface CueLevels {
  readonly sound: SoundLevel;
  readonly vibration: VibrationLevel;
}

/** One tone: a pitch glide from `from` to `to` in hertz, `at` seconds after the cue starts. */
export interface Tone {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly seconds: number;
  /** The loudness of this tone in its cue, from 0 to 1. */
  readonly gain: number;
}

/** The order of the preview buttons in Settings. */
export const cues: readonly Cue[] = ["tap", "send", "answer", "question", "saved", "problem"];

/** Every cue ends in less than half a second, so a cue never talks over the next one. */
export const cueTones: Record<Cue, readonly Tone[]> = {
  // A small glass tick.
  tap: [{ from: 1900, to: 2300, at: 0, seconds: 0.035, gain: 0.5 }],
  // EVE takes off: one fast rise.
  send: [
    { from: 520, to: 1500, at: 0, seconds: 0.13, gain: 0.8 },
    { from: 1500, to: 2100, at: 0.1, seconds: 0.08, gain: 0.35 },
  ],
  // "Ee-vah": a high note, then a lower note that falls.
  answer: [
    { from: 1480, to: 1640, at: 0, seconds: 0.11, gain: 0.85 },
    { from: 1180, to: 880, at: 0.14, seconds: 0.2, gain: 0.95 },
  ],
  // "Hm-hm?": two rises, the second one higher, as a question.
  question: [
    { from: 900, to: 1250, at: 0, seconds: 0.09, gain: 0.8 },
    { from: 1200, to: 1950, at: 0.13, seconds: 0.15, gain: 0.9 },
  ],
  // Two quick notes up: a happy "done".
  saved: [
    { from: 1320, to: 1320, at: 0, seconds: 0.07, gain: 0.7 },
    { from: 1760, to: 1780, at: 0.08, seconds: 0.12, gain: 0.8 },
  ],
  // "Oh-oh": two falls, the second one lower.
  problem: [
    { from: 760, to: 560, at: 0, seconds: 0.12, gain: 0.85 },
    { from: 560, to: 330, at: 0.15, seconds: 0.22, gain: 0.95 },
  ],
};

/**
 * The shortest vibration that every phone can feel. Many Android phones have a slow motor that needs
 * about 25 ms to spin up, so a shorter vibration does nothing there.
 */
export const minimumVibrationMs = 25;

/** On and off times in milliseconds, as `navigator.vibrate` takes them, at the light level. */
const lightVibrations: Record<Cue, readonly number[]> = {
  tap: [25],
  send: [30],
  answer: [30, 60, 40],
  question: [30, 70, 30, 70, 30],
  saved: [25, 50, 30],
  problem: [50, 50, 50],
};

const soundGains: Record<SoundLevel, number> = { off: 0, quiet: 0.12, normal: 0.3, loud: 0.65 };

const storageKey = "eva.cues";
export const defaultCueLevels: CueLevels = { sound: "quiet", vibration: "light" };

/** A private window or blocked storage throws or holds nothing: the page then uses the defaults. */
export function readCueLevels(): CueLevels {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Record<string, unknown>>;
    const sound = stored["sound"];
    const vibration = stored["vibration"];
    return {
      sound:
        sound === "off" || sound === "quiet" || sound === "normal" || sound === "loud" ? sound : defaultCueLevels.sound,
      vibration:
        vibration === "off" || vibration === "light" || vibration === "strong" ? vibration : defaultCueLevels.vibration,
    };
  } catch {
    return defaultCueLevels;
  }
}

export function saveCueLevels(levels: CueLevels): void {
  current = levels;
  try {
    localStorage.setItem(storageKey, JSON.stringify(levels));
  } catch {
    // The levels still apply until the page reloads.
  }
}

/** The cue of an event from the core, or null for an event with no sound. */
export function cueOfEvent(event: SessionEvent): Cue | null {
  if (event.kind === "turn_finished") return "answer";
  if (event.kind === "turn_failed") return "problem";
  if (event.kind === "approval_needed") return "question";
  return null;
}

/** The vibration of a cue. The web cannot set the strength of a vibration, so "strong" makes it longer. */
export function vibrationPattern(cue: Cue, level: VibrationLevel): number[] {
  if (level === "off") return [];
  const factor = level === "strong" ? 2.5 : 1;
  // The even places are vibrations, the odd places are pauses.
  return lightVibrations[cue].map((ms, index) => (index % 2 === 0 ? Math.round(ms * factor) : ms));
}

/** The part of the Web Audio API that the cues use, so a test can listen without a browser. */
export interface AudioOutput {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    readonly frequency: AudioRamp;
    connect(target: unknown): unknown;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): { readonly gain: AudioRamp; connect(target: unknown): unknown };
}

interface AudioRamp {
  setValueAtTime(value: number, when: number): unknown;
  exponentialRampToValueAtTime(value: number, when: number): unknown;
}

export interface CueDevices {
  /** Null when the browser has no Web Audio. */
  readonly audio: () => AudioOutput | null;
  /** Undefined when the browser cannot vibrate, as on an iPhone. */
  readonly vibrate: ((pattern: number[]) => unknown) | undefined;
}

/** Plays one cue at the given levels. A failure stays silent: a sound is never worth an error. */
export function playCue(cue: Cue, levels: CueLevels = current, devices: CueDevices = browserDevices): void {
  try {
    const pattern = vibrationPattern(cue, levels.vibration);
    if (pattern.length > 0) devices.vibrate?.(pattern);
    const gain = soundGains[levels.sound];
    if (gain === 0) return;
    const audio = devices.audio();
    if (audio === null) return;
    // A browser starts audio suspended until the person touches the page.
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
    for (const tone of cueTones[cue]) playTone(audio, tone, gain);
  } catch {
    // The page works the same without the cue.
  }
}

/** A sine with its octave, for glass. The volume rises in 8 ms and fades out, so no tone clicks. */
function playTone(audio: AudioOutput, tone: Tone, master: number): void {
  const start = audio.currentTime + tone.at;
  const end = start + tone.seconds;
  for (const [multiple, share] of [
    [1, 1],
    [2, 0.18],
  ] as const) {
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.from * multiple, start);
    oscillator.frequency.exponentialRampToValueAtTime(tone.to * multiple, end);
    // An exponential ramp cannot start or end at 0.
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(master * tone.gain * share, start + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(volume);
    volume.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

let current: CueLevels = defaultCueLevels;
let context: AudioOutput | null = null;

const browserDevices: CueDevices = {
  audio: () => {
    if (context !== null) return context;
    if (typeof AudioContext === "undefined") return null;
    context = new AudioContext();
    return context;
  },
  vibrate:
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
      ? (pattern) => {
          // Before the first touch, Chrome refuses the vibration and logs an error.
          if (navigator.userActivation.hasBeenActive) navigator.vibrate(pattern);
        }
      : undefined,
};

/** True when this browser can vibrate. An iPhone cannot: Safari has no vibration for a web page. */
export function canVibrate(devices: CueDevices = browserDevices): boolean {
  return devices.vibrate !== undefined;
}

/**
 * Loads the levels, and plays a cue on each button press of the page. A button picks its cue with
 * `data-cue`, and `data-cue="none"` keeps it silent, as for a button whose action plays its own cue.
 */
export function startCues(root: Pick<Document, "addEventListener"> = document): void {
  current = readCueLevels();
  root.addEventListener("click", (event) => {
    const cue = cueOfClick(event.target);
    if (cue !== null) playCue(cue);
  });
}

/** The cue of a click on this element, or null when it is not on an enabled button. */
export function cueOfClick(target: EventTarget | null): Cue | null {
  const element = target as { closest?: (selector: string) => HTMLElement | null } | null;
  const button = element?.closest?.("button:not(:disabled)") ?? null;
  if (button === null) return null;
  const named = button.dataset["cue"];
  if (named === "none") return null;
  return cues.find((cue) => cue === named) ?? "tap";
}
