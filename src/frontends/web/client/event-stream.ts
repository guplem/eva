/**
 * The event stream of the page: one socket to Eva that opens again after each drop. A phone
 * drops it when it sleeps or changes networks, so the stream must come back without a tap.
 */

/** An address that left the network can hang while it opens, with no close: try again after this time. */
export const openLimitMs = 10_000;

/** The wait before the next try after a drop. */
export const retryDelayMs = 2_000;

export interface SocketHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (data: string) => void;
  readonly onClose: () => void;
}

export interface StreamSocket {
  readonly isOpen: () => boolean;
  readonly close: () => void;
}

/** The browser parts that the stream uses: a socket to Eva and the timers. */
export interface StreamPlace {
  readonly open: (handlers: SocketHandlers) => StreamSocket;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface EventSubscription {
  readonly close: () => void;
  /** Tries to connect at once, instead of at the next timed try. */
  readonly retryNow: () => void;
  /**
   * Opens a new socket at once, also when the current one reads open. After a network change a
   * socket can read open but be dead, and the browser sees it only minutes later.
   */
  readonly reconnect: () => void;
}

/** Opens the event stream, and opens it again after a drop or a hung open. */
export function openEventStream(
  place: StreamPlace,
  onEvent: (event: unknown) => void,
  onConnectionChange: (isConnected: boolean) => void,
): EventSubscription {
  let socket: StreamSocket | null = null;
  let closed = false;
  let retryTimer: unknown;
  let openTimer: unknown;
  // What the page last heard, or null before the first word.
  let shown: boolean | null = null;
  const report = (isConnected: boolean): void => {
    shown = isConnected;
    onConnectionChange(isConnected);
  };

  const reconnect = (): void => {
    const stale = socket;
    place.clearTimer(retryTimer);
    connect();
    stale?.close();
  };

  const retryNow = (): void => {
    if (socket?.isOpen() !== true) reconnect();
  };

  const connect = (): void => {
    retryTimer = undefined;
    place.clearTimer(openTimer);
    // A retry that a timer started can run after the page closed the stream, such as at a logout.
    if (closed) return;
    // A socket that a new try replaced can still open, send or close late. It must change nothing.
    let opened: StreamSocket | null = null;
    const isCurrent = (): boolean => !closed && opened !== null && socket === opened;
    try {
      opened = place.open(handlersFor(isCurrent));
    } catch {
      // The browser refused to make the socket. Without a timer the stream would stay dead until a reload.
      socket = null;
      if (shown !== false) report(false);
      retryTimer = place.setTimer(connect, retryDelayMs);
      return;
    }
    socket = opened;
    openTimer = place.setTimer(onOpenLimit, openLimitMs);
  };

  // A socket that hangs while it opens can hang again and again, with no close: the page must still show offline.
  const onOpenLimit = (): void => {
    if (shown !== false) report(false);
    reconnect();
  };

  const handlersFor = (isCurrent: () => boolean): SocketHandlers => ({
    onOpen: () => {
      if (!isCurrent()) return;
      place.clearTimer(openTimer);
      report(true);
    },
    onMessage: (data) => {
      if (!isCurrent()) return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        // One bad frame must not break the page. The next recovery reads the state again.
        return;
      }
      onEvent(event);
    },
    onClose: () => {
      if (!isCurrent()) return;
      place.clearTimer(openTimer);
      report(false);
      retryTimer = place.setTimer(connect, retryDelayMs);
    },
  });

  connect();
  return {
    close: () => {
      closed = true;
      place.clearTimer(retryTimer);
      place.clearTimer(openTimer);
      socket?.close();
    },
    retryNow,
    reconnect,
  };
}

/**
 * A page hidden this long may have a dead socket that still reads open: the phone slept, or
 * changed networks. A quick switch of tabs stays under it, so it does not replace a good socket.
 */
export const longHideMs = 30_000;

/** True when the page, hidden at `hiddenAt`, was hidden for `longHideMs` or more. */
export function isLongHide(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= longHideMs;
}
