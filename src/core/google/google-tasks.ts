/**
 * The person's Google Tasks, read by Eva herself with her own Google login, for a widget with an
 * `eva-google-tasks` input (#1102). The widget never sees a token: it gets only the plain shapes of
 * the widget contract, never Google's own format.
 *
 * Google keeps only the day of a due date, never its time: `due` is always midnight UTC of that
 * day. So a due day needs no time zone, unlike the days of the calendar.
 */
import { googleAccessToken, type GoogleCheckInputs } from "./google-check.ts";
import { GoogleAnswerCache, googleText as text, isDay, nextDay, readGooglePages } from "./google-reads.ts";

export type GoogleTasksInputs = Omit<GoogleCheckInputs, "readServices">;

/** One task list of the person. */
export interface WidgetTaskList {
  readonly id: string;
  readonly name: string;
}

export interface WidgetTask {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly dueDate: string;
  readonly completed: boolean;
  readonly completedAt: string | null;
  readonly notes: string | null;
  readonly link: string | null;
}

/** What a widget may read of the tasks. Null means no Google login, or Tasks off. Throws `google_failed`. */
export interface TasksSource {
  lists(): Promise<readonly WidgetTaskList[] | null>;
  /** The tasks due on the days `from` to `to`, both included. */
  tasks(from: string, to: string): Promise<readonly WidgetTask[] | null>;
}

export interface GoogleTasksOptions {
  /** Read at each call, so a change in Settings applies at once. */
  readonly inputs: () => GoogleTasksInputs;
  readonly now: () => Date;
}

/** 100 is the most that Google Tasks gives in one page. The page cap keeps a huge list bounded. */
const pageSize = 100;
const maxPages = 20;
/** As the description of a calendar event. */
const maxNotesLength = 2000;

export class GoogleTasks implements TasksSource {
  private readonly options: GoogleTasksOptions;
  private readonly cache: GoogleAnswerCache;

  constructor(options: GoogleTasksOptions) {
    this.options = options;
    this.cache = new GoogleAnswerCache(options.now);
  }

  async lists(): Promise<readonly WidgetTaskList[] | null> {
    const inputs = this.options.inputs();
    if (!isTasksOn(inputs)) return null;
    return this.cache.cached(`lists|${inputs.config.email ?? ""}`, async () => {
      const access = await googleAccessToken(inputs);
      if ("problem" in access) return null;
      return readLists(inputs, access.accessToken);
    });
  }

  async tasks(from: string, to: string): Promise<readonly WidgetTask[] | null> {
    const inputs = this.options.inputs();
    if (!isTasksOn(inputs)) return null;
    return this.cache.cached(`tasks|${inputs.config.email ?? ""}|${from}|${to}`, async () => {
      const lists = await this.lists();
      if (lists === null) return null;
      const access = await googleAccessToken(inputs);
      if ("problem" in access) return null;
      const read = await Promise.all(lists.map((list) => readTasks(inputs, access.accessToken, list.id, from, to)));
      // The lists come in Google's order, and each list is sorted by its position, so a stable sort by day keeps both.
      return read
        .flat()
        .sort((first, second) => compare(first.task.dueDate, second.task.dueDate))
        .map(({ task }) => task);
    });
  }
}

/** The source of a widget when Eva has no Google: every read answers "no tasks". */
export const noTasks: TasksSource = {
  lists: () => Promise.resolve(null),
  tasks: () => Promise.resolve(null),
};

function isTasksOn(inputs: GoogleTasksInputs): boolean {
  return inputs.config.services.includes("tasks") && inputs.config.email !== null;
}

interface GoogleTaskList {
  readonly id?: unknown;
  readonly title?: unknown;
}

async function readLists(inputs: GoogleTasksInputs, accessToken: string): Promise<WidgetTaskList[]> {
  const entries = await readPages<GoogleTaskList>(
    inputs,
    accessToken,
    "/tasks/v1/users/@me/lists",
    new URLSearchParams({ maxResults: String(pageSize) }),
  );
  return entries.flatMap((entry) =>
    typeof entry.id === "string" && entry.id !== "" ? [{ id: entry.id, name: text(entry.title) ?? "" }] : [],
  );
}

interface GoogleTask {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly notes?: unknown;
  readonly status?: unknown;
  readonly due?: unknown;
  readonly completed?: unknown;
  readonly deleted?: unknown;
  readonly position?: unknown;
  readonly webViewLink?: unknown;
}

interface PlacedTask {
  readonly task: WidgetTask;
  readonly position: string;
}

async function readTasks(
  inputs: GoogleTasksInputs,
  accessToken: string,
  listId: string,
  from: string,
  to: string,
): Promise<PlacedTask[]> {
  const items = await readPages<GoogleTask>(
    inputs,
    accessToken,
    `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
    new URLSearchParams({
      dueMin: `${from}T00:00:00.000Z`,
      dueMax: `${nextDay(to)}T00:00:00.000Z`,
      // The widget shows a completed task struck through. A hidden task is one that the person cleared after it was done.
      showCompleted: "true",
      showHidden: "true",
      maxResults: String(pageSize),
    }),
  );
  const placed = items.flatMap((item) => {
    const task = contractTask(item, listId);
    // Eva checks the day herself: Google's docs do not say whether `dueMax` is inclusive.
    if (task === null || task.dueDate < from || task.dueDate > to) return [];
    return [{ task, position: text(item.position) ?? "" }];
  });
  return placed.sort(
    (first, second) => compare(first.position, second.position) || compare(first.task.id, second.task.id),
  );
}

/** The task in the contract's shape, or null for a deleted task, a task with no due day, or one that Eva cannot read. */
function contractTask(item: GoogleTask, listId: string): WidgetTask | null {
  if (typeof item.id !== "string" || item.id === "" || item.deleted === true) return null;
  const dueDate = text(item.due)?.slice(0, 10) ?? null;
  if (dueDate === null || !isDay(dueDate)) return null;
  const completed = item.status === "completed";
  const notes = text(item.notes);
  return {
    id: item.id,
    listId,
    title: text(item.title) ?? "",
    dueDate,
    completed,
    completedAt: completed ? text(item.completed) : null,
    notes: notes === null ? null : notes.slice(0, maxNotesLength),
    link: httpsLink(item.webViewLink),
  };
}

/** Only an https address: the widget puts the link in a tab, where another scheme could run code. */
function httpsLink(value: unknown): string | null {
  const link = text(value);
  if (link === null) return null;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

function compare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Every item of a list of Google Tasks, page by page. Throws `google_failed`. */
function readPages<Item>(
  inputs: GoogleTasksInputs,
  accessToken: string,
  path: string,
  query: URLSearchParams,
): Promise<Item[]> {
  return readGooglePages<Item>({ baseUrl: inputs.baseUrl, accessToken, path, query, maxPages, what: "the tasks" });
}
