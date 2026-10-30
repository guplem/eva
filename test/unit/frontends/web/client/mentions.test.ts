import { describe, expect, test } from "bun:test";
import type { Project } from "../../../../../src/frontends/web/client/api.ts";
import {
  insertMention,
  mentionNotes,
  mentionProjectOf,
  mentionQueryAt,
  mentionWordEnd,
  pickedProjects,
  busyProjects,
  withFixRequest,
  withProjectMention,
  type MentionProject,
} from "../../../../../src/frontends/web/client/mentions.ts";
import { mentionToken } from "../../../../../src/shared/mentions.ts";

function project(id: string, title: string, status: MentionProject["status"] = "active"): MentionProject {
  return { id, title, status, folder: `Projects/${id}` };
}

describe("mentionQueryAt (issue 657)", () => {
  test("an @ at the start or after a space opens the search, with the typed word", () => {
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("Look at @exa", 12)).toEqual({ start: 8, query: "exa" });
    expect(mentionQueryAt("Line one\n@ex", 12)).toEqual({ start: 9, query: "ex" });
  });

  test("an email address or a finished word opens nothing", () => {
    expect(mentionQueryAt("me@example.com", 14)).toBeNull();
    expect(mentionQueryAt("@exa more", 9)).toBeNull();
    expect(mentionQueryAt("no mention", 10)).toBeNull();
  });

  test("the search reads only the text before the caret", () => {
    expect(mentionQueryAt("@example and more", 4)).toEqual({ start: 0, query: "exa" });
  });

  test("a typed kind does not filter the names", () => {
    expect(mentionQueryAt("@project:exa", 12)).toEqual({ start: 0, query: "exa" });
    expect(mentionQueryAt("@file:notes", 11)).toEqual({ start: 0, query: "notes" });
  });
});

describe("insertMention", () => {
  test("the mention takes the place of the typed word, with a space after it", () => {
    expect(insertMention("Look at @exa please", 8, 12, "@project:example-app")).toEqual({
      text: "Look at @project:example-app please",
      caret: 29,
    });
    expect(insertMention("@ex", 0, 3, "@file:a.md")).toEqual({ text: "@file:a.md ", caret: 11 });
  });
});

describe("pickedProjects", () => {
  const projects = [
    project("2026-01-01-0000-closed-one", "Closed one", "closed"),
    project("2026-01-01-0000-idea-one", "Idea one", "idea"),
    project("2026-01-01-0000-paused-one", "Paused one", "paused"),
    project("2026-01-01-0000-active-one", "Active one"),
    project("2026-01-01-0000-used-one", "Used one", "in-use"),
    project("2026-01-01-0000-busy-one", "Busy one", "closed"),
    project("2026-01-01-0000-no-status", "No status", null),
  ];

  test("a busy project comes first, then by status: active, in-use, idea, paused, closed", () => {
    expect(pickedProjects(projects, ["2026-01-01-0000-busy-one"], "", 10).map((each) => each.title)).toEqual([
      "Busy one",
      "Active one",
      "Used one",
      "Idea one",
      "Paused one",
      "Closed one",
      "No status",
    ]);
  });

  test("the query matches a part of the title or of the id, in any case", () => {
    expect(pickedProjects(projects, [], "ACTIVE", 10).map((each) => each.title)).toEqual(["Active one"]);
    expect(pickedProjects(projects, [], "idea-o", 10).map((each) => each.title)).toEqual(["Idea one"]);
  });

  test("the list keeps the first ones only", () => {
    expect(pickedProjects(projects, [], "", 2)).toHaveLength(2);
  });
});

describe("mentionNotes", () => {
  const projects = [project("2026-01-02-0304-example-app", "Example app")];

  test("each mention gets one note that says where it is", () => {
    expect(
      mentionNotes(
        'See @project:2026-01-02-0304-example-app and @file:Notes/today.md, then @file:"Notes/My note.md".',
        projects,
      ),
    ).toEqual([
      '[@project:2026-01-02-0304-example-app is the project "Example app", in the folder Projects/2026-01-02-0304-example-app]',
      "[@file:Notes/today.md is the file Notes/today.md of the vault]",
      '[@file:"Notes/My note.md" is the file Notes/My note.md of the vault]',
    ]);
  });

  test("a project that Eva does not list takes the folder of the vault layout", () => {
    expect(mentionNotes("@project:2026-01-01-0000-gone", [])).toEqual([
      "[@project:2026-01-01-0000-gone is the project in the folder Projects/2026-01-01-0000-gone]",
    ]);
  });

  test("a mention that shows twice gets one note, and an email address gets none", () => {
    expect(mentionNotes("@file:a.md and @file:a.md, me@file:b.md", [])).toEqual([
      "[@file:a.md is the file a.md of the vault]",
    ]);
  });
});

