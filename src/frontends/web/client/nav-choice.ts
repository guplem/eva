/**
 * The entries that the main navigation shows: one list for a computer and one for a phone (#911).
 * Each browser keeps its own choice in `localStorage`, as it keeps its appearance: a phone and a
 * computer need different lists. Each list keeps the person's order (#1034).
 */
import { currentLifeKindName } from "../../../shared/life-kinds.ts";
import { destinations, type NavEntry, type NavEntryId } from "./navigation.ts";

/** A narrow window of a computer is a phone here: the tab bar shows, with its short list. */
export type NavForm = "computer" | "phone";

export interface NavChoice {
  readonly computer: readonly NavEntryId[];
  readonly phone: readonly NavEntryId[];
}

/** The tab bar holds Eva's face and this many entries. More would make each tab too small for a thumb. */
export const maxPhoneEntries = 4;

export const navChoiceKey = "eva.navigation";

const everyEntry: readonly NavEntryId[] = destinations.map((destination) => destination.id);

/** The pages that a person opens most come first. Settings stays last: a computer shows it at the foot of the rail. */
const defaultOrder: readonly NavEntryId[] = [
  "chats",
  "files",
  "projects",
  "cases",
  ...everyEntry.filter((id) => !["chats", "files", "projects", "cases", "settings"].includes(id)),
  "settings",
];

export const defaultNavChoice: NavChoice = {
  computer: defaultOrder,
  phone: defaultOrder.slice(0, maxPhoneEntries),
};

/**
 * A computer always shows Settings, so the person can always change this choice. A phone has the
 * gear of the home page, so Eva's face is its only fixed entry.
 */
export function isFixedEntry(form: NavForm, id: NavEntryId): boolean {
  return form === "computer" && id === "settings";
}

/** Eva's face is not a destination, so `toggled` never sees it. The Settings card shows these words when the person presses it. */
export const faceFixedReason = "Eva's face always shows. It opens the home page.";

function isEntryId(id: unknown): id is NavEntryId {
  return typeof id === "string" && (everyEntry as readonly string[]).includes(id);
}

/** Keeps the known ids in their order, once each, with the rules of the form. A computer shows Settings last. */
function cleaned(form: NavForm, ids: readonly unknown[]): NavEntryId[] {
  // A choice stored before a page was renamed keeps the page (#940).
  const current = ids.map((id) => (typeof id === "string" ? currentLifeKindName(id) : id));
  const kept = [...new Set(current.filter(isEntryId))];
  if (form === "phone") return kept.slice(0, maxPhoneEntries);
  return [...kept.filter((id) => !isFixedEntry(form, id)), ...everyEntry.filter((id) => isFixedEntry(form, id))];
}

function formOf(form: NavForm, stored: unknown): NavEntryId[] {
  return Array.isArray(stored) ? cleaned(form, stored) : [...defaultNavChoice[form]];
}

/** A private window or blocked storage throws or holds nothing: the page then uses the defaults. */
export function readNavChoice(): NavChoice {
  return storedNavChoice() ?? defaultNavChoice;
}

/** Null when the browser keeps no choice, or cannot give it. */
function storedNavChoice(): NavChoice | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(navChoiceKey) ?? "null");
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
    const record = stored as Partial<Record<NavForm, unknown>>;
    return { computer: formOf("computer", record.computer), phone: formOf("phone", record.phone) };
  } catch {
    return null;
  }
}

export type NavToggle =
  { readonly ok: true; readonly choice: NavChoice } | { readonly ok: false; readonly reason: string };

/** Turns one entry of one form on or off. A refusal gives the words that the Settings card shows. */
export function toggled(choice: NavChoice, form: NavForm, id: NavEntryId): NavToggle {
  if (isFixedEntry(form, id)) {
    return { ok: false, reason: "A computer always shows Settings, so you can change this list again." };
  }
  const list = choice[form];
  if (list.includes(id)) return { ok: true, choice: { ...choice, [form]: list.filter((each) => each !== id) } };
  if (form === "phone" && list.length >= maxPhoneEntries) {
    return {
      ok: false,
      reason: `A phone shows at most ${String(maxPhoneEntries)} entries beside Eva's face. Turn one off first.`,
    };
  }
  return { ok: true, choice: { ...choice, [form]: cleaned(form, [...list, id]) } };
}

