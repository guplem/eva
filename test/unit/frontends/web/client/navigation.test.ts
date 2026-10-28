import { describe, expect, test } from "bun:test";
import {
  addressOf,
  assistantChatAddressOf,
  assistantChatIdOf,
  chatsTapAgain,
  destinations,
  destinationOf,
  linkedChatIdOf,
  navBadges,
  newChatPageId,
  projectAddressOf,
  projectRouteOf,
  type ProjectRoute,
} from "../../../../../src/frontends/web/client/navigation.ts";

describe("destinationOf", () => {
  test("each destination opens from its own address", () => {
    for (const destination of destinations) expect(destinationOf(addressOf(destination.id))).toBe(destination.id);
  });

  test("an empty or unknown address opens Chats", () => {
    expect(destinationOf("")).toBe("chats");
    expect(destinationOf("#")).toBe("chats");
    expect(destinationOf("#/nothing-here")).toBe("chats");
  });

  test("the visor's notification center has its own address (#566)", () => {
    expect(destinationOf(addressOf("notifications"))).toBe("notifications");
    expect(addressOf("notifications")).toBe("#/notifications");
  });

  test("a Settings section address opens Settings", () => {
    expect(destinationOf("#/settings/remote-access")).toBe("settings");
  });

  test("a name that only starts like a destination does not open it", () => {
    expect(destinationOf("#/settingsx")).toBe("chats");
  });

  test("a chat link has no destination of its own: its chat decides", () => {
    expect(destinationOf("#/chat/abc")).toBeNull();
  });
});

describe("addressOf", () => {
  test("each destination has an address under #/", () => {
    expect(destinations.map((destination) => addressOf(destination.id))).toEqual([
      "#/chats",
      "#/projects",
      "#/files",
      "#/schedules",
      "#/settings",
    ]);
  });
});

describe("linkedChatIdOf", () => {
  test("reads the chat id of a #/chat/<id> link", () => {
    expect(linkedChatIdOf("#/chat/abc%20def")).toBe("abc def");
  });

  test("is null for any other address", () => {
    expect(linkedChatIdOf("#/chats")).toBeNull();
    expect(linkedChatIdOf("#/chat/")).toBeNull();
    expect(linkedChatIdOf("#/chat/a/b")).toBeNull();
  });
});

describe("chatsTapAgain", () => {
  test("a phone shows the hidden chat list", () => {
    expect(chatsTapAgain(true)).toBe("show-list");
  });

  test("a computer always shows the list, so it opens a new chat", () => {
    expect(chatsTapAgain(false)).toBe("new-chat");
  });
});

describe("assistantChatIdOf and assistantChatAddressOf", () => {
  test("a chat of Chats has an address that reads back", () => {
    expect(assistantChatAddressOf("abc def")).toBe("#/chats/abc%20def");
    expect(assistantChatIdOf("#/chats/abc%20def")).toBe("abc def");
  });

  test("Chats with no chat named opens the newest chat", () => {
    expect(assistantChatAddressOf(null)).toBe("#/chats");
    expect(assistantChatIdOf("#/chats")).toBeNull();
    expect(assistantChatIdOf("#/chat/abc")).toBeNull();
  });

  test("the New chat page has an address of Chats, so Back and a reload keep it", () => {
    expect(assistantChatAddressOf(newChatPageId)).toBe("#/chats/new");
    expect(assistantChatIdOf("#/chats/new")).toBe(newChatPageId);
    expect(destinationOf("#/chats/new")).toBe("chats");
  });

  test("a chat address opens Chats", () => {
    expect(destinationOf("#/chats/abc")).toBe("chats");
  });
});

describe("projectRouteOf and projectAddressOf", () => {
  const routes: ProjectRoute[] = [
    { kind: "list" },
    { kind: "project", projectId: "2025-03-02-1015-example-app" },
    { kind: "details", projectId: "2025-03-02-1015-example-app" },
    { kind: "setup", projectId: "2025-03-02-1015-example-app" },
    { kind: "chat", projectId: "2025-03-02-1015-example-app", chatId: "a b" },
  ];

  test("each page of Projects has an address that reads back", () => {
    for (const route of routes) expect(projectRouteOf(projectAddressOf(route))).toEqual(route);
  });

  test("the addresses nest, so a chat's address starts with its project's", () => {
    expect(routes.map(projectAddressOf)).toEqual([
      "#/projects",
      "#/projects/2025-03-02-1015-example-app",
      "#/projects/2025-03-02-1015-example-app/details",
      "#/projects/2025-03-02-1015-example-app/setup",
      "#/projects/2025-03-02-1015-example-app/chat/a%20b",
    ]);
  });

  test("an unknown page of a project opens the list", () => {
    expect(projectRouteOf("#/projects/p/other")).toEqual({ kind: "list" });
    expect(projectRouteOf("#/chats")).toEqual({ kind: "list" });
  });

  test("each page opens Projects", () => {
    for (const route of routes) expect(destinationOf(projectAddressOf(route))).toBe("projects");
  });
});

describe("navBadges", () => {
  const none = { approvals: 0, setupMissing: 0, unreadChats: 0, unreadProjectChats: 0 };

  test("shows nothing when nothing waits", () => {
    expect(navBadges(none)).toEqual({});
  });

  test("counts the unread chats on Chats and on Projects (#614)", () => {
    expect(navBadges({ ...none, unreadChats: 2, unreadProjectChats: 1 })).toEqual({
      chats: { count: 2, words: "unread chats", tone: "news" },
      projects: { count: 1, words: "unread chat", tone: "news" },
    });
  });

  test("a waiting approval wins on Chats, and its words still name the unread chats", () => {
    expect(navBadges({ ...none, approvals: 1, unreadChats: 3, setupMissing: 2 })).toEqual({
      chats: { count: 1, words: "approval waits, 3 unread chats", tone: "warn" },
      settings: { count: 2, words: "to set up", tone: "warn" },
    });
  });
});
