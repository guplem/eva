import { describe, expect, test } from "bun:test";
import {
  isLongHide,
  longHideMs,
  openEventStream,
  openLimitMs,
  retryDelayMs,
  type SocketHandlers,
  type StreamPlace,
} from "../../../../../src/frontends/web/client/event-stream.ts";

interface FakeSocket {
  readonly handlers: SocketHandlers;
  open: boolean;
  closed: boolean;
}

interface FakeTimer {
  readonly run: () => void;
  readonly ms: number;
  cleared: boolean;
}

/** A place whose sockets and timers the test drives by hand. */
function fakePlace(): {
  place: StreamPlace;
  sockets: FakeSocket[];
  timers: FakeTimer[];
  fire: (ms: number) => void;
  failNextOpen: () => void;
} {
  const sockets: FakeSocket[] = [];
  const timers: FakeTimer[] = [];
  let failures = 0;
  const place: StreamPlace = {
    open: (handlers) => {
      // The WebSocket constructor throws on an address that it refuses.
      if (failures > 0) {
        failures -= 1;
        throw new Error("The URL is not valid.");
      }
      const socket: FakeSocket = { handlers, open: false, closed: false };
      sockets.push(socket);
      return {
        isOpen: () => socket.open,
        close: () => {
          socket.closed = true;
        },
      };
    },
    setTimer: (run, ms) => {
      const timer: FakeTimer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      if (timer !== undefined) (timer as FakeTimer).cleared = true;
    },
  };
  // Runs each live timer of this length once.
  const fire = (ms: number): void => {
    for (const timer of timers.filter((entry) => entry.ms === ms && !entry.cleared)) {
      timer.cleared = true;
      timer.run();
    }
  };
  return {
    place,
    sockets,
    timers,
    fire,
    failNextOpen: () => {
      failures += 1;
    },
  };
}

function opened(socket: FakeSocket | undefined): void {
  if (socket === undefined) throw new Error("no socket");
  socket.open = true;
  socket.handlers.onOpen();
}

