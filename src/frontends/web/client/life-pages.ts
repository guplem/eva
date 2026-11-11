/**
 * The parts of the Life pages that need no page (#911): what each kind of `Life/` entity shows, its
 * filters, its order, its search and its addresses. `fields` holds what the YAML failsafe parser
 * gives, so every value is text, a list or a map, and an empty key is `""`. A file of an older
 * vault can lack a key, so each value falls back and never breaks a card.
 */
import type { LifeEntity } from "./api.ts";
import { daysBefore, months } from "./chat-list.ts";
import {
  factsOf,
  linkOf,
  type Fact,
  type FactFormat,
  type FactLink,
  type FactValue,
  type TextPart,
} from "./front-matter-facts.ts";
import { projectColor, projectInitials } from "./projects-home.ts";
import { countOf } from "./project-format.ts";
import { isLifeKind, type LifeKind } from "../../../shared/life-kinds.ts";

export interface LifeFilter {
  readonly id: string;
  readonly label: string;
}

export interface LifeKindPage {
  /** The name of the page, the same as its entry in the main navigation. */
  readonly title: string;
  /** One line under the title of the empty page: what the folder holds. */
  readonly description: string;
  /** What the folder is for, and that Eva adds an entity on request. */
  readonly empty: string;
  readonly searchLabel: string;
  /** No filters: the page shows every entity. */
  readonly filters: readonly LifeFilter[];
  readonly defaultFilter: string;
}

/** The filter of a kind with no filter chips. */
const allFilter = "all";

/** The one table that drives the five pages. */
export const lifePages: Readonly<Record<LifeKind, LifeKindPage>> = {
  cases: {
    title: "Cases",
    description: "Matters with steps and an end, such as a claim, a refund or a move.",
    empty:
      "A case is a matter with a start and an end, such as a claim, a refund or a move. Ask Eva in a chat to open one.",
    searchLabel: "Search cases",
    filters: [
      { id: "open", label: "Open" },
      { id: "closed", label: "Closed" },
      { id: allFilter, label: "All" },
    ],
    defaultFilter: "open",
  },
  people: {
    title: "People",
    description: "The people who matter to you, and what you know about them.",
    empty: "Each person who matters to you gets a note here, with what you know about them. Ask Eva to add one.",
    searchLabel: "Search people",
    filters: [],
    defaultFilter: allFilter,
  },
  objects: {
    title: "Objects",
    description: "The things you own or use, such as a car, a phone or a home.",
    empty: "An object is a thing you own or use, such as a car, a phone or a home. Ask Eva to add one.",
    searchLabel: "Search objects",
    filters: [
      { id: "in-use", label: "In use" },
      { id: "gone", label: "Gone" },
      { id: allFilter, label: "All" },
    ],
    defaultFilter: "in-use",
  },
  pets: {
    title: "Pets",
    description: "Your pets, with their care and their vet records.",
    empty: "Each pet gets a note here, with its care and its vet records. Ask Eva to add one.",
    searchLabel: "Search pets",
    filters: [],
    defaultFilter: allFilter,
  },
  periods: {
    title: "Periods",
    description: "The stretches of your life: jobs, studies, volunteer work and breaks.",
    empty: "A period is a job, a study, volunteer work or a sabbatical. Ask Eva to add one.",
    searchLabel: "Search periods",
    filters: [],
    defaultFilter: allFilter,
  },
};

// Reading the fields

/** A text value, or null for an empty or missing one. */
function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function mapOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A date of the front matter: a whole day, a month or a year. */
interface PartialDay {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
}

function dayOf(text: string | null): PartialDay | null {
  if (text === null) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  if (month !== null && day !== null) {
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  }
  return { year, month, day };
}

/** A key that sorts by time as text: a month or a year sorts at its start. */
function sortKey(day: PartialDay): string {
  const pad = (value: number | null): string => String(value ?? 1).padStart(2, "0");
  return `${String(day.year)}-${pad(day.month)}-${pad(day.day)}`;
}

function monthWords(day: PartialDay): string {
  return day.month === null ? String(day.year) : `${months[day.month - 1] ?? ""} ${String(day.year)}`;
}

