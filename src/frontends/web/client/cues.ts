/**
 * Eva's sounds and the phone's vibration for the moments of a chat: a tap, a send, an answer, a question, a
 * save and a problem. The person picks a palette of sounds in `cue-palettes.ts`. The browser builds each sound
 * at play time, so the page loads no audio file.
 *
 * Each browser keeps its own levels and palette in `localStorage`, as the appearance: a phone on a train needs
 * other levels than a desktop.
 */
import type { SessionEvent } from "../../../shared/events.ts";
import { palettes, type Cue, type Palette, type PaletteId, type Voice } from "./cue-palettes.ts";

export type { Cue, PaletteId } from "./cue-palettes.ts";
export type SoundLevel = "off" | "quiet" | "normal" | "loud";
export type VibrationLevel = "off" | "light" | "strong";

export interface CueLevels {
  readonly sound: SoundLevel;
  readonly vibration: VibrationLevel;
}

/** The order of the preview buttons in Settings. */
export const cues: readonly Cue[] = ["tap", "send", "answer", "question", "saved", "problem"];

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

const soundGains: Record<SoundLevel, number> = { off: 0, quiet: 0.25, normal: 0.6, loud: 1 };

const storageKey = "eva.cues";
const paletteKey = "eva.cue-palette";
export const defaultCueLevels: CueLevels = { sound: "quiet", vibration: "light" };
export const defaultCuePalette: PaletteId = "coin";

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

/** A palette that a later version removed gives the default. */
export function readCuePalette(): PaletteId {
  try {
    const stored = localStorage.getItem(paletteKey);
    return palettes.find((palette) => palette.id === stored)?.id ?? defaultCuePalette;
  } catch {
    return defaultCuePalette;
  }
}

export function saveCuePalette(palette: PaletteId): void {
  currentPalette = palette;
  try {
    localStorage.setItem(paletteKey, palette);
  } catch {
    // The palette still applies until the page reloads.
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
  readonly sampleRate: number;
  resume(): Promise<void>;
  createOscillator(): AudioSource & { type: string; readonly frequency: AudioRamp; readonly detune: AudioValue };
  createGain(): AudioLink & { readonly gain: AudioRamp };
  createBiquadFilter(): AudioLink & { type: string; readonly frequency: AudioRamp; readonly Q: AudioValue };
  createStereoPanner(): AudioLink & { readonly pan: AudioValue };
  createConvolver(): AudioLink & { buffer: unknown; normalize: boolean };
  createDelay(maxSeconds: number): AudioLink & { readonly delayTime: AudioValue };
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array };
  createBufferSource(): AudioSource & { buffer: unknown; loop: boolean };
}

interface AudioLink {
  connect(target: unknown): unknown;
}

interface AudioSource extends AudioLink {
  start(when: number, offset?: number): void;
  stop(when: number): void;
}

interface AudioValue {
  value: number;
}

