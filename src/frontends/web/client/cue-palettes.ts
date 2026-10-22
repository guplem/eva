/**
 * The sound palettes of the cues. A palette gives a sound to each of the six moments of a chat. The browser
 * builds each sound at play time from waves and noise, so the page loads no audio file. `cues.ts` plays them.
 *
 * The order is the order of the choice in Settings. The first palette is the default.
 */
import type { IconName } from "./icons.tsx";

export type Cue = "tap" | "send" | "answer" | "question" | "saved" | "problem";

/** One overtone of a voice: its multiple of the pitch, its share of the loudness and of the length, a detune in cents. */
export type Overtone = readonly [multiple: number, share: number, length?: number, cents?: number];

/** One sound of a cue: a tone, or a burst of noise when `noise` is true. */
export interface Voice {
  /** The start pitch in hertz. A noise voice ignores it. */
  readonly pitch: number;
  /** The end pitch of a glide, in hertz. */
  readonly to?: number;
  /** The length of the glide in seconds. The default is the whole voice. */
  readonly glide?: number;
  /** Seconds after the cue starts. */
  readonly at?: number;
  readonly seconds: number;
  /** The loudness of this voice in its cue, from 0 to 1. */
  readonly gain: number;
  /** Seconds to full volume. A short attack clicks less than none. */
  readonly attack?: number;
  /** Seconds at full volume before the fade. */
  readonly hold?: number;
  readonly wave?: "sine" | "triangle" | "square" | "sawtooth";
  readonly partials?: readonly Overtone[];
  readonly filter?: {
    readonly type?: "lowpass" | "highpass" | "bandpass";
    readonly from: number;
    readonly to?: number;
    readonly seconds?: number;
    readonly q?: number;
  };
  /** From -1 (left) to 1 (right). */
  readonly pan?: number;
  /** A second wave that bends the pitch fast: a digital, bell-like edge that fades in `seconds`. */
  readonly fm?: { readonly ratio: number; readonly depth: number; readonly seconds: number };
  readonly vibrato?: { readonly rate: number; readonly cents: number };
  readonly noise?: true;
}

export type PaletteId =
  "coin" | "orbit" | "fluent" | "kalimba" | "halo" | "aurora" | "crystal" | "pulse" | "blocks" | "eve";