/** "1 Jun 2026", "Sep 2024" or "2024", in the fixed English of the chat list. Any other text stays as written. */
export function dayWords(text: string): string {
  const day = dayOf(text.trim());
  if (day === null) return text;
  return day.day === null ? monthWords(day) : `${String(day.day)} ${monthWords(day)}`;
}

/** The tone of a pill: the state colours of `styles.css`, with `failed` for the `--bad` colour. */
export type LifeTone = "ok" | "warn" | "idle" | "live" | "failed";

export interface LifePill {
  readonly text: string;
  readonly tone: LifeTone;
}

/** A day to act by, with words that say its state, so the colour is never the only signal. */
export interface DayState {
  readonly raw: string;
  readonly text: string;
  readonly words: string;
  readonly tone: LifeTone;
  readonly overdue: boolean;
}

interface DayWording {
  readonly word: string;
  /** Up to this many days away, the day is near and takes the warn colour. */
  readonly soonDays: number;
  readonly past: (days: number) => string;
}

const dueWording: DayWording = { word: "Due", soonDays: 7, past: (days) => `Overdue by ${countOf(days, "day")}` };
const deadlineWording: DayWording = { word: "Deadline", soonDays: 14, past: () => "Deadline passed" };

/**
 * The state of a day at `now`. A missed day is a failure, so it takes the `--bad` colour. A month
 * or a year alone has no day to pass, so it only says when.
 */
function dayState(value: unknown, now: Date, wording: DayWording): DayState | null {
  const raw = textOf(value);
  if (raw === null) return null;
  const text = dayWords(raw);
  const day = dayOf(raw);
  if (day === null || !isWhole(day)) {
    return { raw, text, words: `${wording.word} ${text}`, tone: "idle", overdue: false };
  }
  const days = -daysBefore(new Date(day.year, (day.month ?? 1) - 1, day.day ?? 1), now);
  if (days < 0) return { raw, text, words: wording.past(-days), tone: "failed", overdue: true };
  const words =
    days === 0
      ? `${wording.word} today`
      : days === 1
        ? `${wording.word} tomorrow`
        : days <= wording.soonDays
          ? `${wording.word} in ${String(days)} days`
          : `${wording.word} ${text}`;
  return { raw, text, words, tone: days <= wording.soonDays ? "warn" : "idle", overdue: false };
}

// Links between entities

const lifeFolderKinds: Readonly<Record<string, LifeKind>> = {
  Cases: "cases",
  People: "people",
  Objects: "objects",
  Pets: "pets",
  Periods: "periods",
};

/**
 * A path of a Life entity in a text, such as `Life/People/Alex Example`. A name holds spaces, so it
 * ends at the end of the text, at a comma, a semicolon, a bracket, or a dot that ends a sentence.
 */
const lifePathPattern =
  /Life\/(Cases|People|Objects|Pets|Periods)\/([^,;()\n/]+?)(?:\/(?:[^,;()\n/]+\.md)?)?(?=$|[,;()\n]|\.(?:\s|$))/g;

/** The text with each path of a Life entity as a link to its page, named by its folder. */
export function lifeLinkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(lifePathPattern)) {
    const kind = lifeFolderKinds[match[1] ?? ""];
    const id = (match[2] ?? "").trim();
    if (kind === undefined || id === "") continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: id, href: lifeAddressOf(kind, id) });
    last = match.index + match[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last) });
  return parts;
}

/** The text with each path of a Life entity as its name, for a card, where a link cannot sit in the button. */
function namedText(text: string): string {
  return lifeLinkParts(text)
    .map((part) => part.text)
    .join("");
}

// Cases

export interface CaseStep {
  readonly text: string;
  readonly doneOn: string | null;
  readonly waitingFor: string | null;
  readonly due: DayState | null;
  readonly state: "done" | "current" | "todo";
}

