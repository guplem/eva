/**
 * Whether Claude Code's sandbox can wall the shell of a Project chat on this computer (#711). The
 * sandbox reports nothing to Eva when it cannot start, so Eva looks for what it needs. The file
 * tools of each chat stay walled either way: only the shell can then read the vault.
 */
import { failureReason, type ProcessRunner } from "../shared/process-runner.ts";

export interface ShellWallMachine {
  readonly platform: NodeJS.Platform;
  readonly which: (program: string) => string | null;
  readonly runner: ProcessRunner;
  /** The environment of the trial run. */
  readonly environment: Readonly<Record<string, string>>;
  /** True when Eva runs as root, where Claude Code keeps one right in its box. */
  readonly root: boolean;
  /** The text of a file, or null when Eva cannot read it, such as an AppArmor file (#903). */
  readonly readText: (path: string) => string | null;
  /** The names of the files in a folder, or none when Eva cannot read it. */
  readonly listFiles: (folder: string) => readonly string[];
}

/** The bubblewrap that Claude Code's AppArmor profile names, and that Eva's install command covers. */
const bwrapPath = "/usr/bin/bwrap";
const appArmorFolder = "/etc/apparmor.d";
/** "1" where AppArmor lets a program make a user namespace only when a profile allows it. */
const restrictionFile = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
/** The mark of the profile that Eva's install command adds. `install/install.sh` uses the same text. */
const evaProfileMark = "Added by the Eva installer";

/**
 * True when an AppArmor profile in `text` attaches to bubblewrap: a profile line, not a rule, whose
 * program path ends in `bin/bwrap`, such as `/usr/bin/bwrap` or `@{bin}/bwrap`. A rule inside a
 * profile ends with a comma, a profile line with `{`. `install/install.sh` uses the same rule.
 */
export function coversBwrap(text: string): boolean {
  return /^[ \t]*(?:profile[ \t]+\S+[ \t]+)?\S*bin\S*\/bwrap(?:[ \t]+flags=\([^)]*\))?[ \t]*\{/m.test(text);
}

interface BwrapProfiles {
  /** Eva's install command added a profile. */
  readonly eva: boolean;
  /** Another profile covers bubblewrap, from the system or from the person. */
  readonly other: boolean;
}

/** The profiles for bubblewrap directly in the AppArmor folder. */
function bwrapProfiles(machine: ShellWallMachine): BwrapProfiles {
  let eva = false;
  let other = false;
  for (const name of machine.listFiles(appArmorFolder)) {
    if (name.startsWith(".")) continue;
    const text = machine.readText(`${appArmorFolder}/${name}`);
    if (text === null) continue;
    if (text.includes(evaProfileMark)) eva = true;
    else if (coversBwrap(text)) other = true;
  }
  return { eva, other };
}

/**
 * True when Eva's AppArmor profile for bubblewrap is left over next to another one, such as after
 * an upgrade to an Ubuntu that ships its own (#903). Both have the name `bwrap`, so the one that
 * loads last wins. The install command removes Eva's.
 */
export function leftoverBwrapProfile(machine: ShellWallMachine): boolean {
  if (machine.platform !== "linux") return false;
  const profiles = bwrapProfiles(machine);
  return profiles.eva && profiles.other;
}

/**
 * True when AppArmor blocks this bubblewrap and no profile lets it run, as on Ubuntu 24.04. Eva's
 * install command adds Claude Code's profile there. It covers only `/usr/bin/bwrap`.
 */
function appArmorBlocksBwrap(machine: ShellWallMachine): boolean {
  if (machine.readText(restrictionFile)?.trim() !== "1" || machine.which("bwrap") !== bwrapPath) return false;
  const profiles = bwrapProfiles(machine);
  return !profiles.eva && !profiles.other;
}

/** A trial run is quick. A machine that hangs on it has no sandbox that works. */
const trialTimeoutMs = 10_000;

/** Why the shell of a Project chat has no wall here, in words for the person. */
export interface ShellWallGap {
  readonly reason: string;
  /** False where no step of the person gives the shell a wall, such as on Windows (#825). */
  readonly fixable: boolean;
}

/** Null when the sandbox can run here, else why not. */
export async function shellWallGap(machine: ShellWallMachine): Promise<ShellWallGap | null> {
  if (machine.platform === "darwin") return null;
  if (machine.platform === "win32")
    return { reason: "Claude Code has no shell sandbox that Eva can turn on for you on Windows.", fixable: false };
  if (machine.platform !== "linux")
    return { reason: `Claude Code has no shell sandbox on ${machine.platform}.`, fixable: false };
  const reason = await linuxGap(machine);
  return reason === null ? null : { reason, fixable: true };
}

/** Null when bubblewrap can run here, else why not. */
async function linuxGap(machine: ShellWallMachine): Promise<string | null> {
  const missing = [
    ...(machine.which("bwrap") === null ? ["bubblewrap"] : []),
    ...(machine.which("socat") === null ? ["socat"] : []),
  ];
  if (missing.length > 0)
    return `Claude Code's shell sandbox needs ${missing.join(" and ")}. Run the install command of Eva again, or install them, such as with \`sudo apt install bubblewrap socat\`. Then restart Eva.`;
  // An installed bubblewrap can still fail, such as where the system allows no user namespace.
  const trial = ["bwrap", "--ro-bind", "/", "/", "--unshare-user", "--unshare-net", "true"];
  const cannot = (reason: string): string => {
    const why = `Claude Code's shell sandbox cannot start on this computer: ${reason}`;
    if (!appArmorBlocksBwrap(machine)) return why;
    return `${withFinalPeriod(why)} AppArmor blocks bubblewrap here, and no AppArmor profile lets it run. Run the install command of Eva again: it adds the profile. Then restart Eva.`;
  };
  try {
    const result = await machine.runner.run(trial, {
      cwd: "/",
      environment: machine.environment,
      timeoutMs: trialTimeoutMs,
    });
    return result.exitCode === 0 ? null : cannot(failureReason(result, "bwrap"));
  } catch (error) {
    return cannot(error instanceof Error ? error.message : String(error));
  }
}

function withFinalPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * True when a sandbox can start inside the sandbox, as Claude Code's Unix socket filter does on
 * Linux (#760). A recent Ubuntu lets bubblewrap make one user namespace but not a second inside
 * it. There, the filter breaks every shell command, so Eva turns it off. macOS makes no namespace.
 */
export async function nestedSandboxWorks(machine: ShellWallMachine): Promise<boolean> {
  if (machine.platform === "darwin") return true;
  if (machine.platform !== "linux" || machine.which("bwrap") === null) return false;
  // Claude Code drops every right in its box. As root, it keeps the one that a nested namespace
  // needs, and only when the system grants it. The trial does the same, so it sees what they see.
  const trial = [
    ...["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc"],
    ...["--unshare-user", "--unshare-net", "--cap-drop", "ALL", ...(machine.root ? ["--cap-add", "CAP_SETFCAP"] : [])],
    ...["unshare", "--user", "--map-root-user", "--pid", "--mount", "--fork", "true"],
  ];
  try {
    const result = await machine.runner.run(trial, {
      cwd: "/",
      environment: machine.environment,
      timeoutMs: trialTimeoutMs,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