export interface Palette {
  readonly id: PaletteId;
  readonly label: string;
  readonly icon: IconName;
  /** One sentence for the hint in Settings. */
  readonly sound: string;
  /** A reverb: the voices sound in a room of this size. */
  readonly room?: {
    readonly seconds: number;
    readonly decay: number;
    readonly mix: number;
    /** From 0 (a dark room) to 1 (a bright room). */
    readonly brightness: number;
  };
  /** Repeats of the cue, each one quieter, that alternate between left and right. */
  readonly echo?: { readonly seconds: number; readonly feedback: number; readonly mix: number };
  readonly cues: Readonly<Record<Cue, readonly Voice[]>>;
}

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The pitch of a note name in hertz, such as 440 for "A4". */
export function note(name: string): number {
  const match = /^([A-G]#?)(\d)$/.exec(name);
  if (match === null) throw new Error(`Unknown note: ${name}`);
  const steps = noteNames.indexOf(match[1] ?? "") - 9 + (Number(match[2]) - 4) * 12;
  return 440 * 2 ** (steps / 12);
}

const n = note;

/** The timbres: the overtones that make a sine sound as glass, wood, a pluck or a pad. */
const timbres = {
  pure: [
    [1, 1],
    [2, 0.12, 0.6],
  ],
  eve: [
    [1, 1],
    [2, 0.18],
  ],
  // Two sines a little apart in pitch and in the stereo field sound wide.
  wide: [
    [1, 0.6, 1, -5],
    [1, 0.6, 1, 5],
    [2, 0.08, 0.7],
  ],
  // The overtones of a bell are not whole multiples, and the high ones fade first.
  glass: [
    [1, 1],
    [2.76, 0.3, 0.45],
    [5.4, 0.12, 0.25],
    [8.93, 0.05, 0.14],
  ],
  mallet: [
    [1, 1],
    [3.99, 0.16, 0.25],
    [10, 0.04, 0.1],
  ],
  soft: [
    [1, 1],
    [2, 0.1, 0.6],
    [3, 0.05, 0.3],
  ],
  harp: [
    [1, 1],
    [2, 0.4, 0.6],
    [3, 0.18, 0.4],
    [4, 0.1, 0.3],
    [5, 0.05, 0.2],
  ],
  pling: [
    [1, 1],
    [2, 0.5, 0.7],
    [3, 0.28, 0.5],
    [4, 0.16, 0.4],
    [6, 0.07, 0.25],
  ],
  kalimba: [
    [1, 1],
    [5.8, 0.14, 0.16],
    [2, 0.06, 0.5],
  ],
  pad: [
    [1, 0.55, 1, -8],
    [1, 0.55, 1, 8],
    [2, 0.14, 0.9, -4],
    [3, 0.04, 0.7, 5],
  ],
  bass: [
    [1, 1],
    [2, 0.45, 0.6],
    [3, 0.2, 0.4],
    [4, 0.1, 0.3],
  ],
} satisfies Record<string, readonly Overtone[]>;

const blip = (pitch: number, at: number, seconds: number, gain: number, cutoff: number): Voice => ({
  pitch,
  at,
  seconds,
  gain,
  wave: "square",
  filter: { from: cutoff },
  attack: 0.001,
});

const pluck = (partials: readonly Overtone[], pitch: number, at: number, seconds: number, gain: number): Voice => ({
  pitch,
  at,
  seconds,
  gain,
  partials,
  attack: 0.002,
});

const aurora = { from: 900, to: 6000, seconds: 0.5 };

export const palettes: readonly Palette[] = [
  // After a payment app: round bubbles, short marimbas, and a "payment done" sparkle for a save.
  {
    id: "coin",
    label: "Coin",
    icon: "bubbles",
    sound: "Round bubbles and short marimbas. A save sounds like a payment that went through.",
    room: { seconds: 0.8, decay: 4, mix: 0.18, brightness: 0.6 },
    cues: {
      tap: [{ pitch: 500, to: 1050, glide: 0.03, seconds: 0.06, gain: 0.26, attack: 0.002 }],
      send: [
        { pitch: 380, to: 1250, glide: 0.13, seconds: 0.16, gain: 0.32, partials: timbres.pure },
        { pitch: 1400, to: 1900, at: 0.12, glide: 0.04, seconds: 0.07, gain: 0.15 },
      ],
      answer: [pluck(timbres.mallet, n("G5"), 0, 0.45, 0.34), pluck(timbres.mallet, n("D6"), 0.085, 0.55, 0.36)],
      question: [
        pluck(timbres.mallet, n("E6"), 0, 0.3, 0.3),
        { pitch: 900, to: 1500, at: 0.11, glide: 0.06, seconds: 0.09, gain: 0.22, attack: 0.003 },
      ],
      saved: [
        pluck(timbres.mallet, n("C6"), 0, 0.4, 0.3),
        pluck(timbres.mallet, n("G6"), 0.07, 0.5, 0.32),
        { pitch: n("C7"), at: 0.14, seconds: 0.25, gain: 0.1, pan: -0.3 },
        { pitch: n("E7"), at: 0.16, seconds: 0.25, gain: 0.07, pan: 0.3 },
        { pitch: 0, noise: true, at: 0.14, seconds: 0.12, gain: 0.04, filter: { type: "highpass", from: 8000 } },
      ],
      problem: [
        { ...pluck(timbres.mallet, n("E4"), 0, 0.3, 0.45), to: 310, glide: 0.3 },
        { ...pluck(timbres.mallet, n("C4"), 0.13, 0.4, 0.45), to: 245, glide: 0.4 },
      ],
    },
  },
  // After the screens of a spaceship: exact digital pulses with a short echo.
  {
    id: "orbit",
    label: "Orbit",
    icon: "orbit",
    sound: "Exact digital pulses with a short echo, as data that comes and goes.",
    room: { seconds: 1, decay: 4, mix: 0.15, brightness: 0.5 },
    echo: { seconds: 0.09, feedback: 0.35, mix: 0.28 },
    cues: {
      tap: [blip(2400, 0, 0.025, 0.08, 4500)],
      send: [
        blip(1200, 0, 0.03, 0.07, 5000),
        blip(1600, 0.035, 0.03, 0.07, 5000),
        blip(2400, 0.07, 0.03, 0.07, 5000),
        { pitch: 600, to: 2400, glide: 0.12, seconds: 0.13, gain: 0.1 },
      ],
      answer: [
        { pitch: 880, seconds: 0.2, gain: 0.22, fm: { ratio: 2, depth: 2.5, seconds: 0.09 }, attack: 0.002 },
        { pitch: 1320, at: 0.1, seconds: 0.32, gain: 0.22, partials: timbres.pure },
      ],
      question: [
        blip(1320, 0, 0.05, 0.1, 4000),
        blip(1320, 0.07, 0.05, 0.1, 4000),
        { pitch: 1760, to: 2349, at: 0.14, glide: 0.12, seconds: 0.16, gain: 0.2, partials: timbres.pure },
      ],
      saved: [
        blip(n("C6"), 0, 0.035, 0.07, 5000),
        blip(n("E6"), 0.03, 0.035, 0.07, 5000),
        blip(n("G6"), 0.06, 0.035, 0.07, 5000),
        blip(n("C7"), 0.09, 0.035, 0.07, 5000),
        { pitch: n("C7"), at: 0.12, seconds: 0.35, gain: 0.15, partials: timbres.pure },
      ],
      problem: [
        {
          pitch: 330,
          to: 220,
          glide: 0.2,
          seconds: 0.24,
          gain: 0.12,
          wave: "sawtooth",
          filter: { from: 1400, to: 500 },
        },
        {
          pitch: 220,
          to: 150,
          at: 0.17,
          glide: 0.25,
          seconds: 0.3,
          gain: 0.12,
          wave: "sawtooth",
          filter: { from: 1100, to: 300 },
        },
      ],
    },
  },
  // After the calm notifications of a desktop system: soft mallets on a pentatonic scale.
  {
    id: "fluent",
    label: "Fluent",
    icon: "panes",
    sound: "Soft mallets in a warm room. Calm and kind, the most neutral palette.",
    room: { seconds: 2, decay: 3, mix: 0.35, brightness: 0.45 },
    cues: {
      tap: [{ pitch: n("C6"), seconds: 0.08, gain: 0.2, partials: timbres.soft, attack: 0.003 }],
      send: [
        { pitch: n("D6"), seconds: 0.3, gain: 0.24, partials: timbres.soft, attack: 0.006 },
        { pitch: n("A6"), at: 0.07, seconds: 0.4, gain: 0.22, partials: timbres.soft, attack: 0.006 },
      ],
      answer: [
        { pitch: n("A5"), seconds: 0.9, gain: 0.26, partials: timbres.soft, attack: 0.006, pan: -0.2 },
        { pitch: n("E6"), at: 0.09, seconds: 0.9, gain: 0.24, partials: timbres.soft, attack: 0.006, pan: 0.2 },
        { pitch: n("C#6"), at: 0.18, seconds: 0.9, gain: 0.24, partials: timbres.soft, attack: 0.006 },
      ],
      question: [
        { pitch: n("C#6"), seconds: 0.5, gain: 0.25, partials: timbres.soft, attack: 0.006 },
        { pitch: n("F#6"), at: 0.11, seconds: 0.7, gain: 0.24, partials: timbres.soft, attack: 0.006 },
      ],
      saved: [
        { pitch: n("E6"), seconds: 0.7, gain: 0.2, partials: timbres.soft, attack: 0.006 },
        { pitch: n("A6"), seconds: 0.7, gain: 0.18, partials: timbres.soft, attack: 0.006 },
        { pitch: n("C#7"), at: 0.08, seconds: 0.6, gain: 0.14, partials: timbres.soft, attack: 0.006 },
      ],
      problem: [
        { pitch: n("C#5"), seconds: 0.4, gain: 0.3, partials: timbres.soft, filter: { from: 2000 }, attack: 0.006 },
        {
          pitch: n("F#4"),
          at: 0.13,
          seconds: 0.6,
          gain: 0.34,
          partials: timbres.soft,
          filter: { from: 1500 },
          attack: 0.006,
        },
      ],
    },
  },
  // After a music box: plucked metal tines, warm and acoustic.
  {
    id: "kalimba",
    label: "Kalimba",
    icon: "kalimba",
    sound: "Plucked metal tines, warm and acoustic, as a music box.",
    room: { seconds: 1.5, decay: 3, mix: 0.3, brightness: 0.5 },
    cues: {
      tap: [pluck(timbres.kalimba, n("G6"), 0, 0.18, 0.14)],
      send: [pluck(timbres.kalimba, n("E6"), 0, 0.45, 0.24), pluck(timbres.kalimba, n("G6"), 0.07, 0.5, 0.24)],
      answer: [
        pluck(timbres.kalimba, n("C6"), 0, 0.9, 0.26),
        pluck(timbres.kalimba, n("G6"), 0.08, 0.9, 0.24),
        pluck(timbres.kalimba, n("E6"), 0.16, 1, 0.26),
      ],
      question: [pluck(timbres.kalimba, n("G5"), 0, 0.6, 0.28), pluck(timbres.kalimba, n("D6"), 0.12, 0.8, 0.26)],
      saved: [
        pluck(timbres.kalimba, n("C6"), 0, 0.8, 0.22),
        pluck(timbres.kalimba, n("G6"), 0, 0.8, 0.2),
        pluck(timbres.kalimba, n("C7"), 0.08, 0.8, 0.18),
      ],
      problem: [pluck(timbres.kalimba, n("A5"), 0, 0.5, 0.26), pluck(timbres.kalimba, n("F5"), 0.14, 0.7, 0.28)],
    },
  },
  // After Eva herself: pure, open sines that spread from left to right, so the sound expands.
  {
    id: "halo",
    label: "Halo",
    icon: "halo",
    sound: "Pure, open tones that spread from left to right. An answer is a chord that opens.",
    room: { seconds: 2.6, decay: 3, mix: 0.55, brightness: 0.5 },
    cues: {
      tap: [
        { pitch: n("B6"), to: n("A6"), seconds: 0.07, gain: 0.22, partials: timbres.pure, attack: 0.002 },
        { pitch: 0, noise: true, seconds: 0.03, gain: 0.03, filter: { type: "highpass", from: 7000 } },
      ],
      send: [
        {
          pitch: 0,
          noise: true,
          seconds: 0.34,
          attack: 0.14,
          gain: 0.12,
          filter: { type: "bandpass", from: 500, to: 6000, q: 1.4 },
        },
        { pitch: n("E5"), to: n("B5"), glide: 0.18, seconds: 0.26, attack: 0.02, gain: 0.3, partials: timbres.wide },
      ],
      answer: [
        { pitch: n("E5"), seconds: 1.1, attack: 0.015, gain: 0.3, partials: timbres.wide, pan: -0.45 },
        { pitch: n("B5"), at: 0.06, seconds: 1, attack: 0.015, gain: 0.24, partials: timbres.wide },
        { pitch: n("F#6"), at: 0.12, seconds: 0.95, attack: 0.015, gain: 0.17, partials: timbres.wide, pan: 0.45 },
      ],
      question: [
        { pitch: n("B5"), seconds: 0.35, gain: 0.28, partials: timbres.wide, pan: -0.2 },
        {
          pitch: n("F#6"),
          to: n("G#6"),
          at: 0.14,
          glide: 0.3,
          seconds: 0.5,
          gain: 0.22,
          partials: timbres.wide,
          pan: 0.25,
        },
      ],
      saved: [
        { pitch: n("E6"), seconds: 0.6, gain: 0.24, partials: timbres.pure, attack: 0.003 },
        { pitch: n("B6"), seconds: 0.55, gain: 0.17, partials: timbres.pure, attack: 0.003 },
        { pitch: n("E7"), at: 0.07, seconds: 0.5, gain: 0.07, pan: 0.3 },
      ],
      problem: [
        { pitch: n("D5"), seconds: 0.3, gain: 0.3, partials: timbres.wide, filter: { from: 1800 } },
        { pitch: n("A4"), at: 0.15, seconds: 0.5, gain: 0.32, partials: timbres.wide, filter: { from: 1400, to: 600 } },
      ],
    },
  },
  // After science fiction scores: slow pads in a large room, with a filter that opens.
  {
    id: "aurora",
    label: "Aurora",
    icon: "aurora",
    sound: "Slow pads in a large room. The most spacious palette, and the longest.",
    room: { seconds: 4, decay: 2.2, mix: 0.8, brightness: 0.35 },
    cues: {
      tap: [{ pitch: n("E6"), seconds: 0.18, gain: 0.16, partials: timbres.pad, attack: 0.008 }],
      send: [
        {
          pitch: 0,
          noise: true,
          seconds: 0.5,
          attack: 0.25,
          gain: 0.07,
          filter: { type: "bandpass", from: 400, to: 4000, q: 0.8 },
        },
        {
          pitch: n("A4"),
          to: n("E5"),
          glide: 0.3,
          seconds: 0.5,
          attack: 0.08,
          gain: 0.2,
          partials: timbres.pad,
          filter: { from: 600, to: 5000, seconds: 0.35 },
        },
      ],
      answer: [
        {
          pitch: n("A4"),
          seconds: 1.4,
          attack: 0.08,
          hold: 0.12,
          gain: 0.15,
          partials: timbres.pad,
          pan: -0.5,
          filter: aurora,
        },
        {
          pitch: n("E5"),
          at: 0.05,
          seconds: 1.35,
          attack: 0.08,
          hold: 0.12,
          gain: 0.13,
          partials: timbres.pad,
          pan: 0.5,
          filter: aurora,
        },
        {
          pitch: n("B5"),
          at: 0.1,
          seconds: 1.3,
          attack: 0.08,
          hold: 0.1,
          gain: 0.11,
          partials: timbres.pad,
          pan: -0.2,
          filter: aurora,
        },
        {
          pitch: n("C#6"),
          at: 0.15,
          seconds: 1.25,
          attack: 0.08,
          hold: 0.1,
          gain: 0.1,
          partials: timbres.pad,
          pan: 0.3,
          filter: aurora,
        },
      ],
      question: [
        { pitch: n("E5"), seconds: 0.6, attack: 0.05, gain: 0.17, partials: timbres.pad, pan: -0.3 },
        {
          pitch: n("B5"),
          to: n("C#6"),
          at: 0.16,
          glide: 0.4,
          seconds: 0.8,
          attack: 0.05,
          gain: 0.15,
          partials: timbres.pad,
          pan: 0.3,
        },
      ],
      saved: [
        { pitch: n("E6"), seconds: 1, attack: 0.03, gain: 0.12, partials: timbres.pad, pan: -0.4 },
        { pitch: n("B6"), at: 0.03, seconds: 1, attack: 0.03, gain: 0.1, partials: timbres.pad, pan: 0.4 },
        { pitch: n("E7"), at: 0.06, seconds: 0.9, attack: 0.03, gain: 0.05, partials: timbres.pad },
      ],
      problem: [
        {
          pitch: n("D5"),
          to: n("A4"),
          glide: 0.5,
          seconds: 0.8,
          attack: 0.04,
          gain: 0.22,
          partials: timbres.pad,
          filter: { from: 3000, to: 700, seconds: 0.6 },
        },
      ],
    },
  },
  // After the glass alerts of a desktop system: bells with inharmonic overtones, and a breath of air to send.
  {
    id: "crystal",
    label: "Crystal",
    icon: "gem",
    sound: "Glass bells, and a breath of air when you send. Elegant and clear.",
    room: { seconds: 1.3, decay: 3.5, mix: 0.3, brightness: 0.6 },
    cues: {
      tap: [{ pitch: n("E7"), seconds: 0.14, gain: 0.15, partials: timbres.glass, attack: 0.001 }],
      send: [
        {
          pitch: 0,
          noise: true,
          seconds: 0.36,
          attack: 0.16,
          gain: 0.28,
          filter: { type: "bandpass", from: 350, to: 2800, q: 0.9 },
        },
        { pitch: n("G6"), at: 0.26, seconds: 0.3, gain: 0.06, partials: timbres.glass },
      ],
      answer: [
        { pitch: n("D6"), seconds: 1.2, gain: 0.25, partials: timbres.glass, attack: 0.001, pan: -0.15 },
        { pitch: n("G6"), at: 0.09, seconds: 1.3, gain: 0.23, partials: timbres.glass, attack: 0.001, pan: 0.15 },
      ],
      question: [
        { pitch: n("A6"), seconds: 0.6, gain: 0.21, partials: timbres.glass, attack: 0.001 },
        { pitch: n("D7"), at: 0.12, seconds: 0.8, gain: 0.19, partials: timbres.glass, attack: 0.001 },
      ],
      saved: [
        { pitch: n("C6"), seconds: 0.7, gain: 0.17, partials: timbres.glass, attack: 0.001, pan: -0.3 },
        { pitch: n("E6"), at: 0.05, seconds: 0.7, gain: 0.17, partials: timbres.glass, attack: 0.001, pan: -0.1 },
        { pitch: n("G6"), at: 0.1, seconds: 0.7, gain: 0.17, partials: timbres.glass, attack: 0.001, pan: 0.1 },
        { pitch: n("C7"), at: 0.15, seconds: 0.8, gain: 0.15, partials: timbres.glass, attack: 0.001, pan: 0.3 },
      ],
      problem: [
        { pitch: n("A3"), seconds: 0.3, gain: 0.4, partials: timbres.bass, filter: { from: 900 }, attack: 0.003 },
        {
          pitch: n("E3"),
          at: 0.14,
          seconds: 0.4,
          gain: 0.42,
          partials: timbres.bass,
          filter: { from: 700 },
          attack: 0.003,
        },
      ],
    },
  },
  // After minimal hardware: dry clicks, ticks and a small low thump.
  {
    id: "pulse",
    label: "Pulse",
    icon: "pulse",
    sound: "Dry, very short clicks and ticks. You almost do not hear them, but you feel them.",
    cues: {
      tap: [
        { pitch: 0, noise: true, seconds: 0.01, gain: 0.25, attack: 0.0005, filter: { type: "highpass", from: 3500 } },
        { pitch: 3000, seconds: 0.014, gain: 0.08, attack: 0.0005 },
      ],
      send: [
        { pitch: 170, to: 55, glide: 0.07, seconds: 0.1, gain: 0.5, attack: 0.001 },
        { pitch: 0, noise: true, seconds: 0.012, gain: 0.2, attack: 0.0005, filter: { type: "highpass", from: 4000 } },
      ],
      answer: [
        { pitch: n("A6"), seconds: 0.06, gain: 0.22, attack: 0.001 },
        { pitch: n("E7"), at: 0.075, seconds: 0.08, gain: 0.2, attack: 0.001 },
      ],
      question: [
        { pitch: n("A6"), seconds: 0.05, gain: 0.2, attack: 0.001 },
        { pitch: n("A6"), at: 0.065, seconds: 0.05, gain: 0.2, attack: 0.001 },
        { pitch: n("D7"), at: 0.13, seconds: 0.06, gain: 0.2, attack: 0.001 },
      ],
      saved: [
        { pitch: 120, to: 50, glide: 0.06, seconds: 0.08, gain: 0.35, attack: 0.001 },
        { pitch: n("E7"), seconds: 0.05, gain: 0.18, attack: 0.001 },
        { pitch: n("A7"), at: 0.045, seconds: 0.07, gain: 0.15, attack: 0.001 },
      ],
      problem: [blip(330, 0, 0.06, 0.1, 1500), blip(330, 0.1, 0.06, 0.1, 1500), blip(247, 0.2, 0.09, 0.1, 1200)],
    },
  },
  // After a block game: the harp and the "pling" of its note blocks, the orbs of experience, a double bass.
  {
    id: "blocks",
    label: "Blocks",
    icon: "cube",
    sound: "Note blocks, the ding of experience orbs, and a double bass for a problem. Playful and pleasant.",
    room: { seconds: 1.8, decay: 2.5, mix: 0.3, brightness: 0.45 },
    cues: {
      tap: [
        {
          pitch: 0,
          noise: true,
          seconds: 0.035,
          gain: 0.35,
          attack: 0.001,
          filter: { type: "bandpass", from: 1900, q: 5 },
        },
        { pitch: 1100, to: 850, seconds: 0.03, gain: 0.12, attack: 0.001 },
      ],
      send: [pluck(timbres.harp, n("F#5"), 0, 0.5, 0.3), pluck(timbres.harp, n("C#6"), 0.075, 0.55, 0.3)],
      answer: [
        pluck(timbres.pling, n("F#5"), 0, 0.8, 0.2),
        pluck(timbres.pling, n("A#5"), 0.07, 0.8, 0.2),
        pluck(timbres.pling, n("C#6"), 0.14, 0.8, 0.2),
        pluck(timbres.pling, n("F#6"), 0.21, 0.9, 0.18),
      ],
      question: [
        { pitch: n("C#6"), seconds: 0.6, gain: 0.2, partials: timbres.glass, attack: 0.001 },
        { pitch: n("G#6"), at: 0.13, seconds: 0.8, gain: 0.2, partials: timbres.glass, attack: 0.001 },
      ],
      saved: [1480, 1865, 2217].map((pitch, index) => ({
        pitch,
        at: index * 0.06,
        seconds: index === 2 ? 0.32 : 0.22,
        gain: 0.2,
        partials: timbres.pure,
        vibrato: { rate: 28, cents: 25 },
        attack: 0.003,
      })),
      problem: [
        { ...pluck(timbres.bass, n("F#3"), 0, 0.45, 0.45), filter: { from: 1000 } },
        { ...pluck(timbres.bass, n("C#3"), 0.15, 0.5, 0.45), filter: { from: 900 } },
      ],
    },
  },
  // The first sounds of Eva, after EVE of WALL·E: glassy chirps that glide, and her call "Ee-vah" for an answer.
  {
    id: "eve",
    label: "EVE",
    icon: "eve",
    sound: "Eva's first sounds: chirps that glide in pitch, and her call “Ee-vah” for an answer.",
    cues: {
      tap: [{ pitch: 1900, to: 2300, seconds: 0.035, gain: 0.25, partials: timbres.eve, attack: 0.008 }],
      send: [
        { pitch: 520, to: 1500, seconds: 0.13, gain: 0.4, partials: timbres.eve, attack: 0.008 },
        { pitch: 1500, to: 2100, at: 0.1, seconds: 0.08, gain: 0.175, partials: timbres.eve, attack: 0.008 },
      ],
      answer: [
        { pitch: 1480, to: 1640, seconds: 0.11, gain: 0.425, partials: timbres.eve, attack: 0.008 },
        { pitch: 1180, to: 880, at: 0.14, seconds: 0.2, gain: 0.475, partials: timbres.eve, attack: 0.008 },
      ],
      question: [
        { pitch: 900, to: 1250, seconds: 0.09, gain: 0.4, partials: timbres.eve, attack: 0.008 },
        { pitch: 1200, to: 1950, at: 0.13, seconds: 0.15, gain: 0.45, partials: timbres.eve, attack: 0.008 },
      ],
      saved: [
        { pitch: 1320, seconds: 0.07, gain: 0.35, partials: timbres.eve, attack: 0.008 },
        { pitch: 1760, to: 1780, at: 0.08, seconds: 0.12, gain: 0.4, partials: timbres.eve, attack: 0.008 },
      ],
      problem: [
        { pitch: 760, to: 560, seconds: 0.12, gain: 0.425, partials: timbres.eve, attack: 0.008 },
        { pitch: 560, to: 330, at: 0.15, seconds: 0.22, gain: 0.475, partials: timbres.eve, attack: 0.008 },
      ],
    },
  },
];