/** The steps of a case. The current step is the first step without `done-on`. */
export function caseSteps(fields: LifeEntity["fields"], now: Date): CaseStep[] {
  const steps = fields["steps"];
  if (!Array.isArray(steps)) return [];
  let currentFound = false;
  return steps.flatMap((step): CaseStep[] => {
    const plain = textOf(step);
    const map = mapOf(step);
    if (plain === null && map === null) return [];
    const doneOn = textOf(map?.["done-on"]);
    const state = doneOn !== null ? "done" : currentFound ? "todo" : "current";
    if (state === "current") currentFound = true;
    return [
      {
        text: plain ?? textOf(map?.["step"]) ?? "A step",
        doneOn: doneOn === null ? null : dayWords(doneOn),
        waitingFor: textOf(map?.["waiting-for"]),
        due: dayState(map?.["due-by"], now, dueWording),
        state,
      },
    ];
  });
}

function isClosedCase(entity: LifeEntity): boolean {
  // An old vault may have a status key: only a date in `closed` ends a case.
  return textOf(entity.fields["closed"]) !== null;
}

interface CurrentStep {
  readonly text: string;
  readonly waitingFor: string | null;
  readonly due: DayState | null;
}

function currentStepOf(entity: LifeEntity, now: Date): CurrentStep | null {
  if (isClosedCase(entity)) return null;
  const { fields } = entity;
  if (!Array.isArray(fields["steps"])) {
    // An old-form case keeps its next step in `next`.
    const next = textOf(fields["next"]);
    return next === null
      ? null
      : {
          text: next,
          waitingFor: textOf(fields["waiting-for"]),
          due: dayState(fields["due-by"] ?? fields["due"], now, dueWording),
        };
  }
  const step = caseSteps(fields, now).find((each) => each.state === "current");
  return step === undefined ? null : { text: step.text, waitingFor: step.waitingFor, due: step.due };
}

function deadlineOf(value: unknown, now: Date): { readonly due: DayState | null; readonly cost: string | null } | null {
  const map = mapOf(value);
  // An older form writes the day alone.
  const due = dayState(map === null ? value : map["date"], now, deadlineWording);
  const cost = textOf(map?.["cost"]);
  return due === null && cost === null ? null : { due, cost };
}

// The card of each kind

export type LifeCardBody =
  | {
      readonly kind: "cases";
      readonly open: boolean;
      readonly closed: string | null;
      readonly progress: { readonly done: number; readonly total: number; readonly words: string } | null;
      readonly current: CurrentStep | null;
      readonly deadline: { readonly due: DayState | null; readonly cost: string | null } | null;
    }
  | {
      readonly kind: "people";
      readonly initials: string;
      readonly color: string;
      readonly relation: string | null;
      readonly contact: FactLink | null;
    }
  | {
      readonly kind: "objects";
      readonly type: string | null;
      readonly model: string | null;
      readonly ids: readonly string[];
      readonly pill: LifePill | null;
      /** Null when the person owns it. */
      readonly owner: string | null;
    }
  | {
      readonly kind: "pets";
      readonly initials: string;
      readonly color: string;
      readonly species: string | null;
      readonly breed: string | null;
      /** The age, or the years it lived. */
      readonly life: string | null;
      readonly died: boolean;
    }
  | {
      readonly kind: "periods";
      readonly type: string | null;
      readonly org: string | null;
      readonly role: string | null;
      readonly span: string | null;
      readonly length: string | null;
      readonly goesOn: boolean;
    };

export interface LifeCard {
  readonly title: string;
  readonly summary: string | null;
  readonly warnings: number;
  readonly body: LifeCardBody;
}

/** The pill beside the title of a card and of an entity page, or null when the state needs none. */
export function lifeCardPill(body: LifeCardBody): LifePill | null {
  switch (body.kind) {
    case "cases":
      return body.open ? null : { text: "Closed", tone: "idle" };
    case "objects":
      return body.pill;
    case "pets":
      return body.died ? { text: "Died", tone: "idle" } : null;
    case "periods":
      return body.goesOn ? { text: "Going on", tone: "live" } : null;
    case "people":
      return null;
  }
}

export function lifeCardOf(entity: LifeEntity, now: Date): LifeCard {
  return {
    title: entity.title,
    summary: entity.summary,
    warnings: entity.warnings.length,
    body: cardBodies[entity.kind](entity, now),
  };
}

