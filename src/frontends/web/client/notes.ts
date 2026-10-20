/**
 * A note in the sticky notice of Settings. A note that asks for a step carries that step as data,
 * so the notice shows a button that does it in one tap, and never reads the words of the note.
 */
export type NoteAction = "restart";

export type Note = string | { readonly text: string; readonly action: NoteAction };

export const noteActionLabels: Readonly<Record<NoteAction, string>> = {
  restart: "Restart Eva",
};

/** A note that asks the person to restart Eva. */
export function restartNote(text: string): Note {
  return { text, action: "restart" };
}

export function noteParts(note: Note): { readonly text: string; readonly action: NoteAction | null } {
  return typeof note === "string" ? { text: note, action: null } : note;
}
