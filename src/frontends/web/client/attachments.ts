/** The files that the person attaches to a message in the web chat. */

/** The message that the agent gets: the person's text, then one note for each attached file. */
export function messageWithFiles(text: string, notes: readonly string[]): string {
  return [text.trim(), notes.join("\n")].filter((part) => part !== "").join("\n\n");
}

/** The parts of a paste that tell which files it holds. A `DataTransfer` fits. */
export interface PastedData {
  readonly types: readonly string[];
  readonly files: ArrayLike<File>;
}

/**
 * The files to attach from a paste, such as a screenshot. A paste with text gives none:
 * an office program also puts a picture of the copied text on the clipboard.
 */
export function pastedFiles(pasted: PastedData): File[] {
  return pasted.types.includes("text/plain") ? [] : Array.from(pasted.files);
}
