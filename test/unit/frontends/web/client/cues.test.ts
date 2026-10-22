import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canVibrate,
  cueOfClick,
  cueOfEvent,
  cues,
  cueTones,
  defaultCueLevels,
  playCue,
  readCueLevels,
  saveCueLevels,
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

/** Records each tone's start pitch and its loudest gain. */
function fakeAudio(state = "running"): { audio: AudioOutput; pitches: number[]; peaks: number[]; resumed: number } {
  const record = { pitches: [] as number[], peaks: [] as number[], resumed: 0 };
  const ramp = (
    onSet: (value: number) => void,
    onRamp: (value: number) => void,
  ): { setValueAtTime: (value: number) => void; exponentialRampToValueAtTime: (value: number) => void } => ({
    setValueAtTime: (value: number) => onSet(value),
    exponentialRampToValueAtTime: (value: number) => onRamp(value),
  });
  const audio: AudioOutput = {
    currentTime: 10,
    state,
    destination: {},
    resume: () => {
      record.resumed += 1;
      return Promise.resolve();
    },
    createOscillator: () => ({
      type: "",
      frequency: ramp(
        (value) => record.pitches.push(value),
        () => undefined,
      ),
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: ramp(
        () => undefined,
        (value) => {
          if (value > 0.001) record.peaks.push(value);
        },
      ),
      connect: () => undefined,
    }),
  };
  return {
    audio,
    get pitches() {
      return record.pitches;
    },
    get peaks() {
      return record.peaks;
    },
    get resumed() {
      return record.resumed;
    },
  };
}

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
});

describe("the tones", () => {
  test("every cue is short, so a cue never talks over the next one", () => {
    for (const cue of cues) {
      const end = Math.max(...cueTones[cue].map((tone) => tone.at + tone.seconds));
      expect(end).toBeLessThan(0.5);
    }
  });

  test("the answer is EVE's call: a high note, then a lower one", () => {
    const [ee, vah] = cueTones.answer;
    expect(vah?.at).toBeGreaterThan(ee?.at ?? 0);
    expect(vah?.to).toBeLessThan(ee?.from ?? 0);
  });
});

describe("playCue", () => {
  test("plays each tone with its octave, and vibrates", () => {
    const sound = fakeAudio();
    const vibrations: number[][] = [];
    const devices: CueDevices = { audio: () => sound.audio, vibrate: (pattern) => vibrations.push(pattern) };
    playCue("answer", { sound: "normal", vibration: "light" }, devices);
    expect(sound.pitches).toEqual([1480, 2960, 1180, 2360]);
    expect(vibrations).toEqual([vibrationPattern("answer", "light")]);
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
  const target = (
    button: { dataset: Record<string, string> } | null,
  ): { closest: () => { dataset: Record<string, string> } | null } => ({ closest: () => button });

  test("a button with no cue taps", () => {
    expect(cueOfClick(target({ dataset: {} }) as unknown as EventTarget)).toBe("tap");
  });

  test("a button picks its cue, or none", () => {
    expect(cueOfClick(target({ dataset: { cue: "saved" } }) as unknown as EventTarget)).toBe("saved");
    expect(cueOfClick(target({ dataset: { cue: "none" } }) as unknown as EventTarget)).toBeNull();
    expect(cueOfClick(target({ dataset: { cue: "unknown" } }) as unknown as EventTarget)).toBe("tap");
  });

  test("a click outside a button stays silent", () => {
    expect(cueOfClick(target(null) as unknown as EventTarget)).toBeNull();
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
    expect(() => click?.({ target: { closest: () => ({ dataset: {} }) } as unknown as EventTarget })).not.toThrow();
    expect(() => click?.({ target: null })).not.toThrow();
  });
});
