/**
 * The widget contract of `docs/widgets.md` (#688): it checks a widget's `eva-widget.json` and the
 * JSON Schemas of its data with the same schema files that a widget's CI uses. Eva carries the
 * files in her code, so a check needs no network.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import manifestV1Text from "../../../docs/widgets/manifest-v1.json" with { type: "text" };
import manifestV2Text from "../../../docs/widgets/manifest-v2.json" with { type: "text" };
import manifestV3Text from "../../../docs/widgets/manifest-v3.json" with { type: "text" };
import manifestV4Text from "../../../docs/widgets/manifest-v4.json" with { type: "text" };
import manifestV5Text from "../../../docs/widgets/manifest-v5.json" with { type: "text" };
// Contracts 2 to 5 keep the data rules of contract 1 (a test pins it), so one meta-schema checks all.
import metaSchemaText from "../../../docs/widgets/meta-schema-v5.json" with { type: "text" };
// TypeScript types a JSON import as its value, but Bun gives a text import as a string.
import type { WidgetAskType, WidgetInputType, WidgetSize } from "./widget-kinds.ts";

/** The manifest schema of each contract that Eva reads. A widget with another one waits for an update of Eva. */
const manifestSchemas: ReadonlyMap<number, unknown> = new Map<number, unknown>([
  [1, manifestV1Text],
  [2, manifestV2Text],
  [3, manifestV3Text],
  [4, manifestV4Text],
  // Contract 5 adds the calendar writes, which are contract paths: its manifest rules are those of contract 4.
  [5, manifestV5Text],
]);

export const manifestPath = "eva-widget.json";

export interface WidgetInput {
  readonly id: string;
  readonly type: WidgetInputType;
  readonly label: string;
  readonly description: string;
  readonly why: string;
  readonly required: boolean;
  readonly default?: unknown;
  readonly access?: "read" | "write";
  readonly schema?: string;
  readonly files?: string;
  readonly choices?: readonly string[];
}

export interface WidgetAsk {
  readonly type: WidgetAskType;
  readonly why: string;
}

export interface WidgetManifest {
  readonly contract: number;
  readonly name: string;
  readonly entry: string;
  readonly size: WidgetSize;
  readonly inputs: readonly WidgetInput[];
  readonly hosts: readonly { readonly url: string; readonly why: string }[];
  /** What the widget may ask Eva to do (contract 3). `checkManifest` gives an empty list for an older contract. */
  readonly asks?: readonly WidgetAsk[];
  readonly prompt?: string;
}

export interface ManifestCheck {
  /** Null when the manifest fails. */
  readonly manifest: WidgetManifest | null;
  /** One sentence for each problem, with the key that fails. */
  readonly problems: readonly string[];
  /** True when the widget follows a contract that this Eva does not know yet: Eva, not the widget, needs a change. */
  readonly newerContract?: boolean;
}

export interface WidgetCheck {
  readonly newerContract?: boolean;
  readonly manifest: readonly string[];
  readonly schemas: readonly string[];
}

const namingRules = "camelCase, full English words, no abbreviation";

// ajv-formats is CommonJS: its function is the module itself or its `default`, by the loader.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as typeof addFormatsModule;

/** Built once, on the first check: compiling the schemas takes a few milliseconds. */
let validators: {
  readonly manifests: ReadonlyMap<number, ValidateFunction>;
  readonly meta: ValidateFunction;
} | null = null;

function contractValidators(): {
  readonly manifests: ReadonlyMap<number, ValidateFunction>;
  readonly meta: ValidateFunction;
} {
  if (validators !== null) return validators;
  // `verbose` puts the failing value in each error, so a problem can name the field.
  const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false });
  validators = {
    manifests: new Map(
      [...manifestSchemas].map(([contract, text]) => [contract, ajv.compile(JSON.parse(text as string) as object)]),
    ),
    meta: ajv.compile(JSON.parse(metaSchemaText as unknown as string) as object),
  };
  return validators;
}

/** Checks the text of an `eva-widget.json`. The contract comes first: a newer one has other rules. */
export function checkManifest(text: string): ManifestCheck {
  const value = parse(text);
  if (value === undefined) return failed(`${manifestPath} is not valid JSON.`);
  const contract = (value as Record<string, unknown> | null)?.["contract"];
  if (typeof contract !== "number" || !Number.isInteger(contract))
    return failed(`${manifestPath} has no contract number.`);
  // Contract 1 is the first: a smaller number is a mistake in the manifest, not a newer widget.
  if (contract < 1) return failed(`${manifestPath} has the contract ${String(contract)}, which does not exist. Use 1.`);
  const validate = contractValidators().manifests.get(contract);
  if (validate === undefined) {
    return {
      ...failed(`This widget follows contract ${String(contract)}. Update Eva to use this widget.`),
      newerContract: true,
    };
  }
  if (validate(value)) {
    const manifest = value as Omit<WidgetManifest, "entry" | "inputs" | "hosts"> & Partial<WidgetManifest>;
    return {
      manifest: {
        ...manifest,
        entry: manifest.entry ?? "index.html",
        inputs: manifest.inputs ?? [],
        hosts: manifest.hosts ?? [],
        asks: manifest.asks ?? [],
      },
      problems: [],
    };
  }
  return { manifest: null, problems: unique((validate.errors ?? []).flatMap(manifestProblem)) };
}

