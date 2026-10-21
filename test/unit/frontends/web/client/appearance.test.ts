import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  applyAppearance,
  defaultSeed,
  hexToOklch,
  oklchToHex,
  readAppearance,
  saveAppearance,
  seedColours,
  seedName,
  seedVariables,
  themeColours,
} from "../../../../../src/frontends/web/client/appearance.ts";

describe("hexToOklch", () => {
  test("converts sRGB to OKLCH", () => {
    const red = hexToOklch("#ff0000");
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    const white = hexToOklch("#ffffff");
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeCloseTo(0, 3);
  });

  test("oklchToHex turns it back into the same colour", () => {
    for (const { hex } of seedColours) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });

  test("oklchToHex clips a colour that sRGB cannot show", () => {
    expect(oklchToHex({ l: 1, c: 0.4, h: 140 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("seedVariables", () => {
  test("keeps the hue and clamps the chroma and the lightness", () => {
    const red = seedVariables("#ff0000");
    expect(red["--h"]).toBe("29.2");
    expect(red["--c"]).toBe("0.200");
    expect(red["--l"]).toBe("0.628");
    expect(seedVariables("#000000")["--l"]).toBe("0.450");
    expect(seedVariables("#ffffff")["--l"]).toBe("0.900");
  });

  test("puts dark text on a light seed and white text on a dark seed", () => {
    expect(seedVariables("#f7c600")["--on-l"]).toBe("0.2");
    expect(seedVariables("#5468ff")["--on-l"]).toBe("1");
  });
});

describe("seed colours", () => {
  test("offers the 15 seeds of the design, with EVE blue first", () => {
    expect(seedColours).toHaveLength(15);
    expect(seedColours[0]).toEqual({ name: "EVE blue", hex: defaultSeed });
    expect(defaultSeed).toBe("#2aa8ff");
  });

  test("names a known seed, and shows any other seed as its code", () => {
    expect(seedName("#8B5CF6")).toBe("Violet");
    expect(seedName(defaultSeed)).toBe("EVE blue");
    expect(seedName("#123abc")).toBe("#123ABC");
  });
});

describe("themeColours", () => {
  test("gives the page background of each theme as a hex colour", () => {
    const { light, dark } = themeColours(defaultSeed);
    expect(hexToOklch(light).l).toBeCloseTo(0.972, 2);
    expect(hexToOklch(dark).l).toBeCloseTo(0.16, 2);
  });
});

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

interface FakeMeta {
  media: string;
  content: string;
  dataset: Record<string, string>;
}

function fakeDocument(): {
  attributes: Map<string, string>;
  properties: Map<string, string>;
  metas: FakeMeta[];
} {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const metas: FakeMeta[] = [
    { media: "(prefers-color-scheme: light)", content: "", dataset: {} },
    { media: "(prefers-color-scheme: dark)", content: "", dataset: {} },
  ];
  const documentElement = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    style: { setProperty: (name: string, value: string) => properties.set(name, value) },
  };
  Object.defineProperty(globalThis, "document", {
    value: { documentElement, querySelectorAll: () => metas },
    configurable: true,
  });
  return { attributes, properties, metas };
}

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

describe("stored appearance", () => {
  beforeEach(() => useStorage(new FakeStorage()));
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "document");
  });

  test("uses the defaults when the browser keeps nothing", () => {
    expect(readAppearance()).toEqual({
      theme: "system",
      density: "comfortable",
      seed: defaultSeed,
      filesView: "columns",
    });
  });

  test("reads a stored seed, and drops a value that is not a colour", () => {
    useStorage(new FakeStorage({ "eva.appearance": JSON.stringify({ theme: "dark", seed: "#8B5CF6" }) }));
    expect(readAppearance()).toEqual({
      theme: "dark",
      density: "comfortable",
      seed: "#8b5cf6",
      filesView: "columns",
    });
    useStorage(new FakeStorage({ "eva.appearance": JSON.stringify({ seed: "red" }) }));
    expect(readAppearance().seed).toBe(defaultSeed);
  });

  test("reads a stored files view, and drops an unknown one", () => {
    useStorage(new FakeStorage({ "eva.appearance": JSON.stringify({ filesView: "single" }) }));
    expect(readAppearance().filesView).toBe("single");
    useStorage(new FakeStorage({ "eva.appearance": JSON.stringify({ filesView: "tree" }) }));
    expect(readAppearance().filesView).toBe("columns");
  });

  test("uses the defaults when the storage throws", () => {
    useStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readAppearance().seed).toBe(defaultSeed);
  });

  test("applies the seed, the theme and the density, and keeps them", () => {
    const storage = new FakeStorage();
    useStorage(storage);
    const page = fakeDocument();
    saveAppearance({ theme: "dark", density: "compact", seed: "#ff0000", filesView: "single" });
    expect(page.attributes.get("data-theme")).toBe("dark");
    expect(page.attributes.get("data-density")).toBe("compact");
    expect(page.attributes.get("data-files-view")).toBe("single");
    expect(page.properties.get("--h")).toBe("29.2");
    expect(page.properties.get("--c")).toBe("0.200");
    expect(page.metas.map((meta) => meta.media)).toEqual(["not all", "all"]);
    const { light, dark } = themeColours("#ff0000");
    expect(page.metas.map((meta) => meta.content)).toEqual([light, dark]);
    expect(JSON.parse(storage.getItem("eva.appearance") ?? "{}")).toEqual({
      theme: "dark",
      density: "compact",
      seed: "#ff0000",
      filesView: "single",
    });
  });

  test("leaves the theme to the system, and still applies when the storage throws", () => {
    useStorage({
      setItem: () => {
        throw new Error("full");
      },
    });
    const page = fakeDocument();
    page.attributes.set("data-theme", "dark");
    saveAppearance({ theme: "system", density: "comfortable", seed: defaultSeed, filesView: "columns" });
    expect(page.attributes.has("data-theme")).toBe(false);
    expect(page.metas.map((meta) => meta.media)).toEqual([
      "(prefers-color-scheme: light)",
      "(prefers-color-scheme: dark)",
    ]);
  });

  test("applyAppearance needs no storage", () => {
    const page = fakeDocument();
    applyAppearance({ theme: "light", density: "comfortable", seed: defaultSeed, filesView: "columns" });
    expect(page.metas.map((meta) => meta.media)).toEqual(["all", "not all"]);
  });
});