const cardBodies: Readonly<Record<LifeKind, (entity: LifeEntity, now: Date) => LifeCardBody>> = {
  cases: (entity, now) => {
    const steps = caseSteps(entity.fields, now);
    const done = steps.filter((step) => step.state === "done").length;
    const closed = textOf(entity.fields["closed"]);
    return {
      kind: "cases",
      open: closed === null,
      closed: closed === null ? null : dayWords(closed),
      progress:
        steps.length === 0
          ? null
          : { done, total: steps.length, words: `${String(done)} of ${countOf(steps.length, "step")} done` },
      current: currentStepOf(entity, now),
      deadline: closed === null ? deadlineOf(entity.fields["deadline"], now) : null,
    };
  },
  people: (entity) => {
    const relation = textOf(entity.fields["relation"]);
    const contact = textOf(entity.fields["contact"]);
    return {
      kind: "people",
      initials: projectInitials(entity.title),
      color: projectColor(entity.id),
      relation: relation === null ? null : namedText(relation),
      contact: contact === null ? null : linkOf(contact),
    };
  },
  objects: (entity) => objectCard(entity),
  pets: (entity, now) => ({
    kind: "pets",
    initials: projectInitials(entity.title),
    color: projectColor(entity.id),
    species: wordOf(entity.fields["species"]),
    breed: textOf(entity.fields["breed"]),
    life: petLife(entity.fields, now),
    died: textOf(entity.fields["death"]) !== null,
  }),
  periods: (entity, now) => periodCard(entity, now),
};

/** A lower-case word of the front matter, such as `dog`, as a label. */
function wordOf(value: unknown): string | null {
  const text = textOf(value);
  return text === null ? null : capitalized(text);
}

// Objects

const objectStatusPills: Readonly<Record<string, LifePill>> = {
  // The accent of "In use", as on a project.
  "in-use": { text: "In use", tone: "live" },
  stored: { text: "Stored", tone: "idle" },
  // A lent thing waits to come back.
  lent: { text: "Lent", tone: "warn" },
  sold: { text: "Sold", tone: "idle" },
  gone: { text: "Gone", tone: "idle" },
};

const goneStatuses: ReadonlySet<string> = new Set(["sold", "gone"]);

function objectStatus(entity: LifeEntity): string | null {
  return textOf(entity.fields["status"])?.toLowerCase() ?? null;
}

/** Short forms of an ID key that read better in capitals. */
const idShortForms: ReadonlySet<string> = new Set(["vin", "imei", "mac", "id", "sn", "iban"]);

function idLabel(key: string): string {
  return idShortForms.has(key.toLowerCase()) ? key.toUpperCase() : capitalized(key);
}

function objectCard(entity: LifeEntity): LifeCardBody {
  // The folder is `Type - Model - ID`.
  const parts = entity.id.split(" - ").map((part) => part.trim());
  const named = parts.length > 1;
  const folderId = parts.length > 2 ? (parts.at(-1) ?? null) : null;
  const model = named ? parts.slice(1, parts.length > 2 ? -1 : undefined).join(" - ") : "";
  const ids = Object.entries(mapOf(entity.fields["ids"]) ?? {}).flatMap(([key, value]) => {
    const text = textOf(value);
    return text === null ? [] : [`${idLabel(key)} ${text}`];
  });
  const status = objectStatus(entity);
  const owner = textOf(entity.fields["owner"]);
  return {
    kind: "objects",
    type: wordOf(entity.fields["type"]) ?? (named ? (parts[0] ?? null) : null),
    model: model === "" ? null : model,
    ids: ids.length > 0 ? ids : folderId === null ? [] : [folderId],
    pill: status === null ? null : (objectStatusPills[status] ?? { text: status, tone: "idle" }),
    owner: owner === null ? null : namedText(owner),
  };
}

// Pets and periods: lengths of time

