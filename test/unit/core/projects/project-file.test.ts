import { describe, expect, test } from "bun:test";
import { parseFrontMatter } from "../../../../src/core/projects/project-catalog.ts";
import {
  applyProjectDetails,
  checkProjectFile,
  fileVersion,
  matchFileStyle,
  projectFileOf,
  setRepositoryType,
  type ProjectDetails,
} from "../../../../src/core/projects/project-file.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

const file = [
  "---",
  "created: 2026-01-31T09:15",
  "status: active # idea, active, paused or closed",
  "repos:",
  "  - https://github.com/example/example-app",
  "tags: [work, tool]",
  "custom: kept",
  "---",
  "",
  "# Example app",
  "",
  "Notes about the app.",
  "",
].join("\n");

const unchanged: ProjectDetails = {
  title: "Example app",
  status: "active",
  tags: ["work", "tool"],
  repos: ["https://github.com/example/example-app"],
};

function invalidCode(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return isEvaError(error) ? error.code : "not an EvaError";
  }
}

describe("applyProjectDetails", () => {
  test("gives the same text when nothing changes", () => {
    expect(applyProjectDetails(file, unchanged)).toBe(file);
  });

  test("changes the fields and keeps comments, order, unknown keys and the body", () => {
    const result = applyProjectDetails(file, {
      title: "Better name",
      status: "paused",
      tags: ["home"],
      repos: ["https://github.com/example/example-app", "https://github.com/example/example-api"],
    });
    expect(result).toBe(
      [
        "---",
        "created: 2026-01-31T09:15",
        "status: paused # active, paused or closed",
        "repos:",
        "  - https://github.com/example/example-app",
        "  - https://github.com/example/example-api",
        "tags: [home]",
        "custom: kept",
        "---",
        "",
        "# Better name",
        "",
        "Notes about the app.",
        "",
      ].join("\n"),
    );
  });

  test("a saved status updates only Eva's old lists of statuses in the comment (#690, #859)", () => {
    const withComment = (comment: string): string => file.replace("# idea, active, paused or closed", comment);
    const paused = { ...unchanged, status: "paused" as const };
    for (const old of ["#idea, active, paused or closed", "# idea, active, in-use, paused or closed"]) {
      expect(applyProjectDetails(withComment(old), paused)).toContain("status: paused # active, paused or closed\n");
    }
    expect(applyProjectDetails(withComment("# my own note"), paused)).toContain("status: paused # my own note\n");
    // A field that the person did not change keeps its comment as it is.
    expect(applyProjectDetails(file, { ...unchanged, title: "Other" })).toContain(
      "status: active # idea, active, paused or closed\n",
    );
  });

  test("an empty list, title or status removes its part", () => {
    const result = applyProjectDetails(file, { title: "", status: null, tags: [], repos: [] });
    // With no repository left, the type key keeps the project software (#768).
    expect(result).toBe(
      [
        "---",
        "created: 2026-01-31T09:15",
        "custom: kept",
        "type: software",
        "---",
        "",
        "Notes about the app.",
        "",
      ].join("\n"),
    );
    expect(parseFrontMatter(result).frontMatter?.extra).toEqual({ custom: "kept" });
  });

  test("adds the missing keys and a missing heading", () => {
    const result = applyProjectDetails("---\ncreated: 2026-01-31T09:15\n---\nSome text.\n", {
      title: "New",
      status: "paused",
      tags: ["work"],
      repos: [],
    });
    expect(result).toBe("---\ncreated: 2026-01-31T09:15\nstatus: paused\ntags:\n  - work\n---\n# New\n\nSome text.\n");
  });

  test("adds a heading to an empty body", () => {
    expect(
      applyProjectDetails("---\nstatus: paused\n---\n", { ...unchanged, status: "paused", tags: [], repos: [] }),
    ).toBe("---\nstatus: paused\n---\n# Example app\n");
  });

  test("keeps Windows line endings and a byte order mark", () => {
    const windows = "\uFEFF" + file.replaceAll("\n", "\r\n");
    const result = applyProjectDetails(windows, { ...unchanged, status: "closed" });
    expect(result).toBe(
      windows.replace("status: active # idea, active, paused or closed", "status: closed # active, paused or closed"),
    );
  });

  test("cleans the lists: trims, drops empty entries, duplicates and a leading #", () => {
    const result = applyProjectDetails(file, {
      ...unchanged,
      tags: [" work ", "", "#Work", "tool", "#"],
      repos: [" https://github.com/example/example-app ", "https://github.com/example/example-app"],
    });
    expect(parseFrontMatter(result).frontMatter?.tags).toEqual(["work", "tool"]);
    expect(parseFrontMatter(result).frontMatter?.repos).toEqual(["https://github.com/example/example-app"]);
  });

  test("refuses a tag or repository with a space, a repository that starts with -, and a title with a line break", () => {
    expect(invalidCode(() => applyProjectDetails(file, { ...unchanged, tags: ["two words"] }))).toBe("project_invalid");
    expect(invalidCode(() => applyProjectDetails(file, { ...unchanged, repos: ["a b"] }))).toBe("project_invalid");
    expect(invalidCode(() => applyProjectDetails(file, { ...unchanged, repos: ["--upload-pack=x"] }))).toBe(
      "project_invalid",
    );
    expect(invalidCode(() => applyProjectDetails(file, { ...unchanged, title: "a\nb" }))).toBe("project_invalid");
  });

  test("refuses a file whose front matter Eva cannot read", () => {
    expect(invalidCode(() => applyProjectDetails("# No front matter\n", unchanged))).toBe("project_invalid");
    expect(invalidCode(() => applyProjectDetails("---\n- a list\n---\n", unchanged))).toBe("project_invalid");
  });

  test("writes values that read back as text", () => {
    const result = applyProjectDetails(file, { ...unchanged, tags: ["2024", "yes", "a:b"] });
    expect(parseFrontMatter(result).frontMatter?.tags).toEqual(["2024", "yes", "a:b"]);
  });
});

