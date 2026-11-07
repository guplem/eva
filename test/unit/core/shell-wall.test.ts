import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  coversBwrap,
  evaProfileMark,
  leftoverBwrapProfile,
  nestedSandboxWorks,
  shellWallGap,
  type ShellWallMachine,
} from "../../../src/core/shell-wall.ts";
import { EvaError } from "../../../src/shared/errors.ts";
import type { ProcessResult } from "../../../src/shared/process-runner.ts";

const found =
  (names: readonly string[]) =>
  (name: string): string | null =>
    names.includes(name) ? `/usr/bin/${name}` : null;

const restrictionFile = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/** The profile of Claude Code's docs, as Eva's install command writes it (#903). */
const evaProfile = [
  "# Added by the Eva installer (#903). It lets bubblewrap make a user namespace.",
  "abi <abi/4.0>,",
  "include <tunables/global>",
  "profile bwrap /usr/bin/bwrap flags=(unconfined) {",
  "  userns,",
  "  include if exists <local/bwrap>",
  "}",
].join("\n");

/** A profile that a newer Ubuntu ships for bubblewrap. */
const systemProfile =
  "abi <abi/4.0>,\nprofile bwrap /usr/bin/bwrap flags=(attach_disconnected) {\n  allow userns,\n}\n";

/** A machine whose trial run of bubblewrap gives `reply`, with the given files. */
function machine(
  platform: NodeJS.Platform,
  names: readonly string[],
  reply: () => ProcessResult = () => ({ exitCode: 0, stdout: "", stderr: "" }),
  files: Readonly<Record<string, string>> = {},
): ShellWallMachine & { readonly runs: (readonly string[])[] } {
  const runs: (readonly string[])[] = [];
  return {
    platform,
    which: found(names),
    environment: {},
    root: false,
    runs,
    runner: {
      run: (command) => {
        runs.push(command);
        return Promise.resolve().then(reply);
      },
    },
    readText: (path) => files[path] ?? null,
    listFiles: (folder) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${folder}/`))
        .map((path) => path.slice(folder.length + 1)),
  };
}

/** The reply of bubblewrap where Ubuntu 24.04 blocks it. */
const blockedByAppArmor = (): ProcessResult => ({
  exitCode: 1,
  stdout: "",
  stderr: "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted",
});

/** The files of a fresh Ubuntu 24.04, where AppArmor restricts user namespaces. */
const ubuntu2404: Readonly<Record<string, string>> = {
  [restrictionFile]: "1\n",
  "/etc/apparmor.d/unprivileged_userns": "profile unprivileged_userns {\n  allow userns,\n}\n",
  "/usr/sbin/apparmor_parser": "",
};

async function reasonOf(
  files: Readonly<Record<string, string>>,
  reply: () => ProcessResult = blockedByAppArmor,
  which = found(["bwrap", "socat"]),
): Promise<string> {
  const gap = await shellWallGap({ ...machine("linux", [], reply, files), which });
  return gap?.reason ?? "";
}

describe("shellWallGap where AppArmor blocks bubblewrap (#903)", () => {
  test("Ubuntu 24.04, with no profile for bubblewrap, names the profile and the install command", async () => {
    const reason = await reasonOf(ubuntu2404);
    expect(reason).toContain("AppArmor");
    expect(reason).toContain("Run the install command of Eva again");
    expect(reason).toContain("Then restart Eva.");
    // The error of bubblewrap stays, so the person can search it.
    expect(reason).toContain("RTM_NEWADDR");
  });

  test("a trial that hangs there names the profile too", async () => {
    const hangs = (): ProcessResult => {
      throw new EvaError("process_timeout", "bwrap did not end in time.");
    };
    expect(await reasonOf(ubuntu2404, hangs)).toContain("Run the install command of Eva again");
  });

  test("where the install command would add nothing, the reason stays plain", async () => {
    const plain = async (files: Readonly<Record<string, string>>, which = found(["bwrap", "socat"])): Promise<void> => {
      expect(await reasonOf(files, blockedByAppArmor, which)).not.toContain("AppArmor");
    };
    // The system has its own profile, or no restriction.
    await plain({ ...ubuntu2404, "/etc/apparmor.d/bwrap-userns-restrict": systemProfile });
    await plain({ ...ubuntu2404, [restrictionFile]: "0" });
    await plain({});
    // A bubblewrap outside /usr/bin, which the profile does not cover.
    const local = (name: string): string | null => (name === "bwrap" ? "/usr/local/bin/bwrap" : `/usr/bin/${name}`);
    await plain(ubuntu2404, local);
    // No AppArmor parser, or no AppArmor folder.
    const { ["/usr/sbin/apparmor_parser"]: _parser, ...noParser } = ubuntu2404;
    await plain(noParser);
    await plain({ [restrictionFile]: "1", "/usr/sbin/apparmor_parser": "" });
    // Eva's profile is there but does not work, such as one that did not load: running the install
    // again changes nothing.
    await plain({ ...ubuntu2404, "/etc/apparmor.d/bwrap": evaProfile });
    // The person's own file, which the install command never writes over.
    await plain({ ...ubuntu2404, "/etc/apparmor.d/bwrap": "@{exec_path} = /usr/bin/bwrap\n" });
  });
});

describe("leftoverBwrapProfile (#903)", () => {
  test("Eva's profile next to the system's own is left over", () => {
    expect(
      leftoverBwrapProfile(
        machine("linux", [], undefined, {
          "/etc/apparmor.d/bwrap": evaProfile,
          "/etc/apparmor.d/bwrap-userns-restrict": systemProfile,
        }),
      ),
    ).toBe(true);
  });

  test("Eva's profile alone, the system's alone, or another system is not", () => {
    expect(leftoverBwrapProfile(machine("linux", [], undefined, { "/etc/apparmor.d/bwrap": evaProfile }))).toBe(false);
    expect(leftoverBwrapProfile(machine("linux", [], undefined, { "/etc/apparmor.d/b": systemProfile }))).toBe(false);
    // The person's own copy of Claude Code's profile has no mark: it is theirs, not Eva's.
    const theirs = evaProfile.split("\n").slice(1).join("\n");
    expect(leftoverBwrapProfile(machine("linux", [], undefined, { "/etc/apparmor.d/bwrap": theirs }))).toBe(false);
    expect(
      leftoverBwrapProfile(
        machine("win32", [], undefined, { "/etc/apparmor.d/bwrap": evaProfile, "/etc/apparmor.d/b": systemProfile }),
      ),
    ).toBe(false);
  });

  test("a profile that AppArmor skips at boot, or a copy of Eva's under another name, does not count", () => {
    const left = (files: Readonly<Record<string, string>>): boolean =>
      leftoverBwrapProfile(machine("linux", [], undefined, { "/etc/apparmor.d/bwrap": evaProfile, ...files }));
    expect(left({ "/etc/apparmor.d/bwrap-userns-restrict.dpkg-old": systemProfile })).toBe(false);
    expect(left({ "/etc/apparmor.d/bwrap-userns-restrict~": systemProfile })).toBe(false);
    expect(
      left({
        "/etc/apparmor.d/bwrap-userns-restrict": systemProfile,
        "/etc/apparmor.d/disable/bwrap-userns-restrict": "",
      }),
    ).toBe(false);
    // The install command removes only /etc/apparmor.d/bwrap, so the notice counts only that file.
    expect(
      leftoverBwrapProfile(
        machine("linux", [], undefined, {
          "/etc/apparmor.d/bwrap.bak": evaProfile,
          "/etc/apparmor.d/bwrap-userns-restrict": systemProfile,
        }),
      ),
    ).toBe(false);
  });
});

describe("coversBwrap (#903)", () => {
  test("a profile with the name bwrap, or for a path that covers /usr/bin/bwrap, covers bubblewrap", () => {
    expect(coversBwrap(systemProfile)).toBe(true);
    expect(coversBwrap("/usr/bin/bwrap flags=(unconfined) {\n}\n")).toBe(true);
    expect(coversBwrap("profile /usr/bin/bwrap {\n}\n")).toBe(true);
    expect(coversBwrap("profile other /{,usr/}bin/bwrap {\n}\n")).toBe(true);
    expect(coversBwrap("profile other @{bin}/bwrap {\n}\n")).toBe(true);
    expect(coversBwrap('profile other "/usr/bin/bwrap" {\n}\n')).toBe(true);
    expect(coversBwrap("profile other /usr/bin/bwrap (unconfined) {\n}\n")).toBe(true);
    expect(coversBwrap("profile other /usr/bin/bwrap flags = (unconfined) {\n}\n")).toBe(true);
    // A profile with a path in a variable, as some profile collections write it.
    expect(coversBwrap("@{exec_path} = @{bin}/bwrap\nprofile bwrap @{exec_path} flags=(complain) {\n}\n")).toBe(true);
  });

  test("a comment, another program, or a rule inside a profile does not", () => {
    expect(coversBwrap("# profile bwrap /usr/bin/bwrap {\n")).toBe(false);
    expect(coversBwrap("#/usr/bin/bwrap flags=(unconfined) {\n")).toBe(false);
    expect(coversBwrap("profile mine /usr/local/bin/bwrap {\n}\n")).toBe(false);
    expect(coversBwrap("profile unprivileged_userns {\n  allow userns,\n}\n")).toBe(false);
    expect(coversBwrap("profile unpriv_bwrap flags=(attach_disconnected) {\n}\n")).toBe(false);
    expect(coversBwrap("profile chrome /opt/google/chrome/chrome {\n  /usr/bin/bwrap ix,\n}\n")).toBe(false);
  });

  test("the install and uninstall scripts use Eva's mark", () => {
    for (const script of ["install/install.sh", "install/uninstall.sh"])
      expect(readFileSync(script, "utf-8")).toContain(evaProfileMark);
  });
});

describe("shellWallGap (#711)", () => {
  test("Linux with bubblewrap and socat, where a trial run works, has a shell wall", async () => {
    const linux = machine("linux", ["bwrap", "socat"]);
    expect(await shellWallGap(linux)).toBeNull();
    expect(linux.runs[0]?.[0]).toBe("bwrap");
  });

  test("Linux without one of them says which to install, and runs nothing", async () => {
    const linux = machine("linux", ["socat"]);
    const gap = (await shellWallGap(linux))?.reason ?? "";
    expect(gap).toContain("bubblewrap");
    expect(gap).toContain("apt install bubblewrap socat");
    // The install command adds them, also for an Eva from before (#757).
    expect(gap).toContain("Run the install command of Eva again");
    expect(linux.runs).toEqual([]);
  });

  test("an installed bubblewrap that cannot start, or that hangs, says why", async () => {
    const denied = machine("linux", ["bwrap", "socat"], () => ({
      exitCode: 1,
      stdout: "",
      stderr: "bwrap: setting up uid map: Permission denied",
    }));
    expect((await shellWallGap(denied))?.reason).toContain("cannot start on this computer: bwrap: setting up uid map");
    const hangs = machine("linux", ["bwrap", "socat"], () => {
      throw new EvaError("process_timeout", "bwrap did not end in time.");
    });
    expect((await shellWallGap(hangs))?.reason).toContain("bwrap did not end in time.");
  });

  test("macOS has its own sandbox, and native Windows has none that Eva can turn on", async () => {
    expect(await shellWallGap(machine("darwin", []))).toBeNull();
    expect((await shellWallGap(machine("win32", [])))?.reason).toContain("Windows");
    expect((await shellWallGap(machine("freebsd", [])))?.reason).toContain("freebsd");
  });

  test("only a gap on Linux has a fix that the person can make (#825)", async () => {
    expect((await shellWallGap(machine("linux", ["socat"])))?.fixable).toBe(true);
    expect((await shellWallGap(machine("win32", [])))?.fixable).toBe(false);
    expect((await shellWallGap(machine("freebsd", [])))?.fixable).toBe(false);
  });
});

describe("nestedSandboxWorks (#760)", () => {
  test("Linux that lets a sandbox start inside a sandbox keeps the socket filter", async () => {
    const linux = machine("linux", ["bwrap", "socat"]);
    expect(await nestedSandboxWorks(linux)).toBe(true);
    // The socket filter makes a second user namespace inside bubblewrap's, so the trial does too.
    expect(linux.runs[0]).toContain("unshare");
  });

  test("Linux that blocks it, such as a recent Ubuntu, or a trial that hangs, turns the filter off", async () => {
    const blocked = machine("linux", ["bwrap", "socat"], () => ({
      exitCode: 1,
      stdout: "",
      stderr: "unshare: write failed /proc/self/uid_map: Operation not permitted",
    }));
    expect(await nestedSandboxWorks(blocked)).toBe(false);
    const hangs = machine("linux", ["bwrap", "socat"], () => {
      throw new EvaError("process_timeout", "bwrap did not end in time.");
    });
    expect(await nestedSandboxWorks(hangs)).toBe(false);
    expect(await nestedSandboxWorks(machine("linux", ["socat"]))).toBe(false);
  });

  test("macOS needs no trial: its sandbox makes no namespace", async () => {
    const mac = machine("darwin", []);
    expect(await nestedSandboxWorks(mac)).toBe(true);
    expect(mac.runs).toEqual([]);
  });
});

describe("nestedSandboxWorks, as Claude Code builds its sandbox (review of #760)", () => {
  test("the trial drops every right, as Claude Code does, so a root Eva sees what its commands see", async () => {
    const user = machine("linux", ["bwrap", "socat"]);
    await nestedSandboxWorks(user);
    expect(user.runs[0]).toContain("--cap-drop");
    expect(user.runs[0]).not.toContain("--cap-add");
    // As root, Claude Code keeps the one right that a nested namespace needs.
    const root = { ...machine("linux", ["bwrap", "socat"]), root: true };
    await nestedSandboxWorks(root);
    expect(root.runs[0]).toContain("CAP_SETFCAP");
  });
});
