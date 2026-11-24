/** Tests of the person's place. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig } from "../../../src/core/settings/home.ts";
import { turnSnapshotRef } from "../../../src/core/vault/vault-snapshots.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { useEvaTestbed, clock, sandbox, setClock, start, vault, waitFor } from "../../support/eva-testbed.ts";

useEvaTestbed();

describe("the person's place (#371)", () => {
  const madrid = { latitude: 40.4, longitude: -3.7, accuracy: null };
  const aboutMe = (): string => readFileSync(join(vault, "Life", "About me.md"), "utf-8");

  test("a phone's point counts for a day, then the home place of About me", () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/About me.md", "---\nplaces:\n  home: { lat: 37.77, lon: -122.42 }\n---\n");
    expect(instance.saveLocation(madrid, "telegram", clock, true)).toBe(true);
    expect(instance.currentPlace()).toMatchObject({ latitude: 40.4, source: "telegram" });
    setClock(new Date(clock.getTime() + 25 * 60 * 60_000));
    expect(instance.currentPlace()).toEqual({
      latitude: 37.77,
      longitude: -122.42,
      accuracy: null,
      source: "home",
      at: null,
    });
  });

  test("only the hub keeps a location, as only the hub runs the schedules", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const satellite = start(new FakeEngine(), { machineName: "example-pc" });
    expect(() => satellite.saveLocation({ ...madrid, latitude: 1 }, "web", clock, true)).toThrow("hub");
  });

  test("the hub writes the point into About me, and the next sync carries it (#689)", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/About me.md", "---\nname: Alex\n---\n\n# About Alex\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => aboutMe().includes("lastLocation"));
    expect(aboutMe()).toBe(
      "---\nname: Alex\n# Eva's code fills lastLocation from your phone. Keep it as it is.\n" +
        `lastLocation: { latitude: 40.4, longitude: -3.7, accuracy: null, at: "${clock.toISOString()}", source: telegram }\n` +
        "---\n\n# About Alex\n",
    );
    await instance.syncVault();
    expect(sandbox.git(sandbox.remote, "show", "main:Life/About me.md")).toContain("lastLocation");
  });

  test("another computer reads the point from About me", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(
      vault,
      "Life/About me.md",
      `---\nlastLocation: { latitude: 40.4, longitude: -3.7, accuracy: 12, at: "${clock.toISOString()}", source: web }\n---\n`,
    );
    const satellite = start(new FakeEngine(), { machineName: "example-pc" });
    expect(satellite.currentPlace()).toEqual({ ...madrid, accuracy: 12, source: "web", at: clock.toISOString() });
  });

  test("with no About me, a problem says why the location is not saved, and a new note clears it", async () => {
    const instance = start(new FakeEngine());
    rmSync(join(vault, "Life", "About me.md"), { force: true });
    const problems = (): string => instance.status().problems.join("\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => problems().includes("Eva cannot save your location: Life/About me.md is missing"));
    expect(instance.currentPlace()).toMatchObject({ latitude: 40.4 });
    sandbox.write(vault, "Life/About me.md", "# About Alex\n");
    // The tick starts the write, and the write runs apart from it.
    await instance.backgroundTick();
    await waitFor(() => !problems().includes("location"));
    expect(aboutMe()).toContain("lastLocation");
  });

  test("a computer that stops being the hub closes its location alert", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    rmSync(join(vault, "Life", "About me.md"), { force: true });
    const problems = (): string => instance.status().problems.join("\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => problems().includes("Eva cannot save your location"));
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    await instance.backgroundTick();
    await waitFor(() => !problems().includes("location"));
  });

  test("never writes during an Assistant turn, and writes before the snapshot after it", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    // With sync on, Eva takes the snapshots of the turn.
    const instance = start(engine, { sync: defaultConfig.sync });
    sandbox.write(vault, "Life/About me.md", "---\nname: Alex\n---\n");
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    instance.saveLocation(madrid, "telegram", clock, true);
    await instance.backgroundTick();
    expect(aboutMe()).not.toContain("lastLocation");
    release();
    await turn;
    expect(aboutMe()).toContain("lastLocation");
    const after = sandbox.git(vault, "show", `${turnSnapshotRef(session.id, 0, "after")}:Life/About me.md`);
    expect(after).toContain("lastLocation");
  });
});
