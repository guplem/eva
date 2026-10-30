import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canVibrate,
  cueOfClick,
  cueOfEvent,
  cues,
  defaultCueLevels,
  defaultCuePalette,
  minimumVibrationMs,
  playCue,
  readCueLevels,
  readCuePalette,
  saveCueLevels,
  saveCuePalette,
  startCues,
  vibrationPattern,
  type AudioOutput,
  type CueDevices,
} from "../../../../../src/frontends/web/client/cues.ts";
import type { SessionEvent } from "../../../../../src/shared/events.ts";

class FakeStorage {
  public readonly items: Map<string, string>;
  public constructor(initial: Record<string, string> = {}) {
    this.items = new Map(Object.entries(initial));
  }
  public getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

interface FakeSound {
  readonly audio: AudioOutput;
  /** The start pitch of each tone. */
  readonly pitches: number[];
  /** The loudest gain of each tone. */
  readonly peaks: number[];
  /** The kind of each node and buffer, in the order the cue made them. */
  readonly made: string[];
  readonly resumed: number;
}

function fakeAudio(state = "running"): FakeSound {
  const record = { pitches: [] as number[], peaks: [] as number[], made: [] as string[], resumed: 0 };
  const param = (
    onSet: (value: number) => void = () => undefined,
    onRamp: (value: number) => void = () => undefined,
  ): {
    value: number;
    setValueAtTime: (value: number) => void;
    exponentialRampToValueAtTime: (value: number) => void;
  } => ({
    value: 0,
    setValueAtTime: (value: number) => onSet(value),
    exponentialRampToValueAtTime: (value: number) => onRamp(value),
  });
  const node = <T extends object>(kind: string, fields: T): T & { connect: () => undefined } => {
    record.made.push(kind);
    return { ...fields, connect: () => undefined };
  };
  const audio: AudioOutput = {
    currentTime: 10,
    state,
    destination: {},
    sampleRate: 100,
    resume: () => {
      record.resumed += 1;
      return Promise.resolve();
    },
    createOscillator: () =>
      node("oscillator", {
        type: "",
        frequency: param((value) => record.pitches.push(value)),
        detune: { value: 0 },
        start: () => undefined,
        stop: () => undefined,
      }),
    createGain: () =>
      node("gain", {
        gain: param(undefined, (value) => {
          if (value > 0.001) record.peaks.push(value);
        }),
      }),
    createBiquadFilter: () => node("filter", { type: "", frequency: param(), Q: { value: 0 } }),
    createStereoPanner: () => node("panner", { pan: { value: 0 } }),
    createConvolver: () => node("room", { buffer: null, normalize: true }),
    createDelay: () => node("delay", { delayTime: { value: 0 } }),
    createBuffer: (channels: number, length: number) => {
      record.made.push("buffer");
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (channel: number) => data[channel] ?? new Float32Array(0) };
    },
    createBufferSource: () =>
      node("noise", { buffer: null, loop: false, start: () => undefined, stop: () => undefined }),
  };
  return {
    audio,
    get pitches() {
      return record.pitches;
    },
    get peaks() {
      return record.peaks;
    },
    get made() {
      return record.made;
    },
    get resumed() {
      return record.resumed;
    },
  };
}

const silentPhone = (sound: FakeSound): CueDevices => ({ audio: () => sound.audio, vibrate: undefined });
const count = (made: readonly string[], kind: string): number => made.filter((entry) => entry === kind).length;

function event(payload: Record<string, unknown>): SessionEvent {
  return { seq: 1, at: "2026-01-01T00:00:00.000Z", sessionId: "s1", ...payload } as unknown as SessionEvent;
}

describe("cueOfEvent", () => {
  test("an answer, a failure and an approval each have a cue", () => {
    expect(cueOfEvent(event({ kind: "turn_finished" }))).toBe("answer");
    expect(cueOfEvent(event({ kind: "turn_failed", reason: "x" }))).toBe("problem");
    expect(cueOfEvent(event({ kind: "approval_needed", requestId: "r", toolName: "Bash", summary: "ls" }))).toBe(
      "question",
    );
  });

  test("a streamed piece of text stays silent", () => {
    expect(cueOfEvent(event({ kind: "text_delta", text: "hi" }))).toBeNull();
  });
});

describe("vibrationPattern", () => {
  test("off gives no vibration", () => {
    expect(vibrationPattern("answer", "off")).toEqual([]);
  });

  test("strong makes each vibration longer and keeps the pauses", () => {
    const light = vibrationPattern("answer", "light");
    const strong = vibrationPattern("answer", "strong");
    expect(strong[0]).toBeGreaterThan(light[0] ?? 0);
    expect(strong[1]).toBe(light[1]);
  });

  test("each vibration is long enough for a slow motor to spin up", () => {
    for (const cue of cues) {
      const pulses = vibrationPattern(cue, "light").filter((_, index) => index % 2 === 0);
      for (const ms of pulses) expect(ms).toBeGreaterThanOrEqual(minimumVibrationMs);
    }
  });
});

