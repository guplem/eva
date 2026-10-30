import { describe, expect, test } from "bun:test";
import { recordingTime, recordingType, withHeardText } from "../../../../../src/frontends/web/client/voice-notes.ts";

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

describe("withHeardText", () => {
  test("fills an empty box with what Eva heard", () => {
    expect(withHeardText("", "Hello Eva")).toBe("Hello Eva");
    expect(withHeardText("  \n", "Hello Eva")).toBe("Hello Eva");
  });

  test("adds what Eva heard after the text in the box, and never replaces it", () => {
    expect(withHeardText("Read this:", "Hello Eva")).toBe("Read this: Hello Eva");
    expect(withHeardText("Read this:\n", "Hello Eva")).toBe("Read this:\nHello Eva");
  });
});
