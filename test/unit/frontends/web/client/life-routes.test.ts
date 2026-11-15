import { describe, expect, test } from "bun:test";
import { lifeAddressOf, lifeRouteOf } from "../../../../../src/frontends/web/client/life-routes.ts";

describe("routes", () => {
  test("an address names a kind and an entity, and back again", () => {
    expect(lifeRouteOf("#/cases")).toEqual({ kind: "cases", entityId: null });
    expect(lifeRouteOf("#/cases/")).toEqual({ kind: "cases", entityId: null });
    expect(lifeRouteOf("#/people/Alex%20Example")).toEqual({ kind: "people", entityId: "Alex Example" });
    expect(lifeRouteOf("#/people/%E0%A4%A")).toEqual({ kind: "people", entityId: null });
    expect(lifeRouteOf("#/people/a/b")).toEqual({ kind: "people", entityId: null });
    expect(lifeRouteOf("#/projects")).toBeNull();
    // The Objects page became Inventory (#940): an old bookmark still opens it.
    expect(lifeRouteOf("#/objects/Car")).toEqual({ kind: "inventory", entityId: "Car" });
    expect(lifeRouteOf("")).toBeNull();
    expect(lifeAddressOf("pets")).toBe("#/pets");
    for (const id of ["Alex Example", "Car - Example Model - 1234ABC", "Luna 2020", "50% #1 ?"]) {
      expect(lifeRouteOf(lifeAddressOf("inventory", id))).toEqual({ kind: "inventory", entityId: id });
    }
  });
});
