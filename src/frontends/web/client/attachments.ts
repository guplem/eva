/** The files that the person attaches to a message in the web chat. */

/** The message that the agent gets: the person's text, then one note for each attached file. */
export function messageWithFiles(text: string, notes: readonly string[]): string {
  return [text.trim(), notes.join("\n")].filter((part) => part !== "").join("\n\n");
}
