/**
 * The widget's own small state (contract 3, #1010): `eva/state.json`. A widget keeps a choice of
 * the person there, such as the calendars that are off, and every device shows the same, because
 * the state lives in the vault. Each widget has its own file, `.eva/widget-state/<owner>/<name>.json`,
 * apart from `.eva/widgets.json`: a state write then never touches the list or the layout, so two
 * devices conflict less. No permission guards it: it is the widget's own data.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

export const statePath = "eva/state.json";

/** The largest state: a few choices of the person, never data. */
export const maxStateBytes = 64 * 1024;

const stateFolder = [".eva", "widget-state"] as const;

/** A lower-case id of `widget-address.ts`: GitHub's owner rules, and a name that is not `.` or `..`. */
const idPattern = /^([a-z0-9][a-z0-9-]{0,38})\/((?!\.{1,2}$)[\w.-]{1,100})$/;

/** The state file of a widget, or null for an id that is not a plain owner and name. */
export function widgetStateFile(vaultPath: string, id: string): string | null {
  const match = idPattern.exec(id);
  if (match === null) return null;
  const [, owner = "", name = ""] = match;
  return join(vaultPath, ...stateFolder, owner, `${name}.json`);
}

export interface StatePathOptions {
  readonly vaultPath: string;
  /** The widget's id: its state is apart from every other widget's. */
  readonly id: string;
  readonly method: string;
  readonly body: Uint8Array | null;
  /** Runs a write between two sync steps of the vault. */
  readonly exclusive: <Result>(work: () => Result) => Promise<Result>;
  readonly redact: (text: string) => string;
}

/** The answer of `eva/state.json`: the saved object, or `{}`, and a `PUT` that replaces it. */
export async function answerStatePath(options: StatePathOptions): Promise<WidgetAnswer> {
  const file = widgetStateFile(options.vaultPath, options.id);
  if (file === null) return { status: 404 };
  if (options.method === "GET" || options.method === "HEAD") return jsonAnswer(readState(file));
  if (options.method !== "PUT") return { status: 405 };
  const body = options.body;
  if (body === null) return { status: 400 };
  if (body.byteLength > maxStateBytes) return { status: 413 };
  const text = new TextDecoder().decode(body);
  const value = parseObject(text);
  if (value === null) return { status: 400 };
  // The vault sync would push it, and a secret never goes in the vault.
  if (options.redact(text) !== text) return { status: 422 };
  return options.exclusive(() => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
    return { status: 204 };
  });
}

/** Deletes a widget's state, and the folder of its owner when nothing else is in it. */
export function removeWidgetState(vaultPath: string, id: string): void {
  const file = widgetStateFile(vaultPath, id);
  if (file === null) return;
  rmSync(file, { force: true });
  const folder = dirname(file);
  if (existsSync(folder) && readdirSync(folder).length === 0) rmSync(folder, { recursive: true, force: true });
}

/** The saved state. A missing or broken file, or a value that is not an object, reads as `{}`. */
function readState(file: string): Record<string, unknown> {
  const read = readJsonTolerant(file);
  return read.ok && isObject(read.value) ? read.value : {};
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