/** Checks one data schema: the naming rules of the meta-schema, and that a validator can compile it. */
export function checkDataSchema(path: string, text: string): string[] {
  const value = parse(text);
  if (value === undefined) return [`${path} is not valid JSON.`];
  const validate = contractValidators().meta;
  if (!validate(value)) return unique((validate.errors ?? []).flatMap((error) => schemaProblem(path, error)));
  try {
    // A fresh strict validator, as a widget's CI uses: it refuses an unknown keyword or type.
    const strict = new Ajv2020({ strict: true });
    addFormats(strict);
    strict.compile(value as object);
  } catch (error) {
    return [`${path} is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`];
  }
  return [];
}

/** Checks a widget's manifest and each schema that its inputs name. `read` gives a file's text, or null. */
export function checkWidget(read: (path: string) => string | null): WidgetCheck {
  const text = read(manifestPath);
  if (text === null) return { manifest: [`${manifestPath} is missing.`], schemas: [] };
  const { manifest, problems, newerContract } = checkManifest(text);
  if (manifest === null)
    return { manifest: problems, schemas: [], ...(newerContract === true ? { newerContract } : {}) };
  const schemas = manifest.inputs.flatMap((input) => {
    if (input.schema === undefined) return [];
    const schemaText = read(input.schema);
    if (schemaText === null) return [`${input.schema} is missing. The input ${input.id} names it.`];
    return checkDataSchema(input.schema, schemaText);
  });
  return { manifest: [], schemas };
}

/** The compiled data schemas, by their text: a schema changes only with an approval. */
const dataValidators = new Map<string, ValidateFunction | null>();
const maxDataValidators = 200;

/**
 * Checks the value of one data file against a widget's schema (#692), and gives one sentence for
 * each problem, with the field. A schema that does not compile passes every file: the check at the
 * approval refuses such a schema, so only a broken copy has one.
 */
export function checkData(value: unknown, schema: unknown): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const key = JSON.stringify(schema);
  let validate = dataValidators.get(key);
  if (validate === undefined) {
    try {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      validate = ajv.compile(schema);
    } catch {
      validate = null;
    }
    if (dataValidators.size >= maxDataValidators) dataValidators.clear();
    dataValidators.set(key, validate);
  }
  if (validate === null || validate(value)) return [];
  return unique((validate.errors ?? []).flatMap(dataProblem));
}

function dataProblem(error: ErrorObject): string[] {
  // An `if` error only says that a `then` failed; the `then` error says what.
  if (error.keyword === "if") return [];
  const parent = error.instancePath.split("/").filter((part) => part !== "");
  if (error.keyword === "required") {
    const missing = String((error.params as { missingProperty?: unknown }).missingProperty);
    return [`the field "${[...parent, missing].join(".")}" is missing`];
  }
  const where = parent.length === 0 ? "the file" : `the field "${parent.join(".")}"`;
  return [`${where} ${error.message ?? "is not valid"}`];
}

function manifestProblem(error: ErrorObject): string[] {
  // An `if` error only says that a `then` failed; the `then` error says what.
  if (error.keyword === "if") return [];
  const where = error.instancePath === "" ? "the root" : error.instancePath;
  if (error.keyword === "additionalProperties") {
    const key = String((error.params as { additionalProperty?: unknown }).additionalProperty);
    return [`${manifestPath}: ${where} has the unknown key "${key}".`];
  }
  return [`${manifestPath}: ${where} ${error.message ?? "is not valid"}.`];
}

function schemaProblem(path: string, error: ErrorObject): string[] {
  // Ajv gives a schema path inside the `$ref` target, so the instance path and the value tell the rule.
  const closing = /\/(?:additionalProperties|unevaluatedProperties)$/;
  if (error.keyword === "not" && error.data === false && closing.test(error.instancePath)) {
    const where = error.instancePath.replace(closing, "") || "the root";
    return [
      `${path}: ${where} closes the object (additionalProperties: false), so another widget cannot add its fields.`,
    ];
  }
  // A name of `properties` fails as a property name; a name of `required` fails as an array item.
  const name =
    error.propertyName ??
    (/\/required\/\d+$/.test(error.instancePath) && typeof error.data === "string" ? error.data : undefined);
  if (name !== undefined && (error.keyword === "pattern" || error.keyword === "not")) {
    return [`${path}: the field name "${name}" breaks the naming rules (${namingRules}).`];
  }
  // The outer error of a property name repeats the inner one.
  if (error.keyword === "propertyNames") return [];
  const where = error.instancePath === "" ? "the root" : error.instancePath;
  return [`${path}: ${where} ${error.message ?? "is not valid"}.`];
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function failed(problem: string): ManifestCheck {
  return { manifest: null, problems: [problem] };
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}
