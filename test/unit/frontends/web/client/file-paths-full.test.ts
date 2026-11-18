import { describe, expect, test } from "bun:test";
import { fullPathOf } from "../../../../../src/frontends/web/client/file-paths.ts";

describe("fullPathOf", () => {
  test("joins the vault folder and the vault path of a Linux machine with slashes", () => {
    expect(fullPathOf("/srv/example-vault", "Life/Inventory/Item.md")).toBe(
      "/srv/example-vault/Life/Inventory/Item.md",
    );
  });

  test("joins with backslashes when the vault folder is a Windows path", () => {
    expect(fullPathOf("D:\\example-vault", "Life/Inventory/Item.md")).toBe(
      "D:\\example-vault\\Life\\Inventory\\Item.md",
    );
  });

  test("the vault root is the vault folder itself", () => {
    expect(fullPathOf("/srv/example-vault", "")).toBe("/srv/example-vault");
  });

  test("a vault folder that ends with a separator gets no double separator", () => {
    expect(fullPathOf("/srv/example-vault/", "Life")).toBe("/srv/example-vault/Life");
    expect(fullPathOf("C:\\vault\\", "Life")).toBe("C:\\vault\\Life");
  });
});