describe("playCue", () => {
  test("plays each tone of the palette with its overtones, and vibrates", () => {
    const sound = fakeAudio();
    const vibrations: number[][] = [];
    const devices: CueDevices = { audio: () => sound.audio, vibrate: (pattern) => vibrations.push(pattern) };
    playCue("answer", { sound: "normal", vibration: "light" }, devices, "eve");
    expect(sound.pitches).toEqual([1480, 2960, 1180, 2360]);
    expect(vibrations).toEqual([vibrationPattern("answer", "light")]);
  });

  test("a palette with a room adds a reverb, and builds each room once", () => {
    const sound = fakeAudio();
    playCue("answer", defaultCueLevels, silentPhone(sound), "fluent");
    playCue("answer", defaultCueLevels, silentPhone(sound), "fluent");
    expect(count(sound.made, "room")).toBe(2);
    expect(count(sound.made, "buffer")).toBe(1);
  });

  test("a palette with an echo repeats the cue three times, from side to side", () => {
    const sound = fakeAudio();
    playCue("tap", defaultCueLevels, silentPhone(sound), "orbit");
    expect(count(sound.made, "delay")).toBe(3);
    expect(count(sound.made, "panner")).toBe(3);
  });

  test("a dry palette plays with no room and no echo", () => {
    const sound = fakeAudio();
    playCue("answer", defaultCueLevels, silentPhone(sound), "pulse");
    expect(count(sound.made, "room")).toBe(0);
    expect(count(sound.made, "delay")).toBe(0);
  });

  test("plays noise, filters, pans, vibrato and a bent pitch", () => {
    const sound = fakeAudio();
    playCue("send", defaultCueLevels, silentPhone(sound), "crystal");
    playCue("answer", defaultCueLevels, silentPhone(sound), "aurora");
    playCue("saved", defaultCueLevels, silentPhone(sound), "blocks");
    playCue("answer", defaultCueLevels, silentPhone(sound), "orbit");
    expect(count(sound.made, "noise")).toBe(1);
    expect(count(sound.made, "filter")).toBeGreaterThan(1);
    expect(count(sound.made, "panner")).toBeGreaterThan(4);
    // Blocks wobbles three orbs, and Orbit bends one tone: each takes a second oscillator.
    expect(count(sound.made, "oscillator")).toBeGreaterThan(sound.pitches.length);
  });

  test("plays the saved palette by default", () => {
    const sound = fakeAudio();
    saveCuePalette("eve");
    playCue("answer", defaultCueLevels, silentPhone(sound));
    expect(sound.pitches).toEqual([1480, 2960, 1180, 2360]);
    saveCuePalette(defaultCuePalette);
  });

  test("a louder level plays louder", () => {
    const quiet = fakeAudio();
    const loud = fakeAudio();
    playCue("tap", { sound: "quiet", vibration: "off" }, { audio: () => quiet.audio, vibrate: undefined });
    playCue("tap", { sound: "loud", vibration: "off" }, { audio: () => loud.audio, vibrate: undefined });
    expect(Math.max(...loud.peaks)).toBeGreaterThan(Math.max(...quiet.peaks));
  });

  test("off plays nothing and does not vibrate", () => {
    const sound = fakeAudio();
    const vibrations: number[][] = [];
    playCue(
      "send",
      { sound: "off", vibration: "off" },
      { audio: () => sound.audio, vibrate: (pattern) => vibrations.push(pattern) },
    );
    expect(sound.pitches).toEqual([]);
    expect(vibrations).toEqual([]);
  });

  test("wakes audio that the browser keeps suspended", () => {
    const sound = fakeAudio("suspended");
    playCue("tap", defaultCueLevels, { audio: () => sound.audio, vibrate: undefined });
    expect(sound.resumed).toBe(1);
  });

  test("a browser with no audio or a broken one stays silent and throws nothing", () => {
    expect(() => playCue("tap", defaultCueLevels, { audio: () => null, vibrate: undefined })).not.toThrow();
    const broken: CueDevices = {
      audio: () => {
        throw new Error("no audio");
      },
      vibrate: undefined,
    };
    expect(() => playCue("tap", defaultCueLevels, broken)).not.toThrow();
  });

  test("a broken vibration does not silence the sound", () => {
    const sound = fakeAudio();
    const devices: CueDevices = {
      audio: () => sound.audio,
      vibrate: () => {
        throw new TypeError("no userActivation");
      },
    };
    playCue("answer", { sound: "normal", vibration: "light" }, devices);
    expect(sound.pitches.length).toBeGreaterThan(0);
  });

  test("the browser's own devices play without an error", () => {
    expect(() => playCue("tap")).not.toThrow();
  });
});

