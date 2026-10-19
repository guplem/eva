/**
 * Which Eva a command acts on. Each Eva on this computer has a name, and her home is
 * `eva-<name>`. `--instance` or EVA_INSTANCE names her. Without a name, a command uses the only
 * Eva; with more than one, a person picks one and a script must name one.
 */
import {
  firstInstanceName,
  homePaths,
  instanceHome,
  instanceNameProblem,
  instancesFolder,
  instanceVariable,
  listInstances,
  type HomePaths,
} from "../../core/settings/home.ts";
import { EvaError } from "../../shared/errors.ts";
import { writeLine, type CliHost } from "./host.ts";

/** A closed or broken terminal answers "" for ever, so the questions stop after this many. */
const maxAttempts = 5;
const nameOption = "Name one with --instance or EVA_INSTANCE";

export interface InstanceChoice {
  /** The `--instance` option. */
  readonly name: string | undefined;
  /** True for `eva setup`, which may make a new Eva. */
  readonly creates: boolean;
  /** True when a person can answer a question. */
  readonly interactive: boolean;
}

export async function chooseInstance(host: CliHost, choice: InstanceChoice): Promise<HomePaths> {
  const folder = instancesFolder(host);
  const existing = listInstances(folder);
  const home = (name: string): HomePaths => homePaths(instanceHome(folder, name));
  const fromEnvironment = host.environment[instanceVariable];
  const named = choice.name ?? (fromEnvironment === "" ? undefined : fromEnvironment);
  if (named !== undefined) return home(checkedName(named, existing, choice.creates));
  if (choice.creates) return home(await nameForSetup(host, existing, choice.interactive));
  const [only] = existing;
  if (only === undefined) throw refusal("No Eva is set up on this computer yet. Run `eva setup`.");
  if (existing.length === 1) return home(only);
  if (!choice.interactive)
    throw refusal(
      `This computer has more than one Eva: ${existing.join(", ")}. ${nameOption}, such as \`eva --instance ${only} status\`.`,
    );
  return home(await pick(host, existing));
}

function checkedName(name: string, existing: readonly string[], creates: boolean): string {
  const problem = instanceNameProblem(name);
  if (problem !== null) throw refusal(problem);
  if (creates || existing.includes(name)) return name;
  const others = existing.length === 0 ? "" : ` The Evas here: ${existing.join(", ")}.`;
  throw refusal(`No Eva named ${name} on this computer.${others} To make her, run \`eva --instance ${name} setup\`.`);
}

/** Setup asks for the name of a new Eva, or which Eva to set up again. */
async function nameForSetup(host: CliHost, existing: readonly string[], interactive: boolean): Promise<string> {
  const [only] = existing;
  if (!interactive) {
    if (only === undefined) return firstInstanceName;
    if (existing.length === 1) return only;
    throw refusal(`This computer has more than one Eva: ${existing.join(", ")}. ${nameOption}.`);
  }
  if (only === undefined)
    return ask(host, `Name of this Eva, such as your first name [${firstInstanceName}]: `, (answer) =>
      answer === "" ? firstInstanceName : newName(host, answer),
    );
  writeList(host, existing);
  return ask(host, "Type a number to set up that Eva again, or a new name to make a new Eva: ", (answer) =>
    answer === "" ? null : (fromList(answer, existing) ?? newName(host, answer)),
  );
}

async function pick(host: CliHost, existing: readonly string[]): Promise<string> {
  writeList(host, existing);
  return ask(host, "Which Eva? Type a number or a name: ", (answer) => fromList(answer, existing));
}

function writeList(host: CliHost, existing: readonly string[]): void {
  writeLine(host, "The Evas on this computer:");
  existing.forEach((name, index) => {
    writeLine(host, `  ${String(index + 1)}. ${name}`);
  });
}

/** The name for a number or a name in the list, or null. */
function fromList(answer: string, existing: readonly string[]): string | null {
  if (/^\d+$/.test(answer)) return existing[Number(answer) - 1] ?? null;
  return existing.includes(answer) ? answer : null;
}

/** A good new name, or null after it says what is wrong. */
function newName(host: CliHost, answer: string): string | null {
  const problem = instanceNameProblem(answer);
  if (problem === null) return answer;
  writeLine(host, problem);
  return null;
}

/** Asks until `read` gives a name. */
async function ask(host: CliHost, question: string, read: (answer: string) => string | null): Promise<string> {
  const chosen: { name: string | null } = { name: null };
  await host.withPrompt(async (prompt) => {
    for (let attempt = 0; attempt < maxAttempts && chosen.name === null; attempt += 1) {
      chosen.name = read((await prompt(question)).trim());
    }
  });
  if (chosen.name === null) throw refusal(`No Eva was chosen. ${nameOption}.`);
  return chosen.name;
}

function refusal(message: string): EvaError {
  return new EvaError("config_invalid", message);
}
