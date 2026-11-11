import { describe, expect, test } from "bun:test";
import type { LifeEntity } from "../../../../../src/frontends/web/client/api.ts";
import {
  bodyWithoutTitle,
  caseSteps,
  dayWords,
  lifeCardOf,
  lifeCardPill,
  lifeCounts,
  lifeFacts,
  lifeGroups,
  lifeHeader,
  lifePages,
  matchesLifeFilter,
  matchesLifeSearch,
  type DayState,
  type LifeCardBody,
  type LifePill,
} from "../../../../../src/frontends/web/client/life-pages.ts";
import { lifeKinds, type LifeKind } from "../../../../../src/shared/life-kinds.ts";

type CaseDeadline = Extract<LifeCardBody, { kind: "cases" }>["deadline"];
type PetBody = Extract<LifeCardBody, { kind: "pets" }>;

/** A fixed day, so each date state stays the same on any day of a run. */
const now = new Date(2026, 10, 11, 12, 0);

function entity(
  kind: LifeKind,
  id: string,
  fields: Record<string, unknown> = {},
  more: Partial<LifeEntity> = {},
): LifeEntity {
  const folder = `Life/X/${id}`;
  return {
    kind,
    id,
    folder,
    path: `${folder}/Main.md`,
    title: id,
    summary: null,
    aliases: [],
    tags: [],
    fields,
    warnings: [],
    ...more,
  } satisfies LifeEntity;
}

function body<K extends LifeCardBody["kind"]>(
  card: { body: LifeCardBody },
  kind: K,
): Extract<LifeCardBody, { kind: K }> {
  if (card.body.kind !== kind) throw new Error(`Expected a ${kind} card`);
  return card.body as Extract<LifeCardBody, { kind: K }>;
}

const openCase = entity("cases", "2026-09-01-bumper-claim", {
  opened: "2026-09-01",
  closed: "",
  steps: [
    { step: "Send the photos", "done-on": "2026-09-02" },
    { step: "Get the answer", "waiting-for": "Example Insurance", "due-by": "2026-11-14" },
    { step: "Take the car to the garage" },
  ],
  deadline: { date: "2026-11-20", cost: "The right to claim expires" },
});

describe("lifePages", () => {
  test("each kind has a title, a description, empty words and a default filter that it lists", () => {
    for (const kind of lifeKinds) {
      const page = lifePages[kind];
      expect(page.title).not.toBe("");
      expect(page.description).not.toBe("");
      expect(page.empty).toContain("Eva");
      const ids = page.filters.map((filter) => filter.id);
      if (ids.length > 0) expect(ids).toContain(page.defaultFilter);
    }
    expect(lifePages.cases.defaultFilter).toBe("open");
    expect(lifePages.objects.defaultFilter).toBe("kept");
    expect(lifePages.people.filters).toEqual([]);
  });
});

describe("dayWords", () => {
  test("reads a day, a month and a year, and keeps any other text", () => {
    expect(dayWords("2026-06-01")).toBe("1 Jun 2026");
    expect(dayWords("2024-09")).toBe("Sep 2024");
    expect(dayWords("2024")).toBe("2024");
    expect(dayWords("2026-02-30")).toBe("2026-02-30");
    expect(dayWords("soon")).toBe("soon");
  });
});

