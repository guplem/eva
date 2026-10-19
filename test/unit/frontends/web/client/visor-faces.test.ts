import { describe, expect, test } from "bun:test";
import {
  faces,
  rotation,
  startRotation,
  stateFaces,
  visorClassName,
  type Face,
} from "../../../../../src/frontends/web/client/visor-faces.ts";

/** A scheduler that runs nothing by itself: the test fires each timer by hand. */
function manualScheduler(): {
  schedule: (run: () => void, ms: number) => () => void;
  pending: { run: () => void; ms: number; cancelled: boolean }[];
} {
  const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    pending,
    schedule: (run, ms) => {
      const entry = { run, ms, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
}

describe("visorClassName", () => {
  test("each size maps to the class of the reference", () => {
    expect(visorClassName("neutral", 28)).toBe("mk s");
    expect(visorClassName("neutral", 36)).toBe("mk");
    expect(visorClassName("neutral", 76)).toBe("mk l");
    expect(visorClassName("neutral", 128)).toBe("mk xl");
  });

  test("each face but neutral has its own expression class", () => {
    expect(visorClassName("happy", 36)).toBe("mk e-joy");
    expect(visorClassName("asleep", 128)).toBe("mk xl e-sleep");
    const classes = faces.map((face) => visorClassName(face, 36));
    expect(new Set(classes).size).toBe(15);
  });
});

describe("faces", () => {
  test("the guide has 15 faces", () => {
    expect(faces).toEqual([
      "neutral",
      "happy",
      "wink",
      "delighted",
      "surprised",
      "thinking",
      "searching",
      "listening",
      "focused",
      "firm",
      "skeptical",
      "worried",
      "sad",
      "error",
      "asleep",
    ]);
  });
});

describe("stateFaces", () => {
  test("one face for each state, from the Use column of the guide", () => {
    expect(stateFaces.idle).toBe("neutral");
    expect(stateFaces.offline).toBe("worried");
    expect(stateFaces.asksPermission).toBe("firm");
    expect(stateFaces.thinking).toBe("thinking");
    expect(Object.values(stateFaces).every((face) => faces.includes(face))).toBe(true);
  });
});

describe("startRotation", () => {
  test("follows the login cycle with its durations, then starts again", () => {
    const scheduler = manualScheduler();
    const shown: Face[] = [];
    startRotation((face) => shown.push(face), scheduler.schedule);
    expect(shown).toEqual(["searching"]);
    expect(scheduler.pending[0]?.ms).toBe(5000);

    for (let step = 0; step < rotation.length; step++) scheduler.pending[step]?.run();
    expect(shown).toEqual([
      "searching",
      "thinking",
      "happy",
      "wink",
      "surprised",
      "listening",
      "delighted",
      "searching",
    ]);
    expect(scheduler.pending.map((entry) => entry.ms)).toEqual([5000, 3000, 2200, 2200, 2600, 2400, 2200, 5000]);
  });

  test("the stop function cancels the next change", () => {
    const scheduler = manualScheduler();
    const stop = startRotation(() => undefined, scheduler.schedule);
    scheduler.pending[0]?.run();
    stop();
    expect(scheduler.pending.at(-1)?.cancelled).toBe(true);
  });

  test("with the browser timer, a stop before the first change leaves the first face", async () => {
    const shown: Face[] = [];
    const stop = startRotation((face) => shown.push(face));
    stop();
    await Bun.sleep(10);
    expect(shown).toEqual(["searching"]);
  });
});
