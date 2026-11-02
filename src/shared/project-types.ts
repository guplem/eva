/**
 * The types of a project, from the `type` key of its `AGENTS.md` (#703, #768). They are stored names.
 * The web page reads them too, so this file holds data only.
 *
 * - `general`: a folder of notes and files, such as building a house. Its chats start in the folder.
 * - `software`: work in repositories. Each chat runs in a clone.
 * - `specialist`: a chat with its own rules and memory in the folder, such as a gym coach.
 */
export const projectTypes = ["general", "software", "specialist"] as const;
export type ProjectType = (typeof projectTypes)[number];

/** True when the chats of the project run in clones. The others start in the project folder, in the vault. */
export function worksInClones(type: ProjectType): boolean {
  return type === "software";
}

/** "a general project" or "a specialist", for the texts that say why a project gets no clone. */
export function projectTypeNoun(type: ProjectType, sentenceStart = false): string {
  const noun = type === "specialist" ? "a specialist" : `a ${type} project`;
  return sentenceStart ? `A${noun.slice(1)}` : noun;
}
