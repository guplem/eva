import { describe, expect, test } from "bun:test";
import { fullPathOf } from "../../../../../src/frontends/web/client/file-paths.ts";

describe("fullPathOf", () => {
  test("joins the vault folder and the vault path of a Linux machine with slashes", () => {
    expect(fullPathOf("/home/ana/vault", "Life/Inventory/Item.md")).toBe("/home/ana/vault/Life/Inventory/Item.md");
  });

  test("joins with backslashes when the vault folder is a Windows path", () => {
    expect(fullPathOf("C:\\Users\\ana\\vault", "Life/Inventory/Item.md")).toBe(
      "C:\\Users\\ana\\vault\\Life\\Inventory\\Item.md",
    );
  });

  test("the vault root is the vault folder itself", () => {
    expect(fullPathOf("/home/ana/vault", "")).toBe("/home/ana/vault");
  });

  test("a vault folder that ends with a separator gets no double separator", () => {
    expect(fullPathOf("/home/ana/vault/", "Life")).toBe("/home/ana/vault/Life");
    expect(fullPathOf("C:\\vault\\", "Life")).toBe("C:\\vault\\Life");
  });
});