describe("checkProjectFile", () => {
  test("accepts a file with readable front matter, and refuses one without", () => {
    expect(() => {
      checkProjectFile(file);
    }).not.toThrow();
    expect(invalidCode(() => checkProjectFile("no front matter\n"))).toBe("project_invalid");
    expect(invalidCode(() => checkProjectFile("---\ncreated: [unclosed\n---\n"))).toBe("project_invalid");
  });
});

describe("fileVersion", () => {
  test("changes with the text", () => {
    expect(fileVersion(file)).toBe(fileVersion(file.slice(0)));
    expect(fileVersion(file)).not.toBe(fileVersion(`${file} `));
  });
});

describe("matchFileStyle", () => {
  test("gives the edited text the line endings and byte order mark of the file on disk", () => {
    expect(matchFileStyle("a\nb\n", "\uFEFFx\r\ny\r\n")).toBe("\uFEFFa\r\nb\r\n");
    expect(matchFileStyle("\uFEFFa\r\nb\n", "x\ny\n")).toBe("a\nb\n");
  });
});

describe("applyProjectDetails and the title", () => {
  test("changes the heading that the project list shows, the first one after the front matter", () => {
    const text = "---\nstatus: paused\n---\n# Old\n\nText.\n\n# Second\n";
    const result = applyProjectDetails(text, { title: "New", status: "paused", tags: [], repos: [] });
    expect(result).toBe("---\nstatus: paused\n---\n# New\n\nText.\n\n# Second\n");
  });
});

describe("projectFileOf", () => {
  test("gives the text, its version and the details that the form shows", () => {
    expect(projectFileOf(file)).toEqual({
      text: file,
      version: fileVersion(file),
      details: { ...unchanged, inUse: false, type: "software", closed: null, created: "2026-01-31T09:15" },
    });
  });

  test("gives no details for a file with no front matter, and an empty title for no heading", () => {
    expect(projectFileOf("Just text.\n").details).toBeNull();
    expect(projectFileOf("\uFEFF---\nstatus: wrong\n---\n").details).toEqual({
      title: "",
      status: null,
      inUse: false,
      tags: [],
      repos: [],
      type: "general",
      closed: null,
      created: null,
    });
  });
});

describe("applyProjectDetails and the project type (#703, #768)", () => {
  test("each type gets the key, and a form that sends no type keeps it", () => {
    const specialist = applyProjectDetails(file, { ...unchanged, repos: [], type: "specialist" });
    expect(specialist).toContain("type: specialist\n");
    expect(parseFrontMatter(specialist).frontMatter?.type).toBe("specialist");
    expect(applyProjectDetails(specialist, { ...unchanged, repos: [] })).toBe(specialist);
    const software = applyProjectDetails(specialist, { ...unchanged, repos: [], type: "software" });
    expect(software).toContain("type: software\n");
    expect(parseFrontMatter(software).frontMatter?.type).toBe("software");
    const general = applyProjectDetails(file, { ...unchanged, type: "general" });
    expect(parseFrontMatter(general).frontMatter?.type).toBe("general");
  });

  test("with no key, a change of repos alone writes the type that the project reads as now", () => {
    const software = applyProjectDetails(file, { ...unchanged, repos: [] });
    expect(software).toContain("type: software\n");
    expect(parseFrontMatter(software).frontMatter?.type).toBe("software");
    const notes = "---\nstatus: idea\n---\n# House\n";
    const general = applyProjectDetails(notes, { ...unchanged, title: "House", status: "paused", tags: [] });
    expect(parseFrontMatter(general).frontMatter).toMatchObject({ type: "general", repos: unchanged.repos });
  });

  test("with no key, a save that changes no repository leaves the file as it is", () => {
    expect(applyProjectDetails(file, { ...unchanged, type: "software" })).toBe(file);
  });
});