describe("cases", () => {
  test("a case is open until closed holds a date", () => {
    expect(matchesLifeFilter(openCase, "open")).toBe(true);
    expect(matchesLifeFilter(openCase, "closed")).toBe(false);
    const closed = entity("cases", "b", { closed: "2025-04-30" });
    expect(matchesLifeFilter(closed, "closed")).toBe(true);
    expect(matchesLifeFilter(closed, "all")).toBe(true);
    expect(body(lifeCardOf(closed, now), "cases")).toMatchObject({ open: false, closed: "30 Apr 2025", current: null });
  });

  test("the card shows the current step, its day, who it waits for, the progress and the deadline", () => {
    const card = body(lifeCardOf(openCase, now), "cases");
    expect(card.open).toBe(true);
    expect(card.progress).toEqual({ done: 1, total: 3, words: "1 of 3 steps done" });
    expect(card.current?.text).toBe("Get the answer");
    expect(card.current?.waitingFor).toBe("Example Insurance");
    expect(card.current?.due).toMatchObject({ words: "Due in 3 days", tone: "warn", text: "14 Nov 2026" });
    expect(card.deadline).toMatchObject({ cost: "The right to claim expires" });
    expect(card.deadline?.due).toMatchObject({ words: "Deadline in 9 days", tone: "warn" });
  });

  test("a day words each state and never with the colour alone", () => {
    const due = (day: string): DayState | null | undefined =>
      body(lifeCardOf(entity("cases", "x", { steps: [{ step: "s", "due-by": day }] }), now), "cases").current?.due;
    expect(due("2026-11-10")).toMatchObject({ words: "Overdue by 1 day", tone: "warn", overdue: true });
    expect(due("2026-11-01")).toMatchObject({ words: "Overdue by 10 days", overdue: true });
    expect(due("2026-11-11")).toMatchObject({ words: "Due today", tone: "warn", overdue: false });
    expect(due("2026-11-12")).toMatchObject({ words: "Due tomorrow", tone: "warn" });
    expect(due("2026-12-24")).toMatchObject({ words: "Due 24 Dec 2026", tone: "idle" });
    // A month alone has no day to pass.
    expect(due("2026-10")).toMatchObject({ words: "Due Oct 2026", tone: "idle", overdue: false });
    expect(due("")).toBeNull();
    const deadline = (date: unknown): CaseDeadline =>
      body(lifeCardOf(entity("cases", "x", { deadline: date }), now), "cases").deadline;
    expect(deadline({ date: "2026-11-01", cost: "" })).toMatchObject({
      cost: null,
      due: { words: "Deadline passed", tone: "failed" },
    });
    expect(deadline({ date: "2027-03-01" })?.due).toMatchObject({ words: "Deadline 1 Mar 2027", tone: "idle" });
    expect(deadline({ date: "", cost: "" })).toBeNull();
    expect(deadline("")).toBeNull();
    // An older form writes the day alone.
    expect(deadline("2026-11-11")?.due?.words).toBe("Deadline today");
    expect(deadline({ cost: "A fee" })).toEqual({ due: null, cost: "A fee" });
  });

  test("a case with no steps, or an old-form case, shows as open with the facts it has", () => {
    const bare = body(lifeCardOf(entity("cases", "x"), now), "cases");
    expect(bare).toMatchObject({ open: true, progress: null, current: null, deadline: null });
    const old = body(
      lifeCardOf(entity("cases", "x", { status: "waiting", next: "Call the bank", "waiting-for": "The bank" }), now),
      "cases",
    );
    expect(old.open).toBe(true);
    expect(old.current).toEqual({ text: "Call the bank", waitingFor: "The bank", due: null });
    expect(matchesLifeFilter(entity("cases", "x", { status: "closed" }), "open")).toBe(true);
  });

  test("caseSteps marks each step done, current or to do, and reads odd steps tolerantly", () => {
    const steps = caseSteps(openCase.fields, now);
    expect(steps.map((step) => step.state)).toEqual(["done", "current", "todo"]);
    expect(steps[0]?.doneOn).toBe("2 Sep 2026");
    expect(steps[1]?.due?.words).toBe("Due in 3 days");
    expect(caseSteps({ steps: "not a list" }, now)).toEqual([]);
    const odd = caseSteps({ steps: ["Plain text step", { "done-on": "2026-01-01" }, null] }, now);
    expect(odd.map((step) => [step.text, step.state])).toEqual([
      ["Plain text step", "current"],
      ["A step", "done"],
    ]);
    // Every step done: no current step.
    expect(caseSteps({ steps: [{ step: "a", "done-on": "2026-01-01" }] }, now)[0]?.state).toBe("done");
  });

  test("open cases come first by the day of the current step, then closed cases newest first", () => {
    const list = [
      entity("cases", "closed-old", { closed: "2024-01-01" }),
      entity("cases", "no-day", { steps: [{ step: "s" }] }),
      entity("cases", "later", { steps: [{ step: "s", "due-by": "2027-01-01" }] }),
      entity("cases", "closed-new", { closed: "2025-01-01" }),
      entity("cases", "soon", { steps: [{ step: "s", "due-by": "2026-11-12" }] }),
    ];
    const groups = lifeGroups("cases", list, "all", now);
    expect(groups.map((group) => [group.label, group.entities.map((each) => each.id)])).toEqual([
      ["Open", ["soon", "later", "no-day"]],
      ["Closed", ["closed-new", "closed-old"]],
    ]);
    expect(lifeGroups("cases", list, "open", now)).toEqual([
      { label: null, entities: [list[4], list[2], list[1]] as LifeEntity[] },
    ]);
    expect(lifeGroups("cases", [], "open", now)).toEqual([]);
    expect(lifeCounts("cases", list, now)).toBe("3 open · 2 closed");
  });
});

