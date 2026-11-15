/**
 * The kinds of entity in `Life/` that have a main file of a fixed name (#911). The vault template
 * sets these folders and file names, so a rename is a change of the vault layout.
 */
export const lifeKinds = ["cases", "people", "inventory", "pets", "periods"] as const;
export type LifeKind = (typeof lifeKinds)[number];

export interface LifeKindPlace {
  /** The folder from the vault root. Each entity is one folder in it. */
  readonly folder: string;
  /** The main file in the folder of each entity. */
  readonly mainFile: string;
}

export const lifeKindPlaces: Readonly<Record<LifeKind, LifeKindPlace>> = {
  cases: { folder: "Life/Cases", mainFile: "Case.md" },
  people: { folder: "Life/People", mainFile: "Person.md" },
  inventory: { folder: "Life/Inventory", mainFile: "Item.md" },
  pets: { folder: "Life/Pets", mainFile: "Pet.md" },
  periods: { folder: "Life/Periods", mainFile: "Period.md" },
};

/**
 * The place of a kind in a vault that waits for its structure upgrade. Eva reads it while the
 * vault has no folder of the newer place, so a page stays full until the person upgrades (#940).
 */
export const olderLifeKindPlaces: Readonly<Partial<Record<LifeKind, LifeKindPlace>>> = {
  inventory: { folder: "Life/Objects", mainFile: "Object.md" },
};

/** The old names of renamed kinds, as an old address or a stored choice of the web app holds them (#940). */
const renamedLifeKinds: ReadonlyMap<string, LifeKind> = new Map([["objects", "inventory"]]);

/** The current name of a kind for a name that may be old, or the name as it is. */
export function currentLifeKindName(name: string): string {
  return renamedLifeKinds.get(name) ?? name;
}

export function isLifeKind(value: string): value is LifeKind {
  return (lifeKinds as readonly string[]).includes(value);
}
