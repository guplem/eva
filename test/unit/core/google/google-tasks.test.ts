import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleTasks, noTasks, type GoogleTasksInputs } from "../../../../src/core/google/google-tasks.ts";
import { googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = {
  clientId: "123456789012-clientid.apps.googleusercontent.com",
  clientSecret: "GOCSPX-client-secret-value",
};
const config = { ...defaultConfig.google, email: "person@example.com", services: ["tasks" as const] };

const home = { kind: "tasks#taskList", id: "home-list", title: "Home" };
const work = { kind: "tasks#taskList", id: "work-list", title: "Work" };

let folder: string;
let google: FakeGoogle;
let inputs: GoogleTasksInputs;
let now: Date;
let tasks: GoogleTasks;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-google-tasks-"));
  google = fakeGoogle();
  google.taskLists = [home, work];
  inputs = { config, client, credentialsFolder: folder, baseUrl: google.url };
  now = new Date("2026-11-18T08:00:00Z");
  tasks = new GoogleTasks({ inputs: () => inputs, now: () => now });
  writeFileSync(
    join(folder, "person@example.com.json"),
    JSON.stringify({
      token: null,
      refresh_token: "the-refresh-token",
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scopes: googleScopes(config),
      expiry: null,
    }),
  );
});
afterEach(() => {
  google.stop();
  rmSync(folder, { recursive: true, force: true });
});

function taskQueries(): URLSearchParams[] {
  return google.apiQueries.filter(({ path }) => path.endsWith("/tasks")).map(({ query }) => query);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isEvaError(error, "google_failed")) return error.message;
    throw error;
  }
  throw new Error("The call did not fail.");
}

describe("the task lists", () => {
  test("list each task list by its id and name, in Google's order", async () => {
    google.taskLists = [home, { id: "untitled-list" }, { title: "No id" }, work];
    expect(await tasks.lists()).toEqual([
      { id: "home-list", name: "Home" },
      { id: "untitled-list", name: "" },
      { id: "work-list", name: "Work" },
    ]);
  });

  test("answer null with Tasks off or no Google login, with no call to Google", async () => {
    inputs = { ...inputs, config: { ...config, services: ["calendar"] } };
    expect(await tasks.lists()).toBeNull();
    inputs = { ...inputs, config: { ...config, email: null } };
    expect(await tasks.lists()).toBeNull();
    expect(google.tokenRequests).toHaveLength(0);
  });

  test("answer null when the login on this machine does not work", async () => {
    rmSync(join(folder, "person@example.com.json"));
    expect(await tasks.lists()).toBeNull();
    expect(google.apiRequests).toHaveLength(0);
  });

  test("throw when Google refuses, and keep no failure in the cache", async () => {
    google.apiStatus = 500;
    const message = await failure(tasks.lists());
    expect(message).toContain("HTTP 500");
    expect(message).toContain("tasks");
    google.apiStatus = null;
    expect(await tasks.lists()).toHaveLength(2);
  });

  test("read every page of the lists", async () => {
    google.taskPageSize = 1;
    expect((await tasks.lists())?.map((list) => list.id)).toEqual(["home-list", "work-list"]);
  });

  test("the source with no Google answers null", async () => {
    expect(await noTasks.lists()).toBeNull();
    expect(await noTasks.tasks("2026-11-18", "2026-11-18")).toBeNull();
  });
});

