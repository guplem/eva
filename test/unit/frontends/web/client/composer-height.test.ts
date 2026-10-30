import { afterEach, describe, expect, test } from "bun:test";
import {
  composerHeightRange,
  heightShare,
  keptHeightShare,
  readComposerHeight,
  saveComposerHeight,
} from "../../../../../src/frontends/web/client/composer-height.ts";

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

/** A storage that keeps its items in a map, as a browser does. */
function mapStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } as unknown as Storage;
}

const blocked = (): never => {
  throw new Error("blocked");
};

describe("composer height", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("a drag keeps its height as a share of the window", () => {
    expect(heightShare(400, 800)).toBe(0.5);
  });

  test("a share stays inside the range, so the box never covers the whole chat", () => {
    expect(heightShare(790, 800)).toBe(composerHeightRange.max);
    expect(heightShare(1, 800)).toBe(composerHeightRange.min);
  });

  test("a stored share that is missing or broken gives the usual height", () => {
    expect(keptHeightShare(null)).toBeNull();
    expect(keptHeightShare("tall")).toBeNull();
    expect(keptHeightShare("0.3")).toBe(0.3);
    expect(keptHeightShare("5")).toBe(composerHeightRange.max);
  });

  test("the browser keeps the share, and a reset forgets it", () => {
    useStorage(mapStorage());
    expect(readComposerHeight()).toBeNull();
    saveComposerHeight(0.6);
    expect(readComposerHeight()).toBe(0.6);
    saveComposerHeight(null);
    expect(readComposerHeight()).toBeNull();
  });

  test("a blocked storage gives the usual height and loses only the save", () => {
    useStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readComposerHeight()).toBeNull();
    expect(() => {
      saveComposerHeight(0.6);
      saveComposerHeight(null);
    }).not.toThrow();
  });
});
