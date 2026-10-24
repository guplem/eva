# Plan: a stale lock with a reused pid on Windows (#528)

## Motivation

After a power loss on Windows, another process can get Eva's old pid. The lock then looks live, Eva exits with code 3, and the service never starts her again. Only a terminal can fix it. This breaks "Eva works from a phone".

## Design: a heartbeat that Eva watches, never a clock

- The live core touches the lock file every 5 seconds. A touch changes only the file time.
- A new lock holds a third line, `heartbeat`. The line tells a lock that gets touches from a lock of an older Eva.
- A start finds a lock whose pid runs, and the boot id cannot decide. The start then watches the file time for 60 seconds.
  - The file time changes: the holder is a live Eva. The start exits with `instance_locked`.
  - The file time stays the same: the holder is not Eva. The start takes over the lock.
- The watch compares one file time with the next one. It never compares a file time with the clock, so a clock step cannot make a live lock look stale.
- A live holder answers within one beat, so a real second start stops after about 5 seconds. Only a stale lock costs the full minute.

## Decisions

- **Heartbeat, not the process image name or start time.** A heartbeat needs no child process and no PowerShell. It works the same on each platform, and fakes test it fully.
- **Watch only when the boot id cannot decide.** On Linux, the boot id already finds a lock from an earlier boot. A second start there still stops at once.
- **A lock without the `heartbeat` line keeps the old rule (pid only).** An Eva from before this change does not touch her lock, so a start must not take it over.
- **Release removes the lock only while it still names this core.** A core never deletes the lock of another core.
- **`runningInstancePid` stays synchronous and pid-only.** The CLI commands use it to show state. A wrong "runs" lasts only until the service starts Eva again.

## Gaps and limits

- A core whose event loop blocks for a whole minute looks stale. No Eva code blocks that long.
- A suspend in the middle of a watch can end the watch before the holder's first touch after the wake. This needs a second start at the exact moment of a suspend.