describe("applyProjectDetails keeps what the person did not change", () => {
  test("a heading inside a code fence stays", () => {
    const text = "---\nstatus: paused\n---\n```\n# code\n```\n\n# Old\n";
    const result = applyProjectDetails(text, { title: "New", status: "paused", tags: [], repos: [] });
    expect(result).toBe("---\nstatus: paused\n---\n```\n# code\n```\n\n# New\n");
  });

  test("a title on a file that ends right after the front matter goes on its own line", () => {
    const result = applyProjectDetails("---\nstatus: active\n---", {
      title: "New",
      status: "active",
      tags: [],
      repos: [],
    });
    expect(result).toBe("---\nstatus: active\n---\n# New\n");
  });

  test("a status that the form cannot show stays when the form sends none", () => {
    for (const text of ["---\nstatus: wip\n---\n# A\n", "---\nstatus:\n---\n# A\n"]) {
      expect(applyProjectDetails(text, { title: "B", status: null, tags: [], repos: [] })).toBe(
        text.replace("# A", "# B"),
      );
    }
  });

  test("an unchanged list is neither checked nor cleaned", () => {
    const text = '---\nstatus: paused\ntags: [my tag, "#a"]\n---\n# A\n';
    const details = { title: "B", status: "paused" as const, tags: ["my tag", "#a"], repos: [] };
    expect(applyProjectDetails(text, details)).toBe(text.replace("# A", "# B"));
  });

  test("a value that other YAML readers would not read as text gets quotes", () => {
    const result = applyProjectDetails(file, { ...unchanged, tags: ["null", "~", "true", "12", "work"] });
    expect(result).toContain('tags: ["null", "~", "true", "12", work]');
  });
});

describe("the title under a body that starts with ---", () => {
  test("the form reads the same title as the list, so a status save keeps the heading", () => {
    const text = "---\nstatus: active\n---\n---\n# Old\n---\nbody\n";
    expect(projectFileOf(text).details?.title).toBe("Old");
    expect(applyProjectDetails(text, { title: "Old", status: "paused", tags: [], repos: [] })).toBe(
      text.replace("active", "paused"),
    );
  });
});

describe("the type of each repository", () => {
  const app = "https://github.com/example/example-app";
  const api = "https://github.com/example/example-api";
  const typed = [
    "---",
    "created: 2026-01-31T09:15",
    "repos:",
    `  - ${app}`,
    `  - ${api}`,
    "repo_types:",
    `  ${app}: vibe-coded`,
    `  ${api}: standard`,
    "---",
    "# Example app",
    "",
  ].join("\n");
  const details: ProjectDetails = { title: "Example app", status: null, tags: [], repos: [app, api] };

  test("an edit of the details keeps the types, and a removed repository loses its type", () => {
    expect(applyProjectDetails(typed, details)).toBe(typed);
    const withoutApi = applyProjectDetails(typed, { ...details, repos: [app] });
    expect(parseFrontMatter(withoutApi).frontMatter?.repoTypes).toEqual({ [app]: "vibe-coded" });
    const withoutAny = applyProjectDetails(typed, { ...details, repos: [] });
    expect(withoutAny).not.toContain("repo_types");
  });

  test("setRepositoryType sets, changes and adds the key, and refuses a repository that the project does not list", () => {
    const changed = setRepositoryType(typed, api, "vibe-coded");
    expect(parseFrontMatter(changed).frontMatter?.repoTypes).toEqual({ [app]: "vibe-coded", [api]: "vibe-coded" });
    const fresh = setRepositoryType(`---\ncreated: 2026-01-31T09:15\nrepos:\n  - ${app}\n---\n# A\n`, app, "standard");
    expect(fresh).toBe(
      `---\ncreated: 2026-01-31T09:15\nrepos:\n  - ${app}\nrepo_types:\n  ${app}: standard\n---\n# A\n`,
    );
    expect(invalidCode(() => setRepositoryType(typed, "https://github.com/example/other", "standard"))).toBe(
      "project_invalid",
    );
    // A broken map would lose the other types, so the person fixes it first.
    const broken = typed.replace(`  ${api}: standard`, `  ${api}: [a, b]`);
    expect(invalidCode(() => setRepositoryType(broken, app, "standard"))).toBe("project_invalid");
  });
});