describe("canVibrate", () => {
  test("follows the browser's vibration", () => {
    expect(canVibrate({ audio: () => null, vibrate: () => true })).toBe(true);
    expect(canVibrate({ audio: () => null, vibrate: undefined })).toBe(false);
    expect(typeof canVibrate()).toBe("boolean");
  });
});

describe("cueOfClick", () => {
  /** A click on a button with this `data-cue` and this `aria-disabled`. */
  const target = (cue?: string, ariaDisabled: string | null = null): EventTarget => {
    const button = {
      dataset: cue === undefined ? {} : { cue },
      getAttribute: (name: string): string | null => (name === "aria-disabled" ? ariaDisabled : null),
    };
    return { closest: () => button } as unknown as EventTarget;
  };

  test("a button with no cue taps", () => {
    expect(cueOfClick(target())).toBe("tap");
  });

  test("a button picks its cue, or none", () => {
    expect(cueOfClick(target("saved"))).toBe("saved");
    expect(cueOfClick(target("none"))).toBeNull();
    expect(cueOfClick(target("unknown"))).toBe("tap");
  });

  test("a turned-off button plays the problem cue, whatever cue it names", () => {
    expect(cueOfClick(target(undefined, "true"))).toBe("problem");
    expect(cueOfClick(target("none", "true"))).toBe("problem");
    expect(cueOfClick(target("send", "true"))).toBe("problem");
  });

  test("a button with aria-disabled false keeps its cue", () => {
    expect(cueOfClick(target(undefined, "false"))).toBe("tap");
  });

  test("a click outside a button stays silent", () => {
    expect(cueOfClick({ closest: () => null } as unknown as EventTarget)).toBeNull();
    expect(cueOfClick(null)).toBeNull();
  });
});

describe("stored levels", () => {
  beforeEach(() => useStorage(new FakeStorage()));
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("uses the defaults when the browser keeps nothing", () => {
    expect(readCueLevels()).toEqual(defaultCueLevels);
  });

  test("reads stored levels, and drops an unknown value", () => {
    useStorage(new FakeStorage({ "eva.cues": JSON.stringify({ sound: "loud", vibration: "strong" }) }));
    expect(readCueLevels()).toEqual({ sound: "loud", vibration: "strong" });
    useStorage(new FakeStorage({ "eva.cues": JSON.stringify({ sound: "max", vibration: 3 }) }));
    expect(readCueLevels()).toEqual(defaultCueLevels);
  });

  test("uses the defaults when the storage throws", () => {
    useStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readCueLevels()).toEqual(defaultCueLevels);
  });

  test("saves the levels, and a blocked storage loses only the save", () => {
    const storage = new FakeStorage();
    useStorage(storage);
    saveCueLevels({ sound: "off", vibration: "strong" });
    expect(readCueLevels()).toEqual({ sound: "off", vibration: "strong" });
    useStorage({
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveCueLevels(defaultCueLevels)).not.toThrow();
  });

  test("the palette is Coin until the person picks another", () => {
    expect(defaultCuePalette).toBe("coin");
    expect(readCuePalette()).toBe("coin");
    saveCuePalette("orbit");
    expect(readCuePalette()).toBe("orbit");
  });

  test("a palette that no longer exists gives the default", () => {
    useStorage(new FakeStorage({ "eva.cue-palette": "kazoo" }));
    expect(readCuePalette()).toBe(defaultCuePalette);
  });

  test("a blocked storage gives the default palette and loses only the save", () => {
    useStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readCuePalette()).toBe(defaultCuePalette);
    expect(() => saveCuePalette("halo")).not.toThrow();
    saveCuePalette(defaultCuePalette);
  });

  test("startCues listens to the clicks of the page", () => {
    const listeners: string[] = [];
    let onClick: ((event: { target: EventTarget | null }) => void) | null = null;
    saveCueLevels({ sound: "off", vibration: "off" });
    startCues({
      addEventListener: (name: string, listener: unknown) => {
        listeners.push(name);
        onClick = listener as (event: { target: EventTarget | null }) => void;
      },
    });
    expect(listeners).toEqual(["click"]);
    const click = onClick as ((event: { target: EventTarget | null }) => void) | null;
    expect(() =>
      click?.({ target: { closest: () => ({ dataset: {}, getAttribute: () => null }) } as unknown as EventTarget }),
    ).not.toThrow();
    expect(() => click?.({ target: null })).not.toThrow();
  });
});