describe("withProjectMention", () => {
  test("the mention goes before the text that the new chat already has", () => {
    expect(withProjectMention("", "example-app")).toBe("@project:example-app ");
    expect(withProjectMention("Hello", "example-app")).toBe("@project:example-app Hello");
  });

  test("a text that already mentions the project stays as it is", () => {
    expect(withProjectMention("@project:example-app Hello", "example-app")).toBe("@project:example-app Hello");
  });
});

describe("withFixRequest (issue 668)", () => {
  test("the mention and the fix request make the text of the new chat", () => {
    expect(withFixRequest("", "example-app", "In example-owner/example-app, add hooks.")).toBe(
      "@project:example-app In example-owner/example-app, add hooks.",
    );
  });

  test("the text that the new chat already has stays after the fix", () => {
    expect(withFixRequest("Half a thought", "example-app", "Add hooks.")).toBe(
      "@project:example-app Add hooks.\n\nHalf a thought",
    );
    expect(withFixRequest("  \n", "example-app", "Add hooks.")).toBe("@project:example-app Add hooks.");
  });
});

describe("busyProjects", () => {
  test("a project is busy while one of its Project chats runs, by the list or by the live turns", () => {
    const chats = [
      { id: "a", mode: "project" as const, projectId: "first", running: true },
      { id: "b", mode: "project" as const, projectId: "second", running: false },
      { id: "c", mode: "project" as const, projectId: "third", running: false },
      { id: "d", mode: "assistant" as const, projectId: null, running: true },
    ];
    expect(busyProjects(chats, (id) => id === "b")).toEqual(["first", "second"]);
  });
});

describe("a mention round trip", () => {
  test("a path that ends in punctuation keeps it, because the mention is in quotes", () => {
    for (const path of ["Notes/Draft(1)", "Journal/Q&A?", "Notes/todo.", "Notes/a]", "Notes/día.md", "Notes\\win.md"]) {
      const token = mentionToken("file", path);
      expect(mentionNotes(`${token}, then more`, [])).toEqual([`[${token} is the file ${path} of the vault]`]);
    }
  });

  test("a mention at the end of a line gets its note", () => {
    expect(mentionNotes("Read @file:a.md\nthen answer", [])).toEqual(["[@file:a.md is the file a.md of the vault]"]);
  });
});

describe("insertMention before a line break", () => {
  test("a line break after the word needs no extra space", () => {
    expect(insertMention("hi @fo\nthere", 3, 6, "@file:a.md")).toEqual({ text: "hi @file:a.md\nthere", caret: 13 });
  });
});

describe("mentionWordEnd", () => {
  test("the typed word goes on after the caret up to the next space", () => {
    expect(mentionWordEnd("@project:abc more", 10)).toBe(12);
    expect(mentionWordEnd("@ab", 3)).toBe(3);
  });
});

describe("mentionProjectOf", () => {
  const base = {
    id: "2026-01-02-0304-example-app",
    title: "Example app",
    frontMatter: { status: "paused" },
    path: "/vaults/demo/Projects/2026-01-02-0304-example-app",
  };

  test("a project in the vault names its vault folder, and one outside names its full path", () => {
    const inVault = { ...base, vaultFolder: "Projects/2026-01-02-0304-example-app" } as unknown as Project;
    const outside = { ...base, vaultFolder: null } as unknown as Project;
    expect(mentionProjectOf(inVault)).toEqual({
      id: base.id,
      title: "Example app",
      status: "paused",
      folder: "Projects/2026-01-02-0304-example-app",
    });
    expect(mentionProjectOf(outside).folder).toBe(base.path);
  });
});
