import { describe, expect, test } from "bun:test";
import {
  bellName,
  hiddenUnreadChats,
  homeGearName,
  visorName,
  navVisorProjectEyes,
  navVisorState,
  tapFace,
  visorSignal,
  type NavVisorInput,
} from "../../../../../src/frontends/web/client/nav-visor.ts";
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
  const quiet = {
    unreadProblems: 0,
    unreadError: false,
    news: false,
    offline: false,
    centerOpen: false,
    hiddenUnread: 0,
  };

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

  test("offline shows the dot, so the person looks in the center for the reason (#853)", () => {
    expect(visorSignal({ ...quiet, offline: true })).toEqual({ count: 0, dot: true, alarm: false });
    expect(visorSignal({ ...quiet, offline: true, unreadProblems: 1 }).dot).toBe(false);
  });
});

describe("tapFace", () => {
  test("picks each playful face from the random number", () => {
    expect(tapFace(() => 0)).toBe("happy");
    expect(tapFace(() => 0.999)).toBe("surprised");
  });

  test("never repeats the face of the last tap, so each tap looks different", () => {
    const last = "happy";
    expect(tapFace(() => 0, last)).not.toBe(last);
  });
});

describe("navVisorProjectEyes", () => {
  test("gives the visor the Project eyes on a phone in Projects, because a phone chat shows no visor beside an answer", () => {
    expect(navVisorProjectEyes("projects", true)).toBe(true);
  });

  test("keeps the standard eyes on a phone outside Projects", () => {
    expect(navVisorProjectEyes("chats", true)).toBe(false);
    expect(navVisorProjectEyes("notifications", true)).toBe(false);
  });

  test("keeps the standard eyes on a computer, which shows the visor beside each answer", () => {
    expect(navVisorProjectEyes("projects", false)).toBe(false);
  });
});

describe("bellName (#761)", () => {
  const signal = { count: 0, dot: false, alarm: false };

  test("names the bell, and says nothing more when nothing waits", () => {
    expect(bellName(signal)).toBe("Notifications");
  });

  test("says the count of the unread problems, as the visor does", () => {
    expect(bellName({ ...signal, count: 1 })).toBe("Notifications: 1 problem needs you");
    expect(bellName({ ...signal, count: 2, alarm: true })).toBe("Notifications: 2 problems need you");
  });

  test("says that something new waits when the dot shows", () => {
    expect(bellName({ ...signal, dot: true })).toBe("Notifications: something new waits");
  });

  test("the count comes before the dot, as on the visor", () => {
    expect(bellName({ count: 1, dot: true, alarm: false })).toBe("Notifications: 1 problem needs you");
  });
});

describe("an unread chat whose entry is hidden (#911)", () => {
  const counts = { unreadChats: 2, unreadProjectChats: 1 };

  test("counts only the unread chats whose entry the navigation does not show", () => {
    expect(hiddenUnreadChats({ ...counts, shown: ["chats", "projects"] })).toBe(0);
    expect(hiddenUnreadChats({ ...counts, shown: ["projects"] })).toBe(2);
    expect(hiddenUnreadChats({ ...counts, shown: ["chats"] })).toBe(1);
    expect(hiddenUnreadChats({ ...counts, shown: [] })).toBe(3);
  });

  test("shows the dot of the visor, and the count keeps its meaning", () => {
    const quiet = {
      unreadProblems: 0,
      unreadError: false,
      news: false,
      offline: false,
      centerOpen: false,
      hiddenUnread: 0,
    };
    expect(visorSignal({ ...quiet, hiddenUnread: 1 })).toEqual({ count: 0, dot: true, alarm: false });
    expect(visorSignal({ ...quiet, hiddenUnread: 1, unreadProblems: 2 })).toEqual({
      count: 2,
      dot: false,
      alarm: false,
    });
  });

  test("the name of the visor says that a chat waits, also beside a count", () => {
    const signal = { count: 0, dot: false, alarm: false };
    expect(visorName("Eva is online", signal, 0)).toBe("Eva: Eva is online");
    expect(visorName("Eva is online", { ...signal, dot: true }, 0)).toBe("Eva: Eva is online. Something new waits");
    expect(visorName("Eva is online", { ...signal, dot: true }, 1)).toBe("Eva: Eva is online. 1 unread chat");
    expect(visorName("1 problem needs you", { ...signal, count: 1 }, 2)).toBe(
      "Eva: 1 problem needs you. 2 unread chats",
    );
  });
});

describe("homeGearName (#911)", () => {
  test("names the gear, and says how many setup steps are left", () => {
    expect(homeGearName(0)).toBe("Settings");
    expect(homeGearName(1)).toBe("Settings: 1 to set up");
    expect(homeGearName(3)).toBe("Settings: 3 to set up");
  });
});