/**
 * Moves an entry that is on one place up (-1) or down (1). Null when it cannot move: it is off, it is at an end,
 * or Settings would leave the foot of a computer's rail.
 */
export function moved(choice: NavChoice, form: NavForm, id: NavEntryId, step: -1 | 1): NavChoice | null {
  const list = [...choice[form]];
  const from = list.indexOf(id);
  const to = from + step;
  const other = list[to];
  if (from < 0 || other === undefined || isFixedEntry(form, id) || isFixedEntry(form, other)) return null;
  list[to] = id;
  list[from] = other;
  return { ...choice, [form]: list };
}

/** The rows of the Settings card: the entries that are on, in their order, then the others in the default order. */
export function rowOrder(choice: NavChoice, form: NavForm): NavEntryId[] {
  const list = choice[form];
  const fixed = everyEntry.filter((id) => isFixedEntry(form, id));
  const off = defaultOrder.filter((id) => !list.includes(id));
  return [...list, ...off].filter((id) => !fixed.includes(id)).concat(fixed);
}

/** The entries to draw, in the person's order. */
export function shownDestinations(choice: NavChoice, isPhone: boolean): NavEntry[] {
  return choice[isPhone ? "phone" : "computer"].flatMap((id) =>
    destinations.filter((destination) => destination.id === id),
  );
}

/**
 * The pages of the ☰ menu of a phone's home page (#1037): every page, so a page that the tab bar hides still opens.
 * The tabs come first, in the person's order, then the other pages in the default order.
 */
export function menuDestinations(choice: NavChoice): NavEntry[] {
  return rowOrder(choice, "phone").flatMap((id) => destinations.filter((destination) => destination.id === id));
}

/**
 * The buttons of the part that scrolls, and of the foot. A computer keeps Settings at the foot of the rail, so a low
 * window still shows it (#911). A phone has no foot: Settings takes the place that the person chose (#1034).
 */
export function navParts(choice: NavChoice, isPhone: boolean): { scroll: NavEntry[]; foot: NavEntry[] } {
  const shown = shownDestinations(choice, isPhone);
  if (isPhone) return { scroll: shown, foot: [] };
  const form: NavForm = "computer";
  return {
    scroll: shown.filter((destination) => !isFixedEntry(form, destination.id)),
    foot: shown.filter((destination) => isFixedEntry(form, destination.id)),
  };
}

let current: NavChoice | null = null;
const listeners = new Set<() => void>();

/** The choice of this browser. It reads the storage once, then follows each save. */
export function navChoice(): NavChoice {
  current ??= readNavChoice();
  return current;
}

function tellListeners(): void {
  for (const listener of listeners) listener();
}

/** Another tab of this browser saved a choice: this tab reads it again, so a later save here does not undo it. */
function onStorage(event: { readonly key: string | null }): void {
  // A null key means that the whole storage was cleared.
  if (event.key !== navChoiceKey && event.key !== null) return;
  current = readNavChoice();
  tellListeners();
}

/**
 * Calls the listener after each save, in this tab or in another tab, so the main navigation draws the new list at once.
 * Returns the unsubscribe.
 */
export function onNavChoiceChange(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function sameList(a: readonly NavEntryId[], b: readonly NavEntryId[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

/**
 * Keeps only the forms that this tab changed, over the stored choice. The tab's own copy can be old: another tab may
 * have saved the other form meanwhile.
 */
export function saveNavChoice(choice: NavChoice): void {
  const known = navChoice();
  // Without a stored choice, this tab's copy is the best one.
  const stored = storedNavChoice() ?? known;
  const merged: NavChoice = {
    computer: sameList(choice.computer, known.computer) ? stored.computer : choice.computer,
    phone: sameList(choice.phone, known.phone) ? stored.phone : choice.phone,
  };
  current = merged;
  try {
    localStorage.setItem(navChoiceKey, JSON.stringify(merged));
  } catch {
    // The choice still applies until the page reloads.
  }
  tellListeners();
}
