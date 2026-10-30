/**
 * The files that the person gives to a chat in a clone (#706): a vault file that a message
 * mentions, or a file that the person attaches. Each one goes into `clone-<n>/.mentions/`, outside
 * every repository, so git never sees it. The chat gets the copy's name and never a vault path,
 * so it does not learn that it runs inside a vault (#702).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { mentionsIn, mentionToken } from "../../shared/mentions.ts";
import { readVaultFile } from "../files/file-download.ts";
import { contentName } from "../files/vault-files.ts";

/** The folder of a clone that holds the copies. A dot name, so no tool takes it for a repository. */
export const mentionsFolderName = ".mentions";

/** A path under a project's clones: another chat's work, which a mention must not reach. */
const clonePathPattern = /^Projects\/[^/]+\/repos(\/|$)/i;

/**
 * Saves bytes into the clone's mention folder, named by their content, and gives the path from the
 * clone folder. The same bytes get the same name, so a second save adds nothing.
 */
export function saveInClone(clonePath: string, originalName: string, bytes: Uint8Array): string {
  const name = contentName(originalName, bytes);
  const folder = join(clonePath, mentionsFolderName);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), bytes);
  return `${mentionsFolderName}/${name}`;
}

/** Reads a mentioned vault file, with every check of a download and the clone rule. */
function readMentioned(vaultPath: string, vaultRelative: string): { name: string; bytes: Uint8Array } {
  if (clonePathPattern.test(vaultRelative.replaceAll("\\", "/").replace(/^\/+/, ""))) {
    throw new EvaError(
      "file_not_downloadable",
      `${basename(vaultRelative)} belongs to a clone, so Eva does not share it.`,
    );
  }
  return readVaultFile(vaultPath, vaultRelative);
}

/** Copies a vault file into the clone, and gives the copy's path from the clone folder. */
export function copyVaultFileToClone(vaultPath: string, clonePath: string, vaultRelative: string): string {
  const { name, bytes } = readMentioned(vaultPath, vaultRelative);
  return saveInClone(clonePath, name, bytes);
}

/** Throws the first problem of a file that a text mentions, so the message is not sent (#706). */
export function checkMentions(vaultPath: string, text: string): void {
  for (const mention of mentionsIn(text)) if (mention.kind === "file") readMentioned(vaultPath, mention.name);
}

/**
 * The text that a chat in a clone gets: each file mention names the copy, with one note for each.
 * A file that cannot be copied keeps only its base name, with a note that says why. A project
 * mention gets no note, since its note would name a vault folder.
 */
export function withCloneMentions(text: string, vaultPath: string, clonePath: string): string {
  let result = "";
  let from = 0;
  const notes = new Map<string, string>();
  for (const mention of mentionsIn(text)) {
    if (mention.kind !== "file") continue;
    let token: string;
    try {
      const copy = copyVaultFileToClone(vaultPath, clonePath, mention.name);
      token = mentionToken("file", basename(copy));
      notes.set(token, `[${token} is the file ${copy}]`);
    } catch (error) {
      if (!isEvaError(error)) throw error;
      token = mentionToken("file", basename(mention.name));
      notes.set(token, `[${token}: Eva could not give this file to the chat. ${shownReason(error, mention.name)}]`);
    }
    result += text.slice(from, mention.start) + token;
    from = mention.start + mention.token.length;
  }
  if (notes.size === 0) return text;
  return `${result}${text.slice(from)}\n\n${[...notes.values()].join("\n")}`;
}

/**
 * Why a file could not be copied, with no vault path. The path check names the whole path, so a
 * missing file gets its own text. The other refusals name only the base name.
 */
function shownReason(error: EvaError, vaultRelative: string): string {
  return error.code === "file_not_found" ? `${basename(vaultRelative)} was not found.` : error.message;
}
