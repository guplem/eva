/**
 * The one menu of a vault entry on the Files page (#1117). A right click on a row, the ⋯ menu of an
 * open file and the ⋯ menu of an open folder show the same items, in the same sections. Only the
 * open file adds its own items, such as the View section.
 */
import { fullPathOf } from "./file-paths.ts";
import type { MenuItem } from "./Menu.tsx";

/** The sections of the menu, in their order. */
const groupOrder = ["New", "Organize", "Copy", "View", "Share", "Security"] as const;
type Group = (typeof groupOrder)[number];

export interface EntryFacts {
  /** The path from the vault root. The empty path is the vault folder itself. */
  readonly path: string;
  /** The name on disk, with its extension, never the smart name. */
  readonly name: string;
  readonly kind: "folder" | "file" | "encrypted";
  /** Null while the favorites are not known, so the menu offers no star. */
  readonly favorite: boolean | null;
  /** The vault folder on this computer, for "Copy full path", or null when it is not known. */
  readonly vaultFolder: string | null;
  /** False for a file that Eva may not download, such as a secrets file. */
  readonly downloadable?: boolean;
}

/** What each item does. The Files page gives one set for every menu. */
export interface EntryActions {
  readonly newEntry: (folder: string, kind: "file" | "folder") => void;
  readonly rename: (path: string, name: string) => void;
  readonly duplicate: (path: string) => void;
  readonly remove: (path: string, name: string, folder: boolean) => void;
  readonly copy: (text: string) => void;
  readonly download: (path: string, folder: boolean) => void;
  readonly encrypt: (path: string, name: string) => void;
  readonly favorite: (path: string, on: boolean) => void;
}

/** The items that only the open file has. */
export interface OpenFileItems {
  readonly view?: readonly MenuItem[];
  /** The open file shows its own download wait under its bar, so it downloads by itself. */
  readonly download?: () => void;
  readonly security?: readonly MenuItem[];
}

export function entryMenuItems(entry: EntryFacts, actions: EntryActions, open: OpenFileItems = {}): MenuItem[] {
  const { path, name, kind } = entry;
  const root = path === "";
  const folder = kind === "folder";
  const plain = kind !== "encrypted";
  const item = (group: Group, rest: Omit<MenuItem, "group">): MenuItem => ({ ...rest, group });
  const items: MenuItem[] = folder ? folderBackgroundItems(path, actions) : [];
  if (!root && entry.favorite !== null) {
    const on = !entry.favorite;
    items.push(
      item("Organize", {
        label: on ? "Add to favorites" : "Remove from favorites",
        icon: "star",
        onChoose: () => actions.favorite(path, on),
      }),
    );
  }
  // The core refuses each of these for an encrypted file, so the menu does not offer them.
  if (!root && plain) {
    items.push(item("Organize", { label: "Rename", icon: "pen", onChoose: () => actions.rename(path, name) }));
    if (!folder)
      items.push(item("Organize", { label: "Duplicate", icon: "copy", onChoose: () => actions.duplicate(path) }));
    items.push(
      item("Organize", {
        label: "Delete",
        icon: "trash",
        danger: true,
        onChoose: () => actions.remove(path, name, folder),
      }),
    );
  }
  // The vault folder's own name and its empty path tell the person nothing.
  if (!root) {
    items.push(item("Copy", { label: "Copy name", icon: "copy", onChoose: () => actions.copy(name) }));
    items.push(item("Copy", { label: "Copy path in the vault", icon: "copy", onChoose: () => actions.copy(path) }));
  }
  const vaultFolder = entry.vaultFolder;
  if (vaultFolder !== null)
    items.push(
      item("Copy", {
        label: "Copy full path on this computer",
        icon: "copy",
        onChoose: () => actions.copy(fullPathOf(vaultFolder, path)),
      }),
    );
  items.push(...(open.view ?? []).map((view) => ({ ...view, group: "View" })));
  // An encrypted file downloads only from its own bar, with this tab's unlock.
  if ((plain && entry.downloadable !== false) || open.download !== undefined)
    items.push(
      item("Share", {
        label: folder ? "Download as zip" : "Download",
        icon: "download",
        onChoose: open.download ?? (() => actions.download(path, folder)),
      }),
    );
  if (kind === "file")
    items.push(item("Security", { label: "Encrypt", icon: "lock", onChoose: () => actions.encrypt(path, name) }));
  items.push(...(open.security ?? []).map((security) => ({ ...security, group: "Security" })));
  return items;
}

/** The items of a press beside the rows of a folder, or on its empty part. */
export function folderBackgroundItems(folder: string, actions: EntryActions): MenuItem[] {
  return [
    {
      label: "New file",
      icon: "file",
      group: "New",
      onChoose: () => actions.newEntry(folder, "file"),
    },
    {
      label: "New folder",
      icon: "folder",
      group: "New",
      onChoose: () => actions.newEntry(folder, "folder"),
    },
  ];
}

/**
 * Puts the item at the end of its section. With no such section yet, it goes where its section
 * belongs in the order of the menu. An item with an unknown section goes last.
 */
export function withGroupItem(items: readonly MenuItem[], added: MenuItem): MenuItem[] {
  const rank = (group: string | undefined): number => {
    const index = groupOrder.findIndex((each) => each === group);
    return index === -1 ? groupOrder.length : index;
  };
  const at = items.findIndex((item) => rank(item.group) > rank(added.group));
  return at === -1 ? [...items, added] : [...items.slice(0, at), added, ...items.slice(at)];
}

/** The items of an open file that has no entry actions in its own bar, such as an encrypted file. */
export function openFileItems(open: OpenFileItems): MenuItem[] {
  return [
    ...(open.view ?? []).map((view) => ({ ...view, group: "View" })),
    ...(open.download === undefined
      ? []
      : [{ label: "Download", icon: "download" as const, group: "Share", onChoose: open.download }]),
    ...(open.security ?? []).map((security) => ({ ...security, group: "Security" })),
  ];
}
