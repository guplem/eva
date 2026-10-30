/**
 * The files that the person gives to a chat in a clone (#706): a vault file that a message
 * mentions, or a file that the person attaches. Each one goes into `clone-<n>/.mentions/`, outside
 * every repository, so git never sees it. The chat gets the copy's name and never a vault path,
 * so it does not learn that it runs inside a vault (#702).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { mentionsIn, mentionToken } from "../../shared/mentions.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { contentName, resolveSendableFile } from "../files/vault-files.ts";

/** The folder of a clone that holds the copies. A dot name, so no tool takes it for a repository. */
export const mentionsFolderName = ".mentions";

/** The largest copy: the same limit as a file that the person attaches in the web app. */
const maxCopyBytes = 25 * 1024 * 1024;

/**
 * Saves bytes into the clone's mention folder, named by their content, and gives the path from the
 * clone folder. The same bytes get the same name, so a second save adds nothing. A failed write
 * names only the file, since a system error holds the whole path, which the chat must not see.
 */
export function saveInClone(clonePath: string, originalName: string, bytes: Uint8Array): string {
  const name = contentName(originalName, bytes);
  const folder = join(clonePath, mentionsFolderName);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), bytes);
  } catch {
    throw new EvaError("file_not_writable", `Eva could not save ${basename(originalName)} for the chat.`);
  }
  return `${mentionsFolderName}/${name}`;
}

/**
 * The real path of a mentioned vault file, with the checks of a file that Eva sends in Telegram:
 * no path out of the vault, no clone and no git data, no secrets file by name or by contents. The
 * checks run on the resolved path, so `..`, `./` and links cannot reach a clone.
 */
function checkedMention(vaultPath: string, requested: string): { readonly path: string; readonly name: string } {
  let found: ReturnType<typeof resolveSendableFile>;
  let size: number;
  try {
    found = resolveSendableFile(vaultPath, requested);
    size = found.ok ? statSync(found.path).size : 0;
  } catch {
    // A system error, such as a file that went away during the check, holds the whole path.
    throw new EvaError("file_not_downloadable", `Eva could not read ${basename(requested)}.`);
  }
  if (!found.ok) throw new EvaError(found.missing === true ? "file_not_found" : "file_not_downloadable", found.reason);
  if (size > maxCopyBytes)
    throw new EvaError("file_not_downloadable", `${requested} is larger than 25 MB, so Eva does not share it.`);
  return found;
}

/**
 * Copies the files that a chat was given into another clone, so a fork there can still read them.
 * The names come from the content, so a file that is there already stays the same.
 */
export function copyGivenFiles(fromClone: string, toClone: string): void {
  const from = join(fromClone, mentionsFolderName);
  if (existsSync(from)) cpSync(from, join(toClone, mentionsFolderName), { recursive: true });
}

/**
 * A text with the base name in each file mention, for text that leaves the turn, such as a
 * summary that a new chat starts from. The new chat must not learn a vault folder either.
 */
export function withBaseNames(text: string): string {
  let result = "";
  let from = 0;
  for (const mention of mentionsIn(text)) {
    if (mention.kind !== "file") continue;
    result += text.slice(from, mention.start) + mentionToken("file", basename(mention.name));
    from = mention.start + mention.token.length;
  }
  return result + text.slice(from);
}

/** Copies a vault file into the clone, and gives the copy's path from the clone folder. */
export function copyVaultFileToClone(vaultPath: string, clonePath: string, vaultRelative: string): string {
  const { path, name } = checkedMention(vaultPath, vaultRelative);
  const bytes = readFileSync(path);
  // The scan reads exactly the bytes that go into the clone: the check above scans 2 MB at most,
  // and the file can change between the check and the read.
  if (containsSecretPattern(bytes.toString("utf8")))
    throw new EvaError("file_not_downloadable", `${vaultRelative} holds a secret, so Eva does not share it.`);
  return saveInClone(clonePath, name, bytes);
}

/**
 * Throws the first problem of a file that a text mentions, so the message is not sent (#706). It
 * checks the files and copies none: the turn copies them.
 */
export function checkMentions(vaultPath: string, text: string): void {
  for (const mention of mentionsIn(text)) if (mention.kind === "file") checkedMention(vaultPath, mention.name);
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
      notes.set(mention.token, `[${token} is the file ${copy}]`);
    } catch (error) {
      token = mentionToken("file", basename(mention.name));
      notes.set(
        mention.token,
        `[${token}: Eva could not give this file to the chat. ${shownReason(error, mention.name)}]`,
      );
    }
    result += text.slice(from, mention.start) + token;
    from = mention.start + mention.token.length;
  }
  if (notes.size === 0) return text;
  return `${result}${text.slice(from)}\n\n${[...notes.values()].join("\n")}`;
}

/**
 * Why a file could not be copied, with no vault path. Each check names the path as the person typed
 * it, so the base name takes its place. A system error holds a whole path, so it gets its own text.
 */
function shownReason(error: unknown, vaultRelative: string): string {
  if (!isEvaError(error)) return `Eva could not read ${basename(vaultRelative)}.`;
  return error.message.replaceAll(vaultRelative, basename(vaultRelative));
}
