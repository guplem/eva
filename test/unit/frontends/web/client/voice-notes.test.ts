import { describe, expect, test } from "bun:test";
import { RecordingShelf, recordingTime, recordingType } from "../../../../../src/frontends/web/client/voice-notes.ts";

describe("recordingType", () => {
  test("picks Opus where the browser records it", () => {
    expect(recordingType(() => true)).toBe("audio/webm;codecs=opus");
  });

  test("picks MP4 on a browser that records only MP4, such as Safari", () => {
    expect(recordingType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  test("lets the browser pick when it names no known format", () => {
    expect(recordingType(() => false)).toBeNull();
  });
});

describe("recordingTime", () => {
  test("shows minutes and seconds", () => {
    expect(recordingTime(0)).toBe("0:00");
    expect(recordingTime(9_500)).toBe("0:09");
    expect(recordingTime(75_000)).toBe("1:15");
  });
});

describe("RecordingShelf", () => {
  test("finds a recording by its chat and the text that Eva heard", () => {
    const shelf = new RecordingShelf(() => undefined);
    shelf.keep("s1", "Hello Eva", "blob:one");
    expect(shelf.find("s1", "Hello Eva")).toBe("blob:one");
    expect(shelf.find("s2", "Hello Eva")).toBeNull();
    expect(shelf.find("s1", "Typed text")).toBeNull();
  });

  test("gives back the memory of a replaced recording and of the oldest ones", () => {
    const released: string[] = [];
    const shelf = new RecordingShelf((url) => released.push(url));
    shelf.keep("s1", "same", "blob:first");
    shelf.keep("s1", "same", "blob:second");
    expect(released).toEqual(["blob:first"]);
    for (let index = 0; index < 20; index += 1) shelf.keep("s1", `note ${String(index)}`, `blob:${String(index)}`);
    expect(released).toEqual(["blob:first", "blob:second"]);
    expect(shelf.find("s1", "same")).toBeNull();
    expect(shelf.find("s1", "note 19")).toBe("blob:19");
  });
});