describe("the tasks", () => {
  test("give the tasks of each list with a due day in the window, in the contract's shape", async () => {
    google.tasks.set(home.id, [
      {
        id: "water",
        title: "Water the plants",
        notes: "The ones on the balcony.",
        status: "needsAction",
        due: "2026-11-19T00:00:00.000Z",
        position: "00000000000000000001",
        webViewLink: "https://tasks.google.com/task/water",
      },
      {
        id: "bins",
        title: "Take out the bins",
        status: "completed",
        due: "2026-11-18T00:00:00.000Z",
        completed: "2026-11-18T10:00:00.000Z",
        hidden: true,
        position: "00000000000000000002",
      },
      { id: "gone", title: "Deleted", status: "needsAction", due: "2026-11-18T00:00:00.000Z", deleted: true },
      { id: "undated", title: "No due day", status: "needsAction" },
      { id: "later", title: "After the window", status: "needsAction", due: "2026-11-20T00:00:00.000Z" },
      { id: "before", title: "Before the window", status: "needsAction", due: "2026-11-17T00:00:00.000Z" },
      { title: "No id", due: "2026-11-18T00:00:00.000Z" },
      { id: "bad-due", title: "Bad due", due: "soon" },
    ]);
    google.tasks.set(work.id, [
      {
        id: "untitled",
        status: "needsAction",
        due: "2026-11-18T00:00:00.000Z",
        position: "00000000000000000000",
        notes: "",
        webViewLink: "javascript:alert(1)",
      },
    ]);

    expect(await tasks.tasks("2026-11-18", "2026-11-19")).toEqual([
      {
        id: "bins",
        listId: home.id,
        title: "Take out the bins",
        dueDate: "2026-11-18",
        completed: true,
        completedAt: "2026-11-18T10:00:00.000Z",
        notes: null,
        link: null,
      },
      {
        id: "untitled",
        listId: work.id,
        title: "",
        dueDate: "2026-11-18",
        completed: false,
        completedAt: null,
        notes: null,
        link: null,
      },
      {
        id: "water",
        listId: home.id,
        title: "Water the plants",
        dueDate: "2026-11-19",
        completed: false,
        completedAt: null,
        notes: "The ones on the balcony.",
        link: "https://tasks.google.com/task/water",
      },
    ]);
  });

  test("sort by due day, then the order of the lists, then the position in a list", async () => {
    google.tasks.set(home.id, [
      { id: "second", title: "B", due: "2026-11-18T00:00:00.000Z", position: "00000000000000000002" },
      { id: "first", title: "A", due: "2026-11-18T00:00:00.000Z", position: "00000000000000000001" },
    ]);
    google.tasks.set(work.id, [{ id: "work", title: "W", due: "2026-11-18T00:00:00.000Z", position: "0" }]);
    expect((await tasks.tasks("2026-11-18", "2026-11-18"))?.map((task) => task.id)).toEqual([
      "first",
      "second",
      "work",
    ]);
  });

  test("put each subtask after its parent, and a subtask whose parent is not in the window after the others", async () => {
    const due = "2026-11-18T00:00:00.000Z";
    google.taskLists = [home];
    google.tasks.set(home.id, [
      { id: "p2-child", parent: "p2", due, position: "00000000000000000000" },
      { id: "p1-child-b", parent: "p1", due, position: "00000000000000000001" },
      { id: "orphan", parent: "elsewhere", due, position: "00000000000000000000" },
      { id: "p2", due, position: "00000000000000000002" },
      { id: "p1-child-a", parent: "p1", due, position: "00000000000000000000" },
      { id: "p1", due, position: "00000000000000000001" },
    ]);
    expect((await tasks.tasks("2026-11-18", "2026-11-18"))?.map((task) => task.id)).toEqual([
      "p1",
      "p1-child-a",
      "p1-child-b",
      "p2",
      "p2-child",
      "orphan",
    ]);
  });

  test("cut long notes, never inside a character", async () => {
    google.tasks.set(home.id, [
      { id: "long", due: "2026-11-18T00:00:00.000Z", notes: "x".repeat(2500) },
      { id: "emoji", due: "2026-11-18T00:00:00.000Z", notes: `${"x".repeat(1999)}😀😀` },
    ]);
    const read = (await tasks.tasks("2026-11-18", "2026-11-18")) ?? [];
    expect(read.find((task) => task.id === "long")?.notes).toHaveLength(2000);
    expect(read.find((task) => task.id === "emoji")?.notes).toBe(`${"x".repeat(1999)}😀`);
  });

  test("a list that fails makes the read fail once, and the next read asks Google for the lists again", async () => {
    await tasks.tasks("2026-11-18", "2026-11-18");
    // The person deletes a list while Eva keeps the old lists.
    google.taskLists = [home];
    google.missingTaskLists.add(work.id);
    expect(await failure(tasks.tasks("2026-11-19", "2026-11-19"))).toContain("HTTP 404");
    expect(await tasks.tasks("2026-11-19", "2026-11-19")).toEqual([]);
    expect(await tasks.lists()).toEqual([{ id: "home-list", name: "Home" }]);
  });

  test("ask Google for completed and hidden tasks of whole UTC days, since a task keeps only its day", async () => {
    await tasks.tasks("2026-11-18", "2026-11-19");
    const [query] = taskQueries();
    expect(query?.get("dueMin")).toBe("2026-11-18T00:00:00.000Z");
    expect(query?.get("dueMax")).toBe("2026-11-20T00:00:00.000Z");
    expect(query?.get("showCompleted")).toBe("true");
    expect(query?.get("showHidden")).toBe("true");
    // A task that someone assigned from a Google Doc or Chat shows in the person's Tasks too.
    expect(query?.get("showAssigned")).toBe("true");
    expect(taskQueries()).toHaveLength(2);
  });

  test("read every page of a long list", async () => {
    google.taskPageSize = 2;
    google.taskLists = [home];
    google.tasks.set(
      home.id,
      ["a", "b", "c"].map((id, index) => ({ id, title: id, due: `2026-11-1${String(index + 1)}T00:00:00.000Z` })),
    );
    expect((await tasks.tasks("2026-11-11", "2026-11-13"))?.map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(taskQueries().map((query) => query.get("pageToken"))).toEqual([null, "2"]);
  });

  test("keep an answer for a minute", async () => {
    await Promise.all([tasks.tasks("2026-11-18", "2026-11-18"), tasks.tasks("2026-11-18", "2026-11-18")]);
    const calls = google.apiRequests.length;
    expect(calls).toBe(3);
    now = new Date(now.getTime() + 59_000);
    await tasks.tasks("2026-11-18", "2026-11-18");
    expect(google.apiRequests).toHaveLength(calls);
    now = new Date(now.getTime() + 1_000);
    await tasks.tasks("2026-11-18", "2026-11-18");
    expect(google.apiRequests).toHaveLength(calls * 2);
  });

  test("answer null with Tasks off", async () => {
    inputs = { ...inputs, config: { ...config, services: ["drive"] } };
    expect(await tasks.tasks("2026-11-18", "2026-11-18")).toBeNull();
    expect(google.apiRequests).toHaveLength(0);
  });

  test("answer null when Google refuses the login, and throw when Google refuses the tasks", async () => {
    google.tokenError = "invalid_grant";
    expect(await tasks.tasks("2026-11-18", "2026-11-18")).toBeNull();
    google.tokenError = null;
    now = new Date(now.getTime() + 60_000);
    await tasks.lists();
    google.apiStatus = 403;
    expect(await failure(tasks.tasks("2026-11-18", "2026-11-18"))).toContain("HTTP 403");
  });
});
