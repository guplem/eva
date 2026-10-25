import { describe, expect, test } from "bun:test";
import { navVisorState, visorSignal, type NavVisorInput } from "../../../../../src/frontends/web/client/nav-visor.ts";
import { stateFaces } from "../../../../../src/frontends/web/client/visor-faces.ts";

const calm: NavVisorInput = {
  isConnected: true,
  approvals: 0,
  problems: 0,
  unreadProblems: 0,
  assistantTurns: 0,
  projectTurns: 0,
  chatBlocked: false,
};

describe("navVisorState", () => {
  test("with nothing going on, EVE rests at the idle face", () => {
    expect(navVisorState(calm)).toEqual({ face: stateFaces.idle, words: "Eva is online, and nothing runs" });
  });

  test("offline comes before everything else", () => {
    const state = navVisorState({ ...calm, isConnected: false, approvals: 2, assistantTurns: 1 });
    expect(state).toEqual({ face: stateFaces.offline, words: "Eva does not answer" });
  });

  test("an approval that waits comes before a running turn", () => {
    expect(navVisorState({ ...calm, approvals: 1, assistantTurns: 1 })).toEqual({
      face: stateFaces.asksPermission,
      words: "1 approval waits for you",
    });
    expect(navVisorState({ ...calm, approvals: 3 }).words).toBe("3 approvals wait for you");
  });

  test("an open problem comes before a running turn", () => {
    expect(navVisorState({ ...calm, problems: 1, unreadProblems: 1, projectTurns: 1 })).toEqual({
      face: stateFaces.broken,
      words: "1 problem needs you",
    });
    expect(navVisorState({ ...calm, problems: 2, unreadProblems: 2 }).words).toBe("2 problems need you");
  });

  test("a problem that the person read keeps the face, and the words say it is open (#566)", () => {
    expect(navVisorState({ ...calm, problems: 1 })).toEqual({ face: stateFaces.broken, words: "1 open problem" });
    expect(navVisorState({ ...calm, problems: 3, unreadProblems: 1 }).words).toBe("1 problem needs you");
  });

  test("a project turn looks focused, and an assistant turn thinks", () => {
    expect(navVisorState({ ...calm, projectTurns: 1 })).toEqual({
      face: stateFaces.projectWork,
      words: "Eva works on 1 chat",
    });
    expect(navVisorState({ ...calm, assistantTurns: 2 })).toEqual({
      face: stateFaces.thinking,
      words: "Eva works on 2 chats",
    });
    expect(navVisorState({ ...calm, assistantTurns: 1, projectTurns: 1 })).toEqual({
      face: stateFaces.projectWork,
      words: "Eva works on 2 chats",
    });
  });

  test("a setup step that stops the chats comes after the problems, before a turn", () => {
    expect(navVisorState({ ...calm, chatBlocked: true, assistantTurns: 1 })).toEqual({
      face: stateFaces.notSetUp,
      words: "A setup step stops the chats",
    });
    expect(navVisorState({ ...calm, chatBlocked: true, problems: 1 }).face).toBe(stateFaces.broken);
  });
});

describe("visorSignal (#566)", () => {
  const quiet = { unreadProblems: 0, unreadError: false, news: false, centerOpen: false };

  test("counts the unread problems, and an unread error pulses", () => {
    expect(visorSignal({ ...quiet, unreadProblems: 2 })).toEqual({ count: 2, dot: false, alarm: false });
    expect(visorSignal({ ...quiet, unreadProblems: 1, unreadError: true })).toEqual({
      count: 1,
      dot: false,
      alarm: true,
    });
  });

  test("the error stays still while the center is open", () => {
    expect(visorSignal({ ...quiet, unreadProblems: 1, unreadError: true, centerOpen: true }).alarm).toBe(false);
  });

  test("news or a setup step shows a dot only when no problem is counted", () => {
    expect(visorSignal({ ...quiet, news: true })).toEqual({ count: 0, dot: true, alarm: false });
    expect(visorSignal({ ...quiet, news: true, unreadProblems: 1 }).dot).toBe(false);
    expect(visorSignal(quiet)).toEqual({ count: 0, dot: false, alarm: false });
  });
});