describe("openEventStream", () => {
  test("passes each frame to the page", () => {
    const { place, sockets } = fakePlace();
    const events: unknown[] = [];
    openEventStream(
      place,
      (event) => events.push(event),
      () => undefined,
    );
    sockets[0]?.handlers.onMessage(JSON.stringify({ kind: "turn_started" }));
    expect(events).toEqual([{ kind: "turn_started" }]);
  });

  test("skips a frame that is not JSON, and keeps the next one", () => {
    const { place, sockets } = fakePlace();
    const events: unknown[] = [];
    openEventStream(
      place,
      (event) => events.push(event),
      () => undefined,
    );
    expect(() => sockets[0]?.handlers.onMessage("{not json")).not.toThrow();
    sockets[0]?.handlers.onMessage(JSON.stringify({ kind: "turn_finished" }));
    expect(events).toEqual([{ kind: "turn_finished" }]);
  });

  test("reports the connection, and connects again after a drop", () => {
    const { place, sockets, fire } = fakePlace();
    const changes: boolean[] = [];
    openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    opened(sockets[0]);
    sockets[0]?.handlers.onClose();
    expect(changes).toEqual([true, false]);
    expect(sockets).toHaveLength(1);
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
  });

  test("starts again when the socket does not open in time", () => {
    const { place, sockets, fire } = fakePlace();
    openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    fire(openLimitMs);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
    // The late close of the old socket starts no second try.
    sockets[0]?.handlers.onClose();
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
  });

  test("keeps a socket that opened in time", () => {
    const { place, sockets, fire } = fakePlace();
    openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    opened(sockets[0]);
    fire(openLimitMs);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closed).toBe(false);
  });

  test("a socket that closes before it opens waits for the retry, not the open limit", () => {
    const { place, sockets, fire } = fakePlace();
    openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    sockets[0]?.handlers.onClose();
    fire(openLimitMs);
    expect(sockets).toHaveLength(1);
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
  });

  test("retryNow connects at once, and leaves an open socket alone", () => {
    const { place, sockets, fire } = fakePlace();
    const stream = openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    sockets[0]?.handlers.onClose();
    stream.retryNow();
    expect(sockets).toHaveLength(2);
    // The timed try of the drop no longer runs.
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
    opened(sockets[1]);
    stream.retryNow();
    expect(sockets).toHaveLength(2);
  });

  test("ignores a late open and a late frame of a socket that a new try replaced", () => {
    const { place, sockets, fire } = fakePlace();
    const changes: boolean[] = [];
    const events: unknown[] = [];
    const stream = openEventStream(
      place,
      (event) => events.push(event),
      (connected) => changes.push(connected),
    );
    stream.retryNow();
    opened(sockets[0]);
    sockets[0]?.handlers.onMessage(JSON.stringify({ kind: "turn_started" }));
    expect(changes).toEqual([]);
    expect(events).toEqual([]);
    // The open timer of the new socket still runs.
    fire(openLimitMs);
    expect(sockets).toHaveLength(3);
  });

  test("two quick tries leave one live socket, and the late closes start no timer", () => {
    const { place, sockets, fire } = fakePlace();
    const stream = openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    stream.retryNow();
    stream.retryNow();
    expect(sockets).toHaveLength(3);
    expect(sockets.map((socket) => socket.closed)).toEqual([true, true, false]);
    sockets[0]?.handlers.onClose();
    sockets[1]?.handlers.onClose();
    fire(retryDelayMs);
    expect(sockets).toHaveLength(3);
  });

  test("close stops every later try", () => {
    const { place, sockets, fire } = fakePlace();
    const changes: boolean[] = [];
    const stream = openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    stream.close();
    expect(sockets[0]?.closed).toBe(true);
    sockets[0]?.handlers.onClose();
    fire(openLimitMs);
    fire(retryDelayMs);
    stream.retryNow();
    expect(sockets).toHaveLength(1);
    expect(changes).toEqual([]);
  });

  test("reconnect replaces a socket that reads open, which a network change can leave dead", () => {
    const { place, sockets, fire } = fakePlace();
    const changes: boolean[] = [];
    const stream = openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    opened(sockets[0]);
    stream.reconnect();
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
    // The late close of the dead socket starts no retry, and the page hears of the new socket.
    sockets[0]?.handlers.onClose();
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
    opened(sockets[1]);
    expect(changes).toEqual([true, true]);
  });

  test("reconnect does nothing after close", () => {
    const { place, sockets } = fakePlace();
    const stream = openEventStream(
      place,
      () => undefined,
      () => undefined,
    );
    stream.close();
    stream.reconnect();
    expect(sockets).toHaveLength(1);
  });

  test("a new socket that hangs shows the page offline once, until a socket opens", () => {
    const { place, sockets, fire } = fakePlace();
    const changes: boolean[] = [];
    const stream = openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    opened(sockets[0]);
    stream.reconnect();
    fire(openLimitMs);
    expect(changes).toEqual([true, false]);
    // The next try hangs too: the page already shows offline.
    fire(openLimitMs);
    expect(changes).toEqual([true, false]);
    opened(sockets[3]);
    expect(changes).toEqual([true, false, true]);
  });

  test("a first socket that hangs shows the page offline", () => {
    const { place, fire } = fakePlace();
    const changes: boolean[] = [];
    openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    fire(openLimitMs);
    expect(changes).toEqual([false]);
  });

  test("a socket that the browser refuses to make shows offline and tries again later", () => {
    const { place, sockets, fire, failNextOpen } = fakePlace();
    const changes: boolean[] = [];
    failNextOpen();
    const stream = openEventStream(
      place,
      () => undefined,
      (connected) => changes.push(connected),
    );
    expect(changes).toEqual([false]);
    expect(sockets).toHaveLength(0);
    fire(retryDelayMs);
    expect(sockets).toHaveLength(1);
    opened(sockets[0]);
    failNextOpen();
    stream.reconnect();
    expect(sockets[0]?.closed).toBe(true);
    expect(changes).toEqual([false, true, false]);
    fire(retryDelayMs);
    expect(sockets).toHaveLength(2);
  });
});

describe("isLongHide", () => {
  test("is true only when the page was hidden for the long time or more", () => {
    expect(isLongHide(null, 100_000)).toBe(false);
    expect(isLongHide(100_000, 100_000 + longHideMs - 1)).toBe(false);
    expect(isLongHide(100_000, 100_000 + longHideMs)).toBe(true);
  });
});
