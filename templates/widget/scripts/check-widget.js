// Checks this widget against the widget contract: eva-widget.json against the manifest schema, each
// data schema against the meta-schema (the naming rules), and the mock files against their schemas.
// Eva runs the same schema files when a person turns the widget on.
//
// The schema files come from Eva's repository, by their stable address for the contract version.
// EVA_CONTRACT_DIR names a local folder with them instead, as Eva's own CI does.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contractAddress = "https://raw.githubusercontent.com/guplem/eva/main/docs/widgets";

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parse(text, path, problems) {
  try {
    return JSON.parse(text);
  } catch {
    problems.push(`${path} is not valid JSON.`);
    return undefined;
  }
}

async function contractFile(name) {
  const folder = process.env.EVA_CONTRACT_DIR;
  if (folder !== undefined && folder !== "") return JSON.parse(await readFile(join(folder, name), "utf8"));
  const response = await fetch(`${contractAddress}/${name}`);
  if (!response.ok) throw new Error(`Could not read ${name} of the widget contract (HTTP ${String(response.status)}).`);
  return response.json();
}

/** A glob of file names as a regular expression: `*` is any text and `?` one character, never a slash. */
function globPattern(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${body}$`);
}

function where(error) {
  return error.instancePath === "" ? "the root" : error.instancePath;
}

/** The problems of a data schema, with the name of each field that breaks the naming rules. */
function schemaProblems(path, errors) {
  const problems = errors.flatMap((error) => {
    const closing = /\/(?:additionalProperties|unevaluatedProperties)$/;
    if (error.keyword === "not" && error.data === false && closing.test(error.instancePath)) {
      const place = error.instancePath.replace(closing, "") || "the root";
      return [
        `${path}: ${place} closes the object (additionalProperties: false), so another widget cannot add its fields.`,
      ];
    }
    const name =
      error.propertyName ??
      (/\/required\/\d+$/.test(error.instancePath) && typeof error.data === "string" ? error.data : undefined);
    if (name !== undefined && (error.keyword === "pattern" || error.keyword === "not")) {
      return [
        `${path}: the field name "${name}" breaks the naming rules (camelCase, full English words, no abbreviation).`,
      ];
    }
    if (error.keyword === "propertyNames") return [];
    return [`${path}: ${where(error)} ${error.message ?? "is not valid"}.`];
  });
  return [...new Set(problems)];
}

/** Every problem of the widget in this folder. Empty when the widget follows the contract. */
export async function checkWidget(folder) {
  const problems = [];
  const manifestText = await readText(join(folder, "eva-widget.json"));
  if (manifestText === null) return ["eva-widget.json is missing."];
  const manifest = parse(manifestText, "eva-widget.json", problems);
  if (manifest === undefined) return problems;
  if (!Number.isInteger(manifest?.contract)) return ["eva-widget.json has no contract number."];

  const contract = manifest.contract;
  const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false });
  const validateManifest = ajv.compile(await contractFile(`manifest-v${String(contract)}.json`));
  const validateSchema = ajv.compile(await contractFile(`meta-schema-v${String(contract)}.json`));
  if (!validateManifest(manifest)) {
    return (validateManifest.errors ?? [])
      .filter((error) => error.keyword !== "if")
      .map((error) =>
        error.keyword === "additionalProperties"
          ? `eva-widget.json: ${where(error)} has the unknown key "${String(error.params.additionalProperty)}".`
          : `eva-widget.json: ${where(error)} ${error.message ?? "is not valid"}.`,
      );
  }

  const config = parse((await readText(join(folder, "config.json"))) ?? "null", "config.json", problems);
  const inputs = manifest.inputs ?? [];
  if (typeof config !== "object" || config === null) problems.push("config.json must hold an object.");
  for (const key of Object.keys(config ?? {})) {
    if (!inputs.some((input) => input.id === key)) problems.push(`config.json: "${key}" is not an input.`);
  }

  for (const input of inputs) {
    if (input.schema === undefined) continue;
    const schemaText = await readText(join(folder, input.schema));
    if (schemaText === null) {
      problems.push(`${input.schema} is missing. The input ${input.id} names it.`);
      continue;
    }
    const schema = parse(schemaText, input.schema, problems);
    if (schema === undefined) continue;
    if (!validateSchema(schema)) {
      problems.push(...schemaProblems(input.schema, validateSchema.errors ?? []));
      continue;
    }
    // A strict validator refuses an unknown keyword or type, as Eva's does.
    const strict = new Ajv2020({ strict: true, allErrors: true });
    addFormats(strict);
    let validateData;
    try {
      validateData = strict.compile(schema);
    } catch (error) {
      problems.push(`${input.schema} is not a valid JSON Schema: ${error.message}`);
      continue;
    }
    if (input.type === "folder") problems.push(...(await checkMockFolder(folder, input, validateData)));
  }
  return problems;
}

/** The mock folder of an input: its index.json lists its files, and each file passes the schema. */
async function checkMockFolder(folder, input, validateData) {
  const problems = [];
  const base = `data/${input.id}`;
  const present = (await readdir(join(folder, base)).catch(() => [])).filter((name) => name !== "index.json");
  const indexText = await readText(join(folder, base, "index.json"));
  if (indexText === null) return [`${base}/index.json is missing. It lists the mock files of the input ${input.id}.`];
  const listed = parse(indexText, `${base}/index.json`, problems);
  if (!Array.isArray(listed)) return [...problems, `${base}/index.json must hold an array of file names.`];
  const pattern = globPattern(input.files);
  for (const name of listed) {
    if (!present.includes(name)) problems.push(`${base}/index.json lists ${String(name)}, which does not exist.`);
  }
  for (const name of present) {
    if (!listed.includes(name)) problems.push(`${base}/index.json does not list ${name}.`);
    if (!pattern.test(name)) problems.push(`${base}/${name} does not match the files pattern ${input.files}.`);
    if (!name.endsWith(".json")) continue;
    const data = parse((await readText(join(folder, base, name))) ?? "", `${base}/${name}`, problems);
    if (data !== undefined && !validateData(data)) {
      for (const error of validateData.errors ?? [])
        problems.push(`${base}/${name}: ${where(error)} ${error.message}.`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = fileURLToPath(new URL("..", import.meta.url));
  const problems = await checkWidget(folder);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write("The widget follows the widget contract.\n");
}
