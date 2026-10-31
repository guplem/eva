/**
 * The check of the input values of a widget (#691): the activation, an update (#693) and the
 * preview of a clone check each value against the manifest and the vault in the same way.
 */
import { EvaError } from "../../shared/errors.ts";
import { ownValue } from "./widget-approvals.ts";
import type { WidgetInput } from "./widget-contract.ts";
import { placeOf } from "./widget-data.ts";
import type { WidgetInputValue } from "./widget-list.ts";
import { isWritableName } from "./widget-places.ts";

/** The values to keep, trimmed. Throws `widget_invalid` for a required input with no value or a value that does not fit. */
export function checkValues(
  vaultPath: string,
  inputs: readonly WidgetInput[],
  values: Readonly<Record<string, WidgetInputValue>>,
): Record<string, WidgetInputValue> {
  const kept: Record<string, WidgetInputValue> = {};
  for (const input of inputs) {
    if (input.type === "eva-location") continue;
    const value = ownValue(values, input.id);
    const empty = value === undefined || (typeof value === "string" && value.trim() === "");
    if (empty) {
      if (input.required) throw new EvaError("widget_invalid", `${input.label} needs a value.`);
      continue;
    }
    const problem = valueProblem(vaultPath, input, value);
    if (problem !== null) throw new EvaError("widget_invalid", `${input.label}: ${problem}`);
    kept[input.id] = typeof value === "string" ? value.trim() : value;
  }
  return kept;
}

function valueProblem(vaultPath: string, input: WidgetInput, value: WidgetInputValue): string | null {
  switch (input.type) {
    case "folder":
    case "file": {
      if (typeof value !== "string") return "pick a place of the vault.";
      const path = value.trim();
      const place = placeOf(vaultPath, path);
      if (place === null) return "a widget may not reach this place.";
      if (input.type === "folder") return place === "folder" ? null : "pick a folder that exists.";
      if (place === "folder") return "pick a file, not a folder.";
      if (input.access === "write" && !isWritableName(path.split("/").at(-1) ?? ""))
        return "a widget writes only a JSON or YAML file that is not a rule file.";
      return place === "file" || input.access === "write" ? null : "pick a file that exists.";
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "give a number.";
    case "boolean":
      return typeof value === "boolean" ? null : "give yes or no.";
    case "choice":
      return typeof value === "string" && (input.choices ?? []).includes(value) ? null : "pick one of the choices.";
    case "url":
      return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim()) ? null : "give a web address.";
    default:
      return typeof value === "string" ? null : "give a text.";
  }
}