describe("the closing date of a project (#826)", () => {
  const closedFile = file.replace(
    "status: active # idea, active, paused or closed",
    "status: closed\nclosed: 2026-10-01",
  );

  test("closing writes the date that the form sends, after the status", () => {
    const result = applyProjectDetails(file, { ...unchanged, status: "closed", closed: "2026-11-03" });
    expect(result).toContain("status: closed # active, paused or closed\nclosed: 2026-11-03\n");
    expect(parseFrontMatter(result).frontMatter?.closed).toBe("2026-11-03");
  });

  test("a closed project takes another date, and keeps its date when the form sends the same one", () => {
    const same = { ...unchanged, status: "closed" as const, closed: "2026-10-01" };
    expect(applyProjectDetails(closedFile, same)).toBe(closedFile);
    expect(applyProjectDetails(closedFile, { ...same, closed: "2025-12-24" })).toBe(
      closedFile.replace("closed: 2026-10-01", "closed: 2025-12-24"),
    );
  });

  test("a project that opens again loses its closing date", () => {
    const result = applyProjectDetails(closedFile, { ...unchanged, status: "active", closed: "2026-10-01" });
    expect(result).not.toContain("closed: 2026");
    expect(result).toContain("status: active\n");
  });

  test("a form that sends no date keeps the key", () => {
    expect(applyProjectDetails(closedFile, { ...unchanged, status: "closed", title: "Other" })).toContain(
      "closed: 2026-10-01\n",
    );
    // A date in a project that is not closed stays when the status does not change.
    const handWritten = file.replace("custom: kept", "custom: kept\nclosed: 2020-01-01");
    expect(applyProjectDetails(handWritten, { ...unchanged, closed: null })).toBe(handWritten);
  });

  test("refuses a date that is not a real day", () => {
    for (const closed of ["2026-13-01", "2026-02-30", "03/11/2026", "2026-11-03T10:00"]) {
      expect(invalidCode(() => applyProjectDetails(file, { ...unchanged, status: "closed", closed }))).toBe(
        "project_invalid",
      );
    }
  });

  test("the form reads the date", () => {
    expect(projectFileOf(closedFile).details?.closed).toBe("2026-10-01");
    expect(projectFileOf(file).details?.closed).toBeNull();
  });
});

describe("the in-use flag of a project (#859)", () => {
  test("ticking In use writes the key after the status, and unticking removes it", () => {
    const used = applyProjectDetails(file, { ...unchanged, inUse: true });
    expect(used).toContain("status: active # idea, active, paused or closed\nin-use: true\n");
    expect(parseFrontMatter(used).frontMatter?.inUse).toBe(true);
    expect(applyProjectDetails(used, { ...unchanged, inUse: false })).toBe(file);
    // A page that sends no flag keeps the key.
    expect(applyProjectDetails(used, unchanged)).toBe(used);
  });

  test("a save rewrites a status of an older vault, and keeps what it meant", () => {
    const old = file.replace("status: active # idea, active, paused or closed", "status: in-use");
    const reopened = applyProjectDetails(old, { ...unchanged, status: "active", inUse: true });
    expect(reopened).toContain("status: active\nin-use: true\n");
    const unused = applyProjectDetails(old, { ...unchanged, status: "closed", inUse: false });
    expect(unused).toContain("status: closed\n");
    expect(parseFrontMatter(unused).frontMatter?.inUse).toBe(false);
    const idea = file.replace("status: active # idea, active, paused or closed", "status: idea");
    expect(applyProjectDetails(idea, { ...unchanged, status: "paused", title: "Other" })).toContain("status: paused\n");
  });

  test("a save from an older page, which sends no flag, keeps the flag of an old in-use status", () => {
    const old = file.replace("status: active # idea, active, paused or closed", "status: in-use");
    const saved = applyProjectDetails(old, { ...unchanged, status: "closed", tags: ["home"] });
    expect(saved).toContain("status: closed\nin-use: true\n");
    expect(parseFrontMatter(saved).frontMatter).toMatchObject({ status: "closed", inUse: true });
  });

  test("the form reads the flag, also from a status of an older vault", () => {
    expect(projectFileOf(file.replace("custom: kept", "custom: kept\nin-use: true")).details?.inUse).toBe(true);
    expect(
      projectFileOf(file.replace("status: active # idea, active, paused or closed", "status: in-use")).details,
    ).toMatchObject({ status: "closed", inUse: true });
  });
});