/** Whole months from one day to another. A missing month or day counts as the first. */
function monthsBetween(from: PartialDay, to: PartialDay): number {
  const months = (to.year - from.year) * 12 + ((to.month ?? 1) - (from.month ?? 1));
  return (to.day ?? 1) < (from.day ?? 1) ? months - 1 : months;
}

function todayOf(now: Date): PartialDay {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function isWhole(day: PartialDay): boolean {
  return day.month !== null && day.day !== null;
}

/** "6 years old", "5 months old", or "About 6 years old" when a date has only its year. */
function ageWords(from: PartialDay, to: PartialDay, lived: boolean): string | null {
  if (!isWhole(from) || !isWhole(to)) {
    const years = to.year - from.year;
    if (years < 0) return null;
    if (years === 0) return lived ? "Lived under a year" : `Born in ${String(from.year)}`;
    return lived ? `Lived about ${countOf(years, "year")}` : `About ${countOf(years, "year")} old`;
  }
  const total = monthsBetween(from, to);
  if (total < 0) return null;
  const span = total >= 12 ? countOf(Math.floor(total / 12), "year") : total > 0 ? countOf(total, "month") : null;
  if (lived) return `Lived ${span ?? "under a month"}`;
  return span === null ? "Under a month old" : `${span} old`;
}

function petLife(fields: LifeEntity["fields"], now: Date): string | null {
  const birth = dayOf(textOf(fields["birth"]));
  const deathText = textOf(fields["death"]);
  const death = dayOf(deathText);
  if (deathText !== null && birth === null) return `Died in ${death === null ? deathText : String(death.year)}`;
  if (birth === null) return null;
  return ageWords(birth, death ?? todayOf(now), deathText !== null);
}

/** "2 years 3 months", "1 year", "4 months" or "Under a month". */
function lengthWords(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const rest = totalMonths % 12;
  const parts = [years > 0 ? countOf(years, "year") : "", rest > 0 ? countOf(rest, "month") : ""].filter(
    (part) => part !== "",
  );
  return parts.length === 0 ? "Under a month" : parts.join(" ");
}

/** The day after the last day of a period, so a period that ends on 30 June counts June. */
function dayAfter(day: PartialDay): PartialDay {
  if (day.month === null) return { year: day.year + 1, month: 1, day: 1 };
  if (day.day === null)
    return day.month === 12 ? { year: day.year + 1, month: 1, day: 1 } : { ...day, month: day.month + 1, day: 1 };
  const next = new Date(day.year, day.month - 1, day.day + 1);
  return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
}

const endedStatuses: ReadonlySet<string> = new Set(["ended", "closed", "done", "finished", "past", "over"]);

interface PeriodDays {
  readonly from: PartialDay | null;
  readonly fromText: string | null;
  readonly to: PartialDay | null;
  readonly toText: string | null;
  readonly goesOn: boolean;
}

function periodDays(entity: LifeEntity, now: Date): PeriodDays {
  const { fields } = entity;
  // An old form names the keys `start` and `end`, and can say that it ended in `status`.
  const fromText = textOf(fields["from"]) ?? textOf(fields["start"]);
  const toText = textOf(fields["to"]) ?? textOf(fields["end"]);
  const to = dayOf(toText);
  const status = textOf(fields["status"])?.toLowerCase() ?? "";
  const goesOn =
    toText === null ? !endedStatuses.has(status) : to !== null && sortKey(dayAfter(to)) > sortKey(todayOf(now));
  return { from: dayOf(fromText), fromText, to, toText, goesOn };
}

function periodCard(entity: LifeEntity, now: Date): LifeCardBody {
  const { from, fromText, to, toText, goesOn } = periodDays(entity, now);
  const fromWords = fromText === null ? null : from === null ? fromText : monthWords(from);
  const toWords = toText === null ? null : to === null ? toText : monthWords(to);
  const span =
    fromWords === null
      ? toWords === null
        ? null
        : `Until ${toWords}`
      : toWords !== null
        ? `${fromWords} to ${toWords}`
        : goesOn
          ? `${fromWords} to now`
          : `From ${fromWords}`;
  const today = todayOf(now);
  // A period that goes on counts up to today, even when its last day is set.
  const end = goesOn
    ? toText === null || to === null
      ? today
      : sortKey(dayAfter(to)) > sortKey(today)
        ? today
        : dayAfter(to)
    : to === null
      ? null
      : dayAfter(to);
  const months = from === null || end === null ? null : monthsBetween(from, end);
  return {
    kind: "periods",
    type: wordOf(entity.fields["type"]) ?? wordOf(entity.fields["kind"]),
    org: textOf(entity.fields["org"]),
    role: textOf(entity.fields["role"]),
    span,
    length: months === null || months < 0 ? null : lengthWords(months),
    goesOn,
  };
}

// Filters, order, groups and counts

export function matchesLifeFilter(entity: LifeEntity, filter: string): boolean {
  if (filter === allFilter) return true;
  switch (entity.kind) {
    case "cases":
      return (filter === "closed") === isClosedCase(entity);
    case "objects": {
      const gone = goneStatuses.has(objectStatus(entity) ?? "");
      return (filter === "gone") === gone;
    }
    default:
      return true;
  }
}

/** Case and the spaces around the query do not count. A `#` before a tag is optional. */
export function matchesLifeSearch(entity: LifeEntity, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  const texts = [
    entity.title,
    ...entity.aliases,
    entity.summary ?? "",
    ...entity.tags.flatMap((tag) => [tag, `#${tag}`]),
  ];
  return texts.some((text) => text.toLowerCase().includes(wanted));
}

function byTitle(first: LifeEntity, second: LifeEntity): number {
  return first.title.localeCompare(second.title, undefined, { sensitivity: "base" });
}

/** The day of the current step of an open case, as a key that sorts by time. */
function caseDueKey(entity: LifeEntity, now: Date): string | null {
  const due = currentStepOf(entity, now)?.due;
  const day = dayOf(due?.raw ?? null);
  return day === null ? null : sortKey(day);
}

/** Text keys, newest or soonest as asked. A missing key goes last either way. */
function byKey(first: string | null, second: string | null, newestFirst: boolean): number {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return first < second !== newestFirst ? -1 : 1;
}

function sortedCases(entities: readonly LifeEntity[], now: Date): LifeEntity[] {
  const open = entities.filter((entity) => !isClosedCase(entity));
  const closed = entities.filter(isClosedCase);
  const closedKey = (entity: LifeEntity): string | null => {
    const day = dayOf(textOf(entity.fields["closed"]));
    return day === null ? null : sortKey(day);
  };
  return [
    ...open.sort(
      (first, second) => byKey(caseDueKey(first, now), caseDueKey(second, now), false) || byTitle(first, second),
    ),
    ...closed.sort((first, second) => byKey(closedKey(first), closedKey(second), true) || byTitle(first, second)),
  ];
}

export interface LifeGroup {
  /** Null for the one group of a list that has no groups. */
  readonly label: string | null;
  readonly entities: readonly LifeEntity[];
}

function oneGroup(entities: LifeEntity[]): LifeGroup[] {
  return entities.length === 0 ? [] : [{ label: null, entities }];
}

/** The entities that the filter keeps, in the order and the groups of their kind. */
export function lifeGroups(kind: LifeKind, entities: readonly LifeEntity[], filter: string, now: Date): LifeGroup[] {
  const kept = entities.filter((entity) => matchesLifeFilter(entity, filter));
  switch (kind) {
    case "cases": {
      const sorted = sortedCases(kept, now);
      if (filter !== allFilter) return oneGroup(sorted);
      return [
        { label: "Open", entities: sorted.filter((entity) => !isClosedCase(entity)) },
        { label: "Closed", entities: sorted.filter(isClosedCase) },
      ].filter((group) => group.entities.length > 0);
    }
    case "objects": {
      const types = new Map<string, LifeEntity[]>();
      for (const entity of [...kept].sort(byTitle)) {
        const card = objectCard(entity);
        const type = card.kind === "objects" ? (card.type ?? "") : "";
        types.set(type.toLowerCase(), [...(types.get(type.toLowerCase()) ?? []), entity]);
      }
      return [...types.entries()]
        .sort(([first], [second]) => byKey(first === "" ? null : first, second === "" ? null : second, false))
        .map(([type, list]) => ({ label: type === "" ? "Other" : capitalized(type), entities: list }));
    }
    case "periods": {
      const fromKey = (entity: LifeEntity): string | null => {
        const day = periodDays(entity, now).from;
        return day === null ? null : sortKey(day);
      };
      return oneGroup(
        [...kept].sort((first, second) => byKey(fromKey(first), fromKey(second), true) || byTitle(first, second)),
      );
    }
    default:
      return oneGroup([...kept].sort(byTitle));
  }
}

function pairWords(first: number, firstWord: string, second: number, secondWord: string): string {
  return `${String(first)} ${firstWord} · ${String(second)} ${secondWord}`;
}

/** The sub line of a list, such as "3 open · 1 closed". */
export function lifeCounts(kind: LifeKind, entities: readonly LifeEntity[], now: Date): string {
  const count = (test: (entity: LifeEntity) => boolean): number => entities.filter(test).length;
  switch (kind) {
    case "cases": {
      const closed = count(isClosedCase);
      return pairWords(entities.length - closed, "open", closed, "closed");
    }
    case "objects": {
      const gone = count((entity) => matchesLifeFilter(entity, "gone"));
      return pairWords(entities.length - gone, "in use", gone, "gone");
    }
    case "pets": {
      const died = count((entity) => textOf(entity.fields["death"]) !== null);
      return died === 0 ? countOf(entities.length, "pet") : pairWords(entities.length - died, "living", died, "died");
    }
    case "periods": {
      const going = count((entity) => periodDays(entity, now).goesOn);
      return pairWords(going, "going on", entities.length - going, "ended");
    }
    case "people":
      return `${String(entities.length)} ${entities.length === 1 ? "person" : "people"}`;
  }
}

// The entity page

/** The value with each path of a Life entity as a link to its page. */
function linkedValue(value: FactValue): FactValue {
  switch (value.kind) {
    case "text":
      return {
        kind: "text",
        parts: value.parts.flatMap((part) => (part.href === undefined ? lifeLinkParts(part.text) : [part])),
      };
    case "list":
      return { kind: "list", items: value.items.map(linkedValue) };
    case "map":
      return { kind: "map", facts: value.facts.map((fact) => ({ ...fact, value: linkedValue(fact.value) })) };
    default:
      return value;
  }
}

/** The facts of an entity page. The steps of a case have a list of their own. */
export function lifeFacts(entity: LifeEntity, format: FactFormat): Fact[] {
  const fields = Object.entries(entity.fields).filter(([key]) => !(entity.kind === "cases" && key === "steps"));
  return factsOf([...fields, ["aliases", entity.aliases], ["tags", entity.tags.map((tag) => `#${tag}`)]], format).map(
    (fact) => ({ ...fact, value: linkedValue(fact.value) }),
  );
}

/** The text of the main file without a first heading that repeats the title of the page. */
export function bodyWithoutTitle(body: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)\s*/.exec(body);
  return match?.[1] === title ? body.slice(match[0].length) : body;
}

// Addresses

export interface LifeRoute {
  readonly kind: LifeKind;
  readonly entityId: string | null;
}

/** The Life page that the address names: `#/<kind>`, or `#/<kind>/<id>` for one entity. */
export function lifeRouteOf(hash: string): LifeRoute | null {
  const match = /^#\/([^/]+)(?:\/(.*))?$/.exec(hash);
  const kind = match?.[1] ?? "";
  if (!isLifeKind(kind)) return null;
  const rest = match?.[2] ?? "";
  // An id is one folder name, so a longer path shows the list.
  if (rest === "" || rest.includes("/")) return { kind, entityId: null };
  try {
    return { kind, entityId: decodeURIComponent(rest) };
  } catch {
    // A hand-typed address with a bad `%` escape.
    return { kind, entityId: null };
  }
}

export function lifeAddressOf(kind: LifeKind, entityId?: string | null): string {
  return entityId === undefined || entityId === null ? `#/${kind}` : `#/${kind}/${encodeURIComponent(entityId)}`;
}
