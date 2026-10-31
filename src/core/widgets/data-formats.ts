/**
 * The data formats of the widgets of one folder (#692). Eva reads the fields of each widget's JSON
 * Schema, at every level, and adds them up. The same field with the same type fits. The same field
 * with another type, format or list of allowed values is a conflict. Eva never maps one field name
 * to another: `location` and `place` stay two fields, and the agent fills both.
 */

/** One widget's schema for the folder. */
export interface FormatUser {
  /** The widget id, such as `example-owner/habits`. */
  readonly widget: string;
  /** The name that Eva shows. */
  readonly name: string;
  readonly schema: unknown;
}

/** One field of the folder, by its path, such as `checks[].date`. `[]` stands for each item of a list. */
export interface MergedField {
  readonly path: string;
  /** The JSON types, sorted, or null when no widget gives one. */
  readonly types: readonly string[] | null;
  readonly format: string | null;
  /** The allowed values (`enum` or `const`), or null for any value. */
  readonly values: readonly unknown[] | null;
  /** The names of the widgets that need the field. */
  readonly requiredBy: readonly string[];
  /** The names of the widgets that name the field. */
  readonly usedBy: readonly string[];
  readonly descriptions: readonly { readonly name: string; readonly text: string }[];
}

export interface FormatConflict {
  readonly path: string;
  /** The name of the widget that named the field first. */
  readonly first: string;
  readonly second: string;
  /** What differs, such as "number for Habits, and string for Training". */
  readonly reason: string;
}

export interface MergedFormat {
  readonly fields: readonly MergedField[];
  readonly conflicts: readonly FormatConflict[];
}

/** One field as one schema describes it. */
interface FieldShape {
  readonly path: string;
  readonly types: readonly string[] | null;
  readonly format: string | null;
  readonly values: readonly unknown[] | null;
  readonly required: boolean;
  readonly description: string | null;
}

interface Merging {
  path: string;
  types: readonly string[] | null;
  format: string | null;
  values: readonly unknown[] | null;
  readonly requiredBy: string[];
  readonly usedBy: string[];
  readonly descriptions: { readonly name: string; readonly text: string }[];
  /** The name of the widget of each value above, for the reason of a conflict. */
  readonly owners: { types: string | null; format: string | null; values: string | null };
}

/** A schema deeper than this is not a data file that a person reads. */
const maxDepth = 12;

/** The fields of every widget, in the order that they first appear, and each conflict. */
export function mergeFormats(users: readonly FormatUser[]): MergedFormat {
  const merged = new Map<string, Merging>();
  const conflicts: FormatConflict[] = [];
  for (const user of users) {
    for (const shape of fieldsOf(user.schema)) {
      const known = merged.get(shape.path);
      if (known === undefined) {
        merged.set(shape.path, {
          ...shape,
          requiredBy: shape.required ? [user.name] : [],
          usedBy: [user.name],
          descriptions: shape.description === null ? [] : [{ name: user.name, text: shape.description }],
          owners: {
            types: shape.types === null ? null : user.name,
            format: shape.format === null ? null : user.name,
            values: shape.values === null ? null : user.name,
          },
        });
        continue;
      }
      const reason = conflictOf(known, shape, user.name);
      if (reason !== null) {
        conflicts.push({ path: shape.path, first: reason.first, second: user.name, reason: reason.text });
        continue;
      }
      if (!known.usedBy.includes(user.name)) known.usedBy.push(user.name);
      if (shape.required && !known.requiredBy.includes(user.name)) known.requiredBy.push(user.name);
      if (shape.description !== null) known.descriptions.push({ name: user.name, text: shape.description });
      if (known.types === null && shape.types !== null) [known.types, known.owners.types] = [shape.types, user.name];
      if (known.format === null && shape.format !== null)
        [known.format, known.owners.format] = [shape.format, user.name];
      if (known.values === null && shape.values !== null)
        [known.values, known.owners.values] = [shape.values, user.name];
    }
  }
  const fields = [...merged.values()].map(
    ({ path, types, format, values, requiredBy, usedBy, descriptions }): MergedField => ({
      path,
      types,
      format,
      values,
      requiredBy,
      usedBy,
      descriptions,
    }),
  );
  return { fields, conflicts };
}

