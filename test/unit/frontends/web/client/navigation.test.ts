import { describe, expect, test } from "bun:test";
import {
  addressOf,
  chatsTapAgain,
  destinations,
  destinationOf,
  linkedChatIdOf,
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
