import { describe, expect, test } from "bun:test";
import {
  entryMenuItems,
  folderBackgroundItems,
  openFileItems,
  withGroupItem,
  type EntryActions,
} from "../../../../../src/frontends/web/client/file-actions.ts";
import type { MenuItem } from "../../../../../src/frontends/web/client/Menu.tsx";

/** Records each chosen action, so a test checks what an item does. */
function recorder(): { readonly actions: EntryActions; readonly calls: string[] } {
  const calls: string[] = [];
  const actions: EntryActions = {
    newEntry: (folder, kind) => calls.push(`new ${kind} in ${folder}`),
    rename: (path) => calls.push(`rename ${path}`),
    duplicate: (path) => calls.push(`duplicate ${path}`),
    remove: (path) => calls.push(`delete ${path}`),
    copy: (text) => calls.push(`copy ${text}`),
    download: (path, folder) => calls.push(`download ${path}${folder ? " as zip" : ""}`),
    encrypt: (path) => calls.push(`encrypt ${path}`),
    favorite: (path, on) => calls.push(`${on ? "star" : "unstar"} ${path}`),
  };
  return { actions, calls };
}

const layout = (items: readonly MenuItem[]): string[] => items.map((item) => `${item.group ?? "-"}: ${item.label}`);

describe("entryMenuItems (#1117)", () => {
  test("a file gets the Organize, Copy, Share and Security sections, in this order", () => {
    const { actions } = recorder();
    const items = entryMenuItems(
      { path: "Notes/list.md", name: "list.md", kind: "file", favorite: false, vaultFolder: "/vault" },
      actions,
    );
    expect(layout(items)).toEqual([
      "Organize: Add to favorites",
      "Organize: Rename",
      "Organize: Duplicate",
      "Organize: Delete",
      "Copy: Copy name",
      "Copy: Copy path in the vault",
      "Copy: Copy full path on this computer",
      "Share: Download",
      "Security: Encrypt",
    ]);
    expect(items.find((item) => item.label === "Delete")?.danger).toBe(true);
  });

  test("a folder gets New first, no Duplicate or Encrypt, and downloads as a zip", () => {
    const { actions, calls } = recorder();
    const items = entryMenuItems(
      { path: "Notes", name: "Notes", kind: "folder", favorite: true, vaultFolder: null },
      actions,
    );
    expect(layout(items)).toEqual([
      "New: New file",
      "New: New folder",
      "Organize: Remove from favorites",
      "Organize: Rename",
      "Organize: Delete",
      "Copy: Copy name",
      "Copy: Copy path in the vault",
      "Share: Download as zip",
    ]);
    for (const item of items) item.onChoose();
    expect(calls).toEqual([
      "new file in Notes",
      "new folder in Notes",
      "unstar Notes",
      "rename Notes",
      "delete Notes",
      "copy Notes",
      "copy Notes",
      "download Notes as zip",
    ]);
  });

  test("the vault root keeps its name and its place, and an encrypted file only copies and stars", () => {
    const { actions } = recorder();
    expect(
      layout(entryMenuItems({ path: "", name: "Vault", kind: "folder", favorite: null, vaultFolder: "/v" }, actions)),
    ).toEqual(["New: New file", "New: New folder", "Copy: Copy full path on this computer", "Share: Download as zip"]);
    expect(
      layout(
        entryMenuItems(
          { path: "a.md.eva-secret", name: "a.md.eva-secret", kind: "encrypted", favorite: false, vaultFolder: null },
          actions,
        ),
      ),
    ).toEqual(["Organize: Add to favorites", "Copy: Copy name", "Copy: Copy path in the vault"]);
  });

  test("the open file adds its own items to their sections, and its own Download replaces the plain one", () => {
    const { actions, calls } = recorder();
    const own: string[] = [];
    const items = entryMenuItems(
      { path: "a.md", name: "a.md", kind: "file", favorite: false, vaultFolder: null },
      actions,
      {
        view: [{ label: "Wrap long lines", icon: "wrap", onChoose: () => own.push("wrap") }],
        download: () => own.push("download"),
        security: [{ label: "Lock encrypted files", icon: "lock", onChoose: () => own.push("lock") }],
      },
    );
    expect(layout(items).slice(-4)).toEqual([
      "View: Wrap long lines",
      "Share: Download",
      "Security: Encrypt",
      "Security: Lock encrypted files",
    ]);
    items.find((item) => item.label === "Download")?.onChoose();
    expect(own).toEqual(["download"]);
    expect(calls).toEqual([]);
  });
});

describe("folderBackgroundItems (#1117)", () => {
  test("a press beside the rows of a folder offers New file and New folder there", () => {
    const { actions, calls } = recorder();
    const items = folderBackgroundItems("Notes", actions);
    expect(layout(items)).toEqual(["New: New file", "New: New folder"]);
    for (const item of items) item.onChoose();
    expect(calls).toEqual(["new file in Notes", "new folder in Notes"]);
  });
});

describe("withGroupItem (#1117)", () => {
  const item = (label: string, group?: string): MenuItem => ({
    label,
    ...(group === undefined ? {} : { group }),
    onChoose: () => undefined,
  });

  test("an item joins the end of its section, or takes the place of its section in the order of the menu", () => {
    const items = [item("Copy name", "Copy"), item("Download", "Share")];
    expect(layout(withGroupItem(items, item("Copy contents", "Copy")))).toEqual([
      "Copy: Copy name",
      "Copy: Copy contents",
      "Share: Download",
    ]);
    expect(layout(withGroupItem(items, item("Make the file large", "View")))).toEqual([
      "Copy: Copy name",
      "View: Make the file large",
      "Share: Download",
    ]);
  });
});

describe("openFileItems (#1117)", () => {
  test("an open encrypted file gets only its own View, Share and Security items", () => {
    const own: string[] = [];
    const items = openFileItems({
      view: [{ label: "Wrap long lines", onChoose: () => own.push("wrap") }],
      download: () => own.push("download"),
      security: [{ label: "Decrypt", onChoose: () => own.push("decrypt") }],
    });
    expect(layout(items)).toEqual(["View: Wrap long lines", "Share: Download", "Security: Decrypt"]);
    for (const item of items) item.onChoose();
    expect(own).toEqual(["wrap", "download", "decrypt"]);
    expect(openFileItems({})).toEqual([]);
  });
});

describe("entryMenuItems: a file that does not download (#1117)", () => {
  test("a secrets file that Eva shows as unreadable offers no Download", () => {
    const { actions } = recorder();
    const items = entryMenuItems(
      { path: ".env", name: ".env", kind: "file", favorite: null, vaultFolder: null, downloadable: false },
      actions,
    );
    expect(items.some((item) => item.label === "Download")).toBe(false);
  });
});