function conflictOf(
  known: Merging,
  shape: FieldShape,
  name: string,
): { readonly first: string; readonly text: string } | null {
  if (known.types !== null && shape.types !== null && known.types.join() !== shape.types.join())
    return {
      first: known.owners.types ?? "",
      text: `${known.types.join(" or ")} for ${known.owners.types ?? ""}, and ${shape.types.join(" or ")} for ${name}`,
    };
  if (known.format !== null && shape.format !== null && known.format !== shape.format)
    return {
      first: known.owners.format ?? "",
      text: `the format ${known.format} for ${known.owners.format ?? ""}, and ${shape.format} for ${name}`,
    };
  if (known.values !== null && shape.values !== null && !sameValues(known.values, shape.values))
    return {
      first: known.owners.values ?? "",
      text: `the values ${valueList(known.values)} for ${known.owners.values ?? ""}, and ${valueList(shape.values)} for ${name}`,
    };
  return null;
}

function sameValues(first: readonly unknown[], second: readonly unknown[]): boolean {
  const key = (values: readonly unknown[]): string =>
    [...new Set(values.map((value) => JSON.stringify(value)))].sort().join();
  return key(first) === key(second);
}

function valueList(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

/** Each field of a schema, the fields of an object before the fields inside them. */
function fieldsOf(root: unknown): FieldShape[] {
  const shapes: FieldShape[] = [];
  const visit = (schema: unknown, prefix: string, depth: number, refs: readonly string[]): void => {
    if (depth > maxDepth) return;
    const { node, followed } = resolved(root, schema, refs);
    if (node === null) return;
    const required = new Set(requiredOf(node, root, followed));
    for (const [key, child] of propertiesOf(node, root, followed)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const field = resolved(root, child, followed);
      shapes.push(shapeOf(path, field.node, required.has(key)));
      if (field.node === null) continue;
      visit(field.node, path, depth + 1, field.followed);
      const items = field.node["items"];
      if (isObject(items) || typeof items === "boolean") {
        const item = resolved(root, items, field.followed);
        shapes.push(shapeOf(`${path}[]`, item.node, false));
        if (item.node !== null) visit(item.node, `${path}[]`, depth + 1, item.followed);
      }
    }
  };
  visit(root, "", 0, []);
  return shapes;
}

function shapeOf(path: string, node: Record<string, unknown> | null, required: boolean): FieldShape {
  const type = node?.["type"];
  const types =
    typeof type === "string"
      ? [type]
      : Array.isArray(type) && type.every((each) => typeof each === "string")
        ? [...new Set(type)].sort()
        : null;
  const format = node?.["format"];
  const values = Array.isArray(node?.["enum"])
    ? (node["enum"] as unknown[])
    : node !== null && Object.hasOwn(node, "const")
      ? [node["const"]]
      : null;
  const description = node?.["description"];
  return {
    path,
    types,
    format: typeof format === "string" ? format : null,
    values,
    required,
    description: typeof description === "string" && description.trim() !== "" ? description.trim() : null,
  };
}

/** The properties of a node and of the parts of its `allOf`, in that order. */
function propertiesOf(node: Record<string, unknown>, root: unknown, refs: readonly string[]): [string, unknown][] {
  const own = isObject(node["properties"]) ? Object.entries(node["properties"]) : [];
  const parts = Array.isArray(node["allOf"]) ? node["allOf"] : [];
  const seen = new Set(own.map(([key]) => key));
  const extra = parts.flatMap((part): [string, unknown][] => {
    const { node: inner, followed } = resolved(root, part, refs);
    return inner === null ? [] : propertiesOf(inner, root, followed);
  });
  return [...own, ...extra.filter(([key]) => !seen.has(key) && (seen.add(key), true))];
}

function requiredOf(node: Record<string, unknown>, root: unknown, refs: readonly string[]): string[] {
  const own = Array.isArray(node["required"])
    ? node["required"].filter((key): key is string => typeof key === "string")
    : [];
  const parts = Array.isArray(node["allOf"]) ? node["allOf"] : [];
  return [
    ...own,
    ...parts.flatMap((part) => {
      const { node: inner, followed } = resolved(root, part, refs);
      return inner === null ? [] : requiredOf(inner, root, followed);
    }),
  ];
}

/**
 * The node that a schema stands for: itself, or the target of its local `$ref`. A `$ref` that the
 * path follows already, or that leads outside the file, stands for any value.
 */
function resolved(
  root: unknown,
  schema: unknown,
  refs: readonly string[],
): { readonly node: Record<string, unknown> | null; readonly followed: readonly string[] } {
  if (!isObject(schema)) return { node: null, followed: refs };
  const ref = schema["$ref"];
  if (typeof ref !== "string") return { node: schema, followed: refs };
  if (refs.includes(ref) || !ref.startsWith("#/")) return { node: null, followed: refs };
  let target: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    target = isObject(target) && Object.hasOwn(target, key) ? target[key] : undefined;
  }
  return isObject(target) ? { node: target, followed: [...refs, ref] } : { node: null, followed: refs };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