describe("people", () => {
  test("the card shows the mark, the relation with the name of a linked person, and the contact", () => {
    const sam = entity("people", "Sam Example", {
      relation: "sister of Life/People/Alex Example",
      contact: "https://contacts.example.com/person/1",
    });
    const card = body(lifeCardOf(sam, now), "people");
    expect(card.initials).toBe("SE");
    expect(card.color).toStartWith("var(--type-");
    expect(card.relation).toBe("sister of Alex Example");
    expect(card.contact?.href).toBe("https://contacts.example.com/person/1");
    const bare = body(lifeCardOf(entity("people", "Jo", { relation: "", contact: "the phone" }), now), "people");
    expect(bare.relation).toBeNull();
    expect(bare.contact).toBeNull();
  });

  test("people come in the order of their names, and the count says people", () => {
    const list = [entity("people", "Sam"), entity("people", "alex"), entity("people", "Jordan")];
    expect(lifeGroups("people", list, "all", now)[0]?.entities.map((each) => each.id)).toEqual([
      "alex",
      "Jordan",
      "Sam",
    ]);
    expect(lifeCounts("people", list, now)).toBe("3 people");
    expect(lifeCounts("people", list.slice(0, 1), now)).toBe("1 person");
  });
});

describe("objects", () => {
  const car = entity("objects", "Car - Example Model - 1234ABC", {
    status: "in-use",
    type: "car",
    owner: "",
    ids: { plate: "1234ABC", vin: "EXAMPLEVIN0000000" },
  });

  test("the card shows the type, the model, the IDs, the status and the owner", () => {
    const card = body(lifeCardOf(car, now), "objects");
    expect(card).toMatchObject({
      type: "Car",
      model: "Example Model",
      ids: ["Plate 1234ABC", "VIN EXAMPLEVIN0000000"],
      pill: { text: "In use", tone: "live" },
      owner: null,
    });
    const drill = body(
      lifeCardOf(
        entity("objects", "Drill - Example Tools - 2022", { status: "lent", owner: "Life/People/Sam Example" }),
        now,
      ),
      "objects",
    );
    expect(drill).toMatchObject({ type: "Drill", model: "Example Tools", ids: ["2022"], owner: "Sam Example" });
    expect(drill.pill).toEqual({ text: "Lent", tone: "warn" });
    const odd = body(lifeCardOf(entity("objects", "Thing", { status: "broken", ids: "" }), now), "objects");
    expect(odd).toMatchObject({ type: null, model: null, ids: [], pill: { text: "Broken", tone: "idle" } });
    expect(body(lifeCardOf(entity("objects", "Thing", { status: "" }), now), "objects").pill).toBeNull();
    expect(
      body(lifeCardOf(entity("objects", "Phone - Model", { ids: { imei: "4321" } }), now), "objects"),
    ).toMatchObject({
      type: "Phone",
      model: "Model",
      ids: ["IMEI 4321"],
    });
  });

  test("In use keeps what the person still has, and Gone what they sold or lost", () => {
    const sold = entity("objects", "s", { status: "sold" });
    const stored = entity("objects", "t", { status: "stored" });
    const blank = entity("objects", "u", { status: "" });
    expect([car, stored, blank, sold].map((each) => matchesLifeFilter(each, "kept"))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(
      [car, sold, entity("objects", "g", { status: "gone" })].map((each) => matchesLifeFilter(each, "gone")),
    ).toEqual([false, true, true]);
    expect(lifeCounts("objects", [car, stored, sold], now)).toBe("2 kept · 1 gone");
  });

  test("objects group by type, with Other last, and each label keeps the first spelling", () => {
    const list = [
      entity("objects", "Phone - B", { type: "phone" }),
      entity("objects", "Phone - C", { type: "phone" }),
      entity("objects", "TV - A", { type: "TV" }),
      entity("objects", "TV - B", { type: "tv" }),
      entity("objects", "Lamp", {}),
      entity("objects", "Car - Z", { type: "car" }),
      entity("objects", "Car - A", { type: "Car" }),
    ];
    expect(
      lifeGroups("objects", list, "all", now).map((group) => [group.label, group.entities.map((each) => each.id)]),
    ).toEqual([
      ["Car", ["Car - A", "Car - Z"]],
      ["Phone", ["Phone - B", "Phone - C"]],
      ["TV", ["TV - A", "TV - B"]],
      ["Other", ["Lamp"]],
    ]);
  });
});

describe("pets", () => {
  test("the card shows the species, the breed and the age at now", () => {
    const luna = body(
      lifeCardOf(
        entity("pets", "Luna", { species: "dog", breed: "Border collie", birth: "2020-08-01", death: "" }),
        now,
      ),
      "pets",
    );
    expect(luna).toMatchObject({
      species: "Dog",
      breed: "Border collie",
      life: "6 years old",
      died: false,
      initials: "L",
    });
    const young = (birth: string): string | null => body(lifeCardOf(entity("pets", "p", { birth }), now), "pets").life;
    expect(young("2026-06-01")).toBe("5 months old");
    expect(young("2026-11-01")).toBe("Under a month old");
    expect(young("2020")).toBe("About 6 years old");
    expect(young("2026")).toBe("Born in 2026");
    expect(young("")).toBeNull();
    expect(young("2030-01-01")).toBeNull();
  });

  test("a pet that died shows the years it lived", () => {
    const life = (fields: Record<string, unknown>): PetBody =>
      body(lifeCardOf(entity("pets", "p", fields), now), "pets");
    expect(life({ birth: "2008", death: "2024-03-10" })).toMatchObject({ died: true, life: "Lived about 16 years" });
    expect(life({ birth: "2010-05-01", death: "2024-06-01" }).life).toBe("Lived 14 years");
    expect(life({ birth: "2024-01-01", death: "2024-06-01" }).life).toBe("Lived 5 months");
    expect(life({ death: "2024" })).toMatchObject({ died: true, life: "Died in 2024" });
    expect(lifeCounts("pets", [entity("pets", "a", { death: "2024" }), entity("pets", "b")], now)).toBe(
      "1 living · 1 died",
    );
    expect(lifeCounts("pets", [entity("pets", "b")], now)).toBe("1 pet");
  });
});

describe("periods", () => {
  const job = entity("periods", "2024-09-01-job", {
    type: "job",
    from: "2024-09-01",
    to: "",
    org: "Example Corp",
    role: "Engineer",
  });
  const study = entity("periods", "2019-09-01-study", {
    type: "study",
    from: "2019-09-01",
    to: "2023-06-30",
    org: "Example University",
  });

  test("the card shows the span, its length, the type, the organisation and the role", () => {
    expect(body(lifeCardOf(job, now), "periods")).toEqual({
      kind: "periods",
      type: "Job",
      work: "Engineer at Example Corp",
      span: "Sep 2024 to now",
      length: "2 years 2 months",
      goesOn: true,
    });
    expect(body(lifeCardOf(study, now), "periods")).toMatchObject({
      span: "Sep 2019 to Jun 2023",
      length: "3 years 10 months",
      goesOn: false,
    });
  });

  test("a period goes on while to is empty or in the future", () => {
    const contract = body(lifeCardOf(entity("periods", "c", { from: "2026-10-15", to: "2027-06-30" }), now), "periods");
    expect(contract).toMatchObject({ goesOn: true, span: "Oct 2026 to Jun 2027", length: "Under a month" });
    const years = body(lifeCardOf(entity("periods", "y", { from: "2018", to: "2020" }), now), "periods");
    expect(years).toMatchObject({ goesOn: false, span: "2018 to 2020", length: "3 years" });
    expect(body(lifeCardOf(entity("periods", "n", { to: "2020-01-31" }), now), "periods")).toMatchObject({
      span: "Until Jan 2020",
      length: null,
      type: null,
    });
    expect(body(lifeCardOf(entity("periods", "e"), now), "periods")).toMatchObject({ span: null, goesOn: true });
  });

  test("an old-form period falls back to kind, status, start and end", () => {
    const old = body(
      lifeCardOf(entity("periods", "o", { kind: "volunteer", status: "ended", start: "2015-01-01" }), now),
      "periods",
    );
    expect(old).toMatchObject({ type: "Volunteer", goesOn: false, span: "From Jan 2015", length: null });
    const active = body(
      lifeCardOf(entity("periods", "a", { kind: "job", status: "active", start: "2026-01-01" }), now),
      "periods",
    );
    expect(active).toMatchObject({ goesOn: true, span: "Jan 2026 to now", length: "10 months" });
  });

  test("periods come newest first, and the count says what goes on", () => {
    const none = entity("periods", "none");
    expect(lifeGroups("periods", [study, none, job], "all", now)[0]?.entities.map((each) => each.id)).toEqual([
      job.id,
      study.id,
      none.id,
    ]);
    expect(lifeCounts("periods", [study, job], now)).toBe("1 going on · 1 ended");
  });
});

describe("matchesLifeSearch", () => {
  const sam = entity(
    "people",
    "Sam Example",
    {},
    { title: "Sam Example", aliases: ["Sammy"], tags: ["family"], summary: "Plays the PIANO." },
  );
  test("matches the title, the aliases, the summary and the tags, with any case", () => {
    expect(matchesLifeSearch(sam, "")).toBe(true);
    expect(matchesLifeSearch(sam, "  sam ")).toBe(true);
    expect(matchesLifeSearch(sam, "SAMMY")).toBe(true);
    expect(matchesLifeSearch(sam, "piano")).toBe(true);
    expect(matchesLifeSearch(sam, "#Family")).toBe(true);
    expect(matchesLifeSearch(sam, "violin")).toBe(false);
    expect(matchesLifeSearch(entity("people", "x"), "plays")).toBe(false);
  });
});

describe("lifeCardOf", () => {
  test("keeps the title, the summary and the count of warnings", () => {
    const card = lifeCardOf(entity("people", "x", {}, { title: "X", summary: "S", warnings: ["bad", "worse"] }), now);
    expect(card).toMatchObject({ title: "X", summary: "S", warnings: 2 });
  });
});

describe("lifeFacts", () => {
  test("lists each field, links a Life path, and leaves out the steps of a case", () => {
    const format = { locale: "en-GB", clock: null };
    const facts = lifeFacts(
      entity(
        "cases",
        "x",
        { opened: "2026-09-01", steps: [{ step: "s" }], about: "Life/Pets/Luna" },
        { aliases: ["the claim"], tags: ["car"] },
      ),
      format,
    );
    expect(facts.map((fact) => fact.label)).toEqual(["Opened", "About", "Aliases", "Tags"]);
    expect(facts[1]?.value).toEqual({ kind: "text", parts: [{ text: "Luna", href: "#/pets/Luna" }] });
    const nested = lifeFacts(
      entity("objects", "x", { owners: ["Life/People/Sam Example"], ids: { plate: "1" } }),
      format,
    );
    expect(nested[0]?.value).toEqual({
      kind: "list",
      items: [{ kind: "text", parts: [{ text: "Sam Example", href: "#/people/Sam%20Example" }] }],
    });
    expect(nested[1]?.value.kind).toBe("map");
  });
});

describe("bodyWithoutTitle", () => {
  test("drops a first heading that repeats the title", () => {
    expect(bodyWithoutTitle("\n# Phone repair\n\n- A line\n", "Phone repair")).toBe("- A line\n");
    expect(bodyWithoutTitle("# Other\n\nText", "Phone repair")).toBe("# Other\n\nText");
    expect(bodyWithoutTitle("Text", "Text")).toBe("Text");
  });
});

describe("lifeCardPill", () => {
  test("gives the pill beside the title: closed, the object status, died, or going on", () => {
    const pill = (kind: LifeKind, fields: Record<string, unknown>): LifePill | null =>
      lifeCardPill(lifeCardOf(entity(kind, "x", fields), now).body);
    expect(pill("cases", { closed: "2025-01-01" })).toEqual({ text: "Closed", tone: "idle" });
    expect(pill("cases", {})).toBeNull();
    expect(pill("objects", { status: "lent" })).toEqual({ text: "Lent", tone: "warn" });
    expect(pill("pets", { death: "2024" })).toEqual({ text: "Died", tone: "idle" });
    expect(pill("pets", {})).toBeNull();
    expect(pill("periods", { from: "2020" })).toEqual({ text: "Going on", tone: "live" });
    expect(pill("periods", { to: "2020" })).toBeNull();
    expect(pill("people", {})).toBeNull();
  });
});

describe("review round 1", () => {
  test("an old-form case reads its next step from a map of date and step", () => {
    const old = body(
      lifeCardOf(entity("cases", "x", { status: "open", next: { date: "2026-11-12", step: "Call the bank" } }), now),
      "cases",
    );
    expect(old.current).toEqual({
      text: "Call the bank",
      waitingFor: null,
      due: expect.objectContaining({ words: "Due tomorrow" }) as DayState,
    });
    const empty = body(lifeCardOf(entity("cases", "x", { next: { date: "", step: "" } }), now), "cases");
    expect(empty.current).toBeNull();
  });

  test("the facts keep steps that are not a list, and leave out the deadline that the case page shows", () => {
    const format = { clock: null };
    const labels = (fields: Record<string, unknown>): string[] =>
      lifeFacts(entity("cases", "x", fields), format).map((fact) => fact.label);
    expect(labels({ steps: "Call the bank", deadline: { date: "2026-12-01", cost: "A fee" } })).toEqual(["Steps"]);
    expect(labels({ steps: [{ step: "s" }], deadline: "" })).toEqual([]);
  });

  test("a date in the facts reads as on the cards", () => {
    const facts = lifeFacts(entity("periods", "x", { from: "2024-09-01", to: "2024-09", at: "2026-01-31T09:15" }), {
      locale: "en-GB",
      clock: null,
    });
    expect(facts.map((fact) => (fact.value.kind === "date" ? fact.value.text : null))).toEqual([
      "1 Sep 2024",
      "Sep 2024",
      expect.stringContaining("Jan 2026") as string,
    ]);
  });

  test("the facts leave out what the header and the pills say, and read ID keys well", () => {
    const format = { clock: null };
    const facts = lifeFacts(
      entity("objects", "Car - M - 1", { status: "in-use", type: "car", ids: { vin: "V1", plate: "P1" }, owner: "" }),
      format,
    );
    expect(facts.map((fact) => fact.label)).toEqual(["IDs"]);
    const ids = facts[0]?.value;
    expect(ids?.kind === "map" ? ids.facts.map((fact) => fact.label) : []).toEqual(["VIN", "Plate"]);
    expect(
      lifeFacts(entity("pets", "x", { species: "dog", breed: "Collie", chip: "1" }), format).map((f) => f.label),
    ).toEqual(["Chip"]);
    expect(
      lifeFacts(entity("periods", "x", { type: "job", kind: "job", org: "O" }), format).map((f) => f.label),
    ).toEqual(["Org"]);
  });

  test("an entity page names its title and a sub line from the facts that the header shows", () => {
    const header = (kind: LifeKind, id: string, fields: Record<string, unknown>): unknown =>
      lifeHeader(entity(kind, id, fields, { title: id }), now);
    expect(header("objects", "Car - Example Model - 1234ABC", { type: "car" })).toEqual({
      title: "Example Model",
      sub: "Car",
    });
    expect(header("pets", "Luna", { species: "dog", breed: "Border collie" })).toEqual({
      title: "Luna",
      sub: "Dog · Border collie",
    });
    expect(header("periods", "Study", { type: "study" })).toEqual({ title: "Study", sub: "Study" });
    expect(header("people", "Sam", { relation: "friend" })).toEqual({ title: "Sam", sub: null });
  });

  test("Kept holds what the person still has, and Gone what they sold or lost", () => {
    expect(lifePages.objects.filters.map((filter) => filter.label)).toEqual(["Kept", "Gone", "All"]);
  });

  test("objects skip the group headings when every group holds one object", () => {
    const list = [entity("objects", "Phone - B", { type: "phone" }), entity("objects", "Car - A", { type: "car" })];
    expect(lifeGroups("objects", list, "all", now)).toEqual([{ label: null, entities: [list[1]!, list[0]!] }]);
  });

  test("a period card hides a type that is its title, and a work line that the summary starts with", () => {
    const card = (fields: Record<string, unknown>, more: Partial<LifeEntity>): unknown =>
      body(lifeCardOf(entity("periods", "x", fields, more), now), "periods");
    expect(card({ type: "sabbatical" }, { title: "Sabbatical" })).toMatchObject({ type: null });
    expect(
      card(
        { type: "job", role: "Engineer", org: "Example Corp" },
        { title: "Job", summary: "Engineer at Example Corp, a company." },
      ),
    ).toMatchObject({ type: null, work: null });
    expect(card({ org: "Example Corp" }, { title: "T", summary: "Other words." })).toMatchObject({
      work: "Example Corp",
    });
  });
});
