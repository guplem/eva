import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseInstance } from "../../../../src/frontends/cli/instance-choice.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { fakeHost, type FakeHost } from "../../../support/fake-host.ts";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-instances-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function makeInstance(name: string): void {
  mkdirSync(join(folder, `eva-${name}`));
  writeFileSync(join(folder, `eva-${name}`, "config.json"), "{}\n");
}

function host(answers: string[] = [], environment: Record<string, string> = {}): FakeHost {
  return fakeHost({ environment: { XDG_CONFIG_HOME: folder, ...environment } }, answers);
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (isEvaError(error, "config_invalid")) return error.message;
    throw error;
  }
  throw new Error("no refusal");
}

describe("an Eva named by --instance or EVA_INSTANCE", () => {
  test("--instance names the Eva, and wins over EVA_INSTANCE", async () => {
    makeInstance("ana");
    makeInstance("bob");
    const paths = await chooseInstance(host([], { EVA_INSTANCE: "bob" }), {
      name: "ana",
      creates: false,
      interactive: false,
    });
    expect(paths.root).toBe(join(folder, "eva-ana"));
  });

  test("EVA_INSTANCE names the Eva without a question", async () => {
    makeInstance("ana");
    makeInstance("bob");
    const paths = await chooseInstance(host([], { EVA_INSTANCE: "bob" }), {
      name: undefined,
      creates: false,
      interactive: true,
    });
    expect(paths.root).toBe(join(folder, "eva-bob"));
  });

  test("a command for an Eva that does not exist says how to make her", async () => {
    makeInstance("ana");
    const message = await refusal(chooseInstance(host(), { name: "zoe", creates: false, interactive: false }));
    expect(message).toContain("No Eva named zoe");
    expect(message).toContain("ana");
    expect(message).toContain("eva --instance zoe setup");
  });

  test("setup makes a new Eva with the name", async () => {
    const paths = await chooseInstance(host(), { name: "zoe", creates: true, interactive: false });
    expect(paths.root).toBe(join(folder, "eva-zoe"));
  });

  test("a bad name never becomes a folder", async () => {
    expect(await refusal(chooseInstance(host(), { name: "../x", creates: true, interactive: false }))).toContain(
      "is not a name for an Eva",
    );
  });
});

describe("a command with no name", () => {
  test("uses the only Eva", async () => {
    makeInstance("ana");
    const paths = await chooseInstance(host(), { name: undefined, creates: false, interactive: true });
    expect(paths.root).toBe(join(folder, "eva-ana"));
  });

  test("says to run setup when there is no Eva", async () => {
    expect(await refusal(chooseInstance(host(), { name: undefined, creates: false, interactive: true }))).toContain(
      "eva setup",
    );
  });

  test("asks a person which Eva, by number or by name", async () => {
    makeInstance("ana");
    makeInstance("bob");
    const byNumber = host(["2"]);
    expect((await chooseInstance(byNumber, { name: undefined, creates: false, interactive: true })).root).toBe(
      join(folder, "eva-bob"),
    );
    expect(byNumber.output.join("")).toContain("1. ana");
    const byName = host(["zoe", "9", "ana"]);
    expect((await chooseInstance(byName, { name: undefined, creates: false, interactive: true })).root).toBe(
      join(folder, "eva-ana"),
    );
  });

  test("refuses a script, and names the Evas and the option", async () => {
    makeInstance("ana");
    makeInstance("bob");
    const message = await refusal(chooseInstance(host(), { name: undefined, creates: false, interactive: false }));
    expect(message).toContain("ana, bob");
    expect(message).toContain("--instance");
  });

  test("stops asking after a few wrong answers", async () => {
    makeInstance("ana");
    makeInstance("bob");
    expect(await refusal(chooseInstance(host(), { name: undefined, creates: false, interactive: true }))).toContain(
      "--instance",
    );
  });
});

describe("setup with no name", () => {
  test("asks a person the name of the first Eva, and Enter gives eva", async () => {
    const person = host([""]);
    const paths = await chooseInstance(person, { name: undefined, creates: true, interactive: true });
    expect(paths.root).toBe(join(folder, "eva-eva"));
    expect(person.output.join("")).toBe("");
  });

  test("asks again after a bad name", async () => {
    const person = host(["Ana Smith", "ana"]);
    const paths = await chooseInstance(person, { name: undefined, creates: true, interactive: true });
    expect(paths.root).toBe(join(folder, "eva-ana"));
    expect(person.output.join("")).toContain("is not a name for an Eva");
  });

  test("with Evas already here, a number sets one up again and a new name makes a new one", async () => {
    makeInstance("ana");
    makeInstance("bob");
    const again = host(["", "1"]);
    expect((await chooseInstance(again, { name: undefined, creates: true, interactive: true })).root).toBe(
      join(folder, "eva-ana"),
    );
    expect(again.output.join("")).toContain("1. ana");
    expect((await chooseInstance(host(["zoe"]), { name: undefined, creates: true, interactive: true })).root).toBe(
      join(folder, "eva-zoe"),
    );
  });

  test("a script sets up the first Eva as eva, and the only Eva again", async () => {
    expect((await chooseInstance(host(), { name: undefined, creates: true, interactive: false })).root).toBe(
      join(folder, "eva-eva"),
    );
    makeInstance("ana");
    expect((await chooseInstance(host(), { name: undefined, creates: true, interactive: false })).root).toBe(
      join(folder, "eva-ana"),
    );
  });

  test("a script must name the Eva when there are several", async () => {
    makeInstance("ana");
    makeInstance("bob");
    expect(await refusal(chooseInstance(host(), { name: undefined, creates: true, interactive: false }))).toContain(
      "EVA_INSTANCE",
    );
  });
});
