import { describe, expect, test } from "bun:test";
import { activeMs, PersonActivity } from "../../../../../src/frontends/web/client/person-activity.ts";

describe("the person's activity on the page (#1136)", () => {
  test("lasts 5 minutes after the last input, and the page's start counts as one", () => {
    let now = 1_000;
    const activity = new PersonActivity(() => now);
    now += activeMs - 1;
    expect(activity.isActive()).toBe(true);
    now += 1;
    expect(activity.isActive()).toBe(false);
    activity.input();
    expect(activity.isActive()).toBe(true);
  });

  test("tells its listeners when the person comes back, and not at each input", () => {
    let now = 0;
    const activity = new PersonActivity(() => now);
    let backs = 0;
    const stop = activity.onBack(() => {
      backs += 1;
    });
    activity.input();
    expect(backs).toBe(0);
    now += activeMs;
    activity.input();
    activity.input();
    expect(backs).toBe(1);
    stop();
    now += activeMs;
    activity.input();
    expect(backs).toBe(1);
  });
});