interface AudioRamp extends AudioValue {
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
export function playCue(
  cue: Cue,
  levels: CueLevels = current,
  devices: CueDevices = browserDevices,
  palette: PaletteId = currentPalette,
): void {
  try {
    const pattern = vibrationPattern(cue, levels.vibration);
    if (pattern.length > 0) devices.vibrate?.(pattern);
  } catch {
    // A broken vibration must not silence the sound.
  }
  try {
    const gain = soundGains[levels.sound];
    if (gain === 0) return;
    const audio = devices.audio();
    if (audio === null) return;
    // A browser starts audio suspended until the person touches the page.
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
    playVoices(audio, paletteOf(palette), cue, gain);
  } catch {
    // The page works the same without the cue.
  }
}

function paletteOf(id: PaletteId): Palette {
  const palette = palettes.find((candidate) => candidate.id === id);
  if (palette === undefined) throw new Error(`Unknown palette: ${id}`);
  return palette;
}

/** Every voice goes into one bus. The bus feeds the speakers, the room and the echo. */
function playVoices(audio: AudioOutput, palette: Palette, cue: Cue, level: number): void {
  const bus = audio.createGain();
  bus.connect(audio.destination);
  if (palette.room !== undefined) {
    const send = audio.createGain();
    send.gain.value = palette.room.mix;
    const room = audio.createConvolver();
    room.normalize = false;
    room.buffer = roomSound(audio, palette.room);
    bus.connect(send);
    send.connect(room);
    room.connect(audio.destination);
  }
  if (palette.echo !== undefined) {
    // A fixed number of repeats, not a feedback loop: a loop of nodes never stops by itself.
    for (let repeat = 1; repeat <= 3; repeat++) {
      const delay = audio.createDelay(1);
      delay.delayTime.value = palette.echo.seconds * repeat;
      const volume = audio.createGain();
      volume.gain.value = palette.echo.mix * palette.echo.feedback ** (repeat - 1);
      const side = audio.createStereoPanner();
      side.pan.value = repeat % 2 === 1 ? 0.5 : -0.5;
      bus.connect(delay);
      delay.connect(volume);
      volume.connect(side);
      side.connect(audio.destination);
    }
  }
  for (const voice of palette.cues[cue]) playVoice(audio, voice, audio.currentTime, bus, level);
}

/** One voice: a tone with its overtones, or a burst of noise, through its filter and its pan. */
function playVoice(audio: AudioOutput, voice: Voice, cueStart: number, bus: AudioLink, level: number): void {
  const start = cueStart + (voice.at ?? 0);
  const attack = voice.attack ?? 0.004;
  const hold = voice.hold ?? 0;
  const input = voiceInput(audio, voice, start, bus);
  if (voice.noise === true) {
    const source = audio.createBufferSource();
    source.buffer = noiseSound(audio);
    source.loop = true;
    const volume = audio.createGain();
    envelope(volume.gain, start, attack, hold, start + voice.seconds, level * voice.gain);
    source.connect(volume);
    volume.connect(input);
    // A random offset, so two bursts in a row do not sound the same.
    source.start(start, Math.random() * 0.5);
    source.stop(start + voice.seconds + 0.02);
    return;
  }
  const to = voice.to ?? voice.pitch;
  const glideEnd = start + (voice.glide ?? voice.seconds);
  for (const [multiple, share, length = 1, cents = 0] of voice.partials ?? [[1, 1]]) {
    const end = start + attack + hold + Math.max(0.02, (voice.seconds - attack - hold) * length);
    const oscillator = audio.createOscillator();
    oscillator.type = voice.wave ?? "sine";
    oscillator.detune.value = cents;
    oscillator.frequency.setValueAtTime(voice.pitch * multiple, start);
    if (to !== voice.pitch) oscillator.frequency.exponentialRampToValueAtTime(to * multiple, glideEnd);
    if (voice.vibrato !== undefined) {
      const wobble = audio.createOscillator();
      wobble.frequency.value = voice.vibrato.rate;
      const depth = audio.createGain();
      depth.gain.value = voice.pitch * multiple * (2 ** (voice.vibrato.cents / 1200) - 1);
      wobble.connect(depth);
      depth.connect(oscillator.frequency);
      wobble.start(start);
      wobble.stop(end + 0.02);
    }
    if (voice.fm !== undefined) {
      const modulator = audio.createOscillator();
      modulator.frequency.value = voice.pitch * multiple * voice.fm.ratio;
      const depth = audio.createGain();
      const bend = voice.pitch * multiple * voice.fm.depth;
      depth.gain.setValueAtTime(bend, start);
      depth.gain.exponentialRampToValueAtTime(Math.max(0.01, bend * 0.02), start + voice.fm.seconds);
      modulator.connect(depth);
      depth.connect(oscillator.frequency);
      modulator.start(start);
      modulator.stop(end + 0.02);
    }
    const volume = audio.createGain();
    envelope(volume.gain, start, attack, hold, end, level * voice.gain * share);
    oscillator.connect(volume);
    volume.connect(input);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

/** The node that a voice plays into: its filter, then its pan, then the bus. */
function voiceInput(audio: AudioOutput, voice: Voice, start: number, bus: AudioLink): AudioLink {
  let target = bus;
  if (voice.pan !== undefined) {
    const panner = audio.createStereoPanner();
    panner.pan.value = voice.pan;
    panner.connect(target);
    target = panner;
  }
  if (voice.filter !== undefined) {
    const filter = audio.createBiquadFilter();
    filter.type = voice.filter.type ?? "lowpass";
    filter.Q.value = voice.filter.q ?? 0.7;
    filter.frequency.setValueAtTime(voice.filter.from, start);
    const to = voice.filter.to;
    if (to !== undefined)
      filter.frequency.exponentialRampToValueAtTime(to, start + (voice.filter.seconds ?? voice.seconds));
    filter.connect(target);
    target = filter;
  }
  return target;
}

/** The volume rises in `attack` and fades out, so no voice clicks. An exponential ramp cannot start or end at 0. */
function envelope(gain: AudioRamp, start: number, attack: number, hold: number, end: number, peak: number): void {
  const top = Math.max(peak, 0.0002);
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(top, start + attack);
  if (hold > 0) gain.setValueAtTime(top, start + attack + hold);
  gain.exponentialRampToValueAtTime(0.0001, end);
}

/** Each audio output keeps its own buffers: a buffer of one output does not play in another. */
const rooms = new WeakMap<AudioOutput, Map<NonNullable<Palette["room"]>, unknown>>();
const noises = new WeakMap<AudioOutput, unknown>();

/** The echo of a room: noise that fades out, made darker by a simple low-pass filter. */
function roomSound(audio: AudioOutput, room: NonNullable<Palette["room"]>): unknown {
  const known = rooms.get(audio) ?? new Map<NonNullable<Palette["room"]>, unknown>();
  rooms.set(audio, known);
  const cached = known.get(room);
  if (cached !== undefined) return cached;
  const length = Math.max(1, Math.floor(audio.sampleRate * room.seconds));
  const buffer = audio.createBuffer(2, length, audio.sampleRate);
  for (const channel of [0, 1]) {
    const data = buffer.getChannelData(channel);
    let sample = 0;
    let energy = 0;
    for (let index = 0; index < length; index++) {
      sample += room.brightness * (Math.random() * 2 - 1 - sample);
      data[index] = sample * (1 - index / length) ** room.decay;
      energy += (data[index] ?? 0) ** 2;
    }
    // Each room gets the same energy, so its mix alone sets how loud it is.
    const scale = energy > 0 ? 1.5 / Math.sqrt(energy) : 0;
    for (let index = 0; index < length; index++) data[index] = (data[index] ?? 0) * scale;
  }
  known.set(room, buffer);
  return buffer;
}

/** One second of white noise. The noise voices loop it. */
function noiseSound(audio: AudioOutput): unknown {
  const cached = noises.get(audio);
  if (cached !== undefined) return cached;
  const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  noises.set(audio, buffer);
  return buffer;
}

let current: CueLevels = defaultCueLevels;
let currentPalette: PaletteId = defaultCuePalette;
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
          // An older browser, such as Firefox before 120, has no `userActivation`: it simply tries.
          if (!("userActivation" in navigator) || navigator.userActivation.hasBeenActive) navigator.vibrate(pattern);
        }
      : undefined,
};

/** True when this browser can vibrate. An iPhone cannot: Safari has no vibration for a web page. */
export function canVibrate(devices: CueDevices = browserDevices): boolean {
  return devices.vibrate !== undefined;
}

/**
 * Loads the levels and the palette, and plays a cue on each button press of the page. A button picks its cue
 * with `data-cue`, and `data-cue="none"` keeps it silent, as for a button whose action plays its own cue.
 * A button turned off with `aria-disabled` plays the problem cue, so a press on an action that cannot run
 * never passes in silence (issue 674).
 */
export function startCues(root: Pick<Document, "addEventListener"> = document): void {
  current = readCueLevels();
  currentPalette = readCuePalette();
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
  // A native `disabled` button gets no click at all, so only `aria-disabled` can tell the person.
  if (button.getAttribute("aria-disabled") === "true") return "problem";
  const named = button.dataset["cue"];
  if (named === "none") return null;
  return cues.find((cue) => cue === named) ?? "tap";
}
