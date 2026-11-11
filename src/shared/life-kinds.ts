/**
 * The kinds of entity in `Life/` that have a main file of a fixed name (#911). The vault template
 * sets these folders and file names, so a rename is a change of the vault layout.
 */
export const lifeKinds = ["cases", "people", "objects", "pets", "periods"] as const;
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
  objects: { folder: "Life/Objects", mainFile: "Object.md" },
  pets: { folder: "Life/Pets", mainFile: "Pet.md" },
  periods: { folder: "Life/Periods", mainFile: "Period.md" },
};

export function isLifeKind(value: string): value is LifeKind {
  return (lifeKinds as readonly string[]).includes(value);
}
