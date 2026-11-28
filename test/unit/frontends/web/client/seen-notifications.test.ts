import { describe, expect, test } from "bun:test";
import {
  closeSeenNotifications,
  type NotificationShelf,
  type SeenChat,
} from "../../../../../src/frontends/web/client/seen-notifications.ts";

function shelf(tags: readonly string[]): { readonly shelf: NotificationShelf; readonly closed: string[] } {
  const closed: string[] = [];
  return {
    closed,
    shelf: {
      shown: () => Promise.resolve(tags.map((tag) => ({ tag, shownAt: 100, close: () => closed.push(tag) }))),
    },
  };
}

const chat = (id: string, facts: { turnCount?: number; seenTurns?: number; running?: boolean } = {}): SeenChat => ({
  id,
  reportsTo: null,
  turnCount: 2,
  seenTurns: 2,
  running: false,
  ...facts,
});

describe("the notifications of this device, after a fresh list of chats (#1136)", () => {
  test("close for a chat that the person saw, on this device or another", async () => {
    const device = shelf(["chat:seen", "chat:unread"]);
    await closeSeenNotifications([chat("seen"), chat("unread", { seenTurns: 1 })], device.shelf, 200);
    expect(device.closed).toEqual(["chat:seen"]);
  });

  test("stay for a chat that works: its approval waits, or its answer is not in the list yet", async () => {
    const device = shelf(["chat:working"]);
    await closeSeenNotifications([chat("working", { running: true })], device.shelf, 200);
    expect(device.closed).toEqual([]);
  });

  test("stay when they are newer than the read of the list, which cannot know their answer", async () => {
    const device = shelf(["chat:seen"]);
    await closeSeenNotifications([chat("seen")], device.shelf, 99);
    expect(device.closed).toEqual([]);
  });

  test("close for a chat that is gone", async () => {
    const device = shelf(["chat:deleted"]);
    await closeSeenNotifications([chat("other")], device.shelf, 200);
    expect(device.closed).toEqual(["chat:deleted"]);
  });

  test("stay when they are not of a chat: a problem alert closes on a tap only", async () => {
    const device = shelf(["vault_sync", "eva", "schedule:daily", ""]);
    await closeSeenNotifications([], device.shelf, 200);
    expect(device.closed).toEqual([]);
  });

  test("a browser that cannot list them changes nothing", async () => {
    await closeSeenNotifications([chat("seen")], { shown: () => Promise.reject(new Error("no worker")) }, 200);
  });
});
