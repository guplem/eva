/**
 * The entries that the main navigation shows: one list for a computer and one for a phone (#911).
 * Each browser keeps its own choice in `localStorage`, as it keeps its appearance: a phone and a
 * computer need different lists. The order of the entries is fixed.
 */
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

export const defaultNavChoice: NavChoice = {
  computer: everyEntry,
  phone: ["chats", "projects", "files", "schedules"],
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

/** Keeps the known ids in the fixed order, once each, with the rules of the form. */
function cleaned(form: NavForm, ids: readonly unknown[]): NavEntryId[] {
  const kept = everyEntry.filter((id) => ids.includes(id) || isFixedEntry(form, id));
  return form === "phone" ? kept.slice(0, maxPhoneEntries) : kept;
}

function formOf(form: NavForm, stored: unknown): NavEntryId[] {
  return Array.isArray(stored) ? cleaned(form, stored) : [...defaultNavChoice[form]];
}

/** A private window or blocked storage throws or holds nothing: the page then uses the defaults. */
export function readNavChoice(): NavChoice {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(navChoiceKey) ?? "null");
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return defaultNavChoice;
    const record = stored as Partial<Record<NavForm, unknown>>;
    return { computer: formOf("computer", record.computer), phone: formOf("phone", record.phone) };
  } catch {
    return defaultNavChoice;
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

/** The entries to draw, in the fixed order. */
export function shownDestinations(choice: NavChoice, isPhone: boolean): NavEntry[] {
  const list = choice[isPhone ? "phone" : "computer"];
  return destinations.filter((destination) => list.includes(destination.id));
}

let current: NavChoice | null = null;
const listeners = new Set<() => void>();

/** The choice of this browser. It reads the storage once, then follows each save. */
export function navChoice(): NavChoice {
  current ??= readNavChoice();
  return current;
}

/** Calls the listener after each save, so the main navigation draws the new list at once. Returns the unsubscribe. */
export function onNavChoiceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveNavChoice(choice: NavChoice): void {
  current = choice;
  try {
    localStorage.setItem(navChoiceKey, JSON.stringify(choice));
  } catch {
    // The choice still applies until the page reloads.
  }
  for (const listener of listeners) listener();
}
