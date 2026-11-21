/**
 * The open cases that Eva gives a widget with the `eva-cases` input, at `eva/cases.json` (#971).
 * The values follow the rules of the Cases page (`src/shared/case-rules.ts`). The days stay as
 * written, so the widget words them for its own today. Eva redacts nothing here: the person's own
 * text goes to the widget that the person approved. No case text goes to a log.
 */
import { discoverLifeEntities, hasLifeKindFolder, type LifeEntity } from "../life/life-catalog.ts";
import { caseDeadline, caseStepRules, currentCaseStep, daySortKey, isClosedCase } from "../../shared/case-rules.ts";

export interface WidgetCase {
  /** The folder name of the case. */
  readonly id: string;
  /** The folder of the case from the vault root, such as `Life/Cases/<id>`: a widget opens it in Eva. */
  readonly path: string;
  readonly title: string;
  readonly nextStep: {
    readonly text: string;
    readonly waitingFor: string | null;
    readonly dueDate: string | null;
  } | null;
  readonly deadline: { readonly date: string | null; readonly cost: string | null } | null;
  /** Both null when the case has no list of steps. */
  readonly stepsDone: number | null;
  readonly stepsTotal: number | null;
}

/** The open cases, the most urgent first, or null when the vault has no cases folder. */
export function openCases(vaultPath: string): WidgetCase[] | null {
  if (!hasLifeKindFolder(vaultPath, "cases")) return null;
  return discoverLifeEntities(vaultPath, "cases")
    .filter((entity) => !isClosedCase(entity.fields))
    .map(widgetCaseOf)
    .map((item) => ({ item, key: urgencyKey(item) }))
    .sort((first, second) => byKey(first.key, second.key) || byTitle(first.item, second.item))
    .map(({ item }) => item);
}

function widgetCaseOf(entity: LifeEntity): WidgetCase {
  const steps = caseStepRules(entity.fields);
  const step = currentCaseStep(entity.fields);
  return {
    id: entity.id,
    path: entity.folder,
    title: entity.title,
    nextStep: step === null ? null : { text: step.text, waitingFor: step.waitingFor, dueDate: step.dueBy },
    deadline: caseDeadline(entity.fields),
    stepsDone: steps.length === 0 ? null : steps.filter((each) => each.state === "done").length,
    stepsTotal: steps.length === 0 ? null : steps.length,
  };
}

/**
 * The earliest of the due day and the deadline. A passed day is earlier than any day to come, so
 * the late cases come first with no clock, and the answer is the same on every server.
 */
function urgencyKey(item: WidgetCase): string | null {
  const keys = [daySortKey(item.nextStep?.dueDate ?? null), daySortKey(item.deadline?.date ?? null)].filter(
    (key) => key !== null,
  );
  return keys.length === 0 ? null : keys.reduce((first, second) => (second < first ? second : first));
}

/** The soonest key first. A case with no day goes last. */
function byKey(first: string | null, second: string | null): number {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return first < second ? -1 : 1;
}

/** As the Cases page: case does not count. */
function byTitle(first: WidgetCase, second: WidgetCase): number {
  return first.title.localeCompare(second.title, undefined, { sensitivity: "base" });
}
