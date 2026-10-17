import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import {
  assetNameFor,
  isNewerVersion,
  parseChecksums,
  releasePublicKey,
  sha256Hex,
  verifyChecksumsSignature,
} from "../../../../src/core/updates/release-verification.ts";
import { executableUpdateChannel, updateExecutable } from "../../../../src/core/updates/self-update.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const otherKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");

function signText(text: string): string {
  return sign(null, Buffer.from(text, "utf8"), keys.privateKey).toString("base64");
}

describe("release verification", () => {
  test("a signature matches only its key and its exact text", () => {
    const sums = "aa  eva-linux-x64\n";
    const signature = signText(sums);
    expect(verifyChecksumsSignature(sums, signature, publicKey)).toBe(true);
    expect(verifyChecksumsSignature(sums + " ", signature, publicKey)).toBe(false);
    expect(verifyChecksumsSignature(sums, signature, otherKey)).toBe(false);
    expect(verifyChecksumsSignature(sums, "not base64 at all", publicKey)).toBe(false);
    expect(verifyChecksumsSignature(sums, signature, "broken-key")).toBe(false);
  });

  test("Eva carries a real Ed25519 public key", () => {
    expect(Buffer.from(releasePublicKey, "base64")).toHaveLength(44);
  });

  test("checksums are read from sha256sum output, in text or binary mode", () => {
    const hash = "a".repeat(64);
    expect(parseChecksums(`${hash}  eva-linux-x64\r\n${hash} *eva-windows-x64.exe\nnoise\n`)).toEqual(
      new Map([
        ["eva-linux-x64", hash],
        ["eva-windows-x64.exe", hash],
      ]),
    );
  });

  test("each supported machine has an asset, and others have none", () => {
    expect(assetNameFor("win32", "x64")).toBe("eva-windows-x64.exe");
    expect(assetNameFor("linux", "x64")).toBe("eva-linux-x64");
    expect(assetNameFor("linux", "arm64")).toBe("eva-linux-arm64");
    expect(assetNameFor("darwin", "arm64")).toBeNull();
  });

  test("versions compare by number, with or without a v", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1", "0.1.1")).toBe(false);
    expect(isNewerVersion("1.0.0-beta", "0.9.0")).toBe(true);
  });
});

describe("updateExecutable", () => {
  let folder: string;
  let server: Server<undefined>;
  let files: Record<string, Uint8Array<ArrayBuffer> | string>;
  let latestStatus: number;
  let brokenDownloads: boolean;
  let probeAnswer: string;
  let executable: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "eva-update-"));
    executable = join(folder, "eva");
    writeFileSync(executable, "old build");
    latestStatus = 200;
    brokenDownloads = false;
    probeAnswer = "0.2.0";
    const fresh = new TextEncoder().encode("new build");
    const sums = `${sha256Hex(fresh)}  eva-linux-x64\n# version 0.2.0\n`;
    files = { "eva-linux-x64": fresh, SHA256SUMS: sums, "SHA256SUMS.sig": signText(sums) };
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/repos/guplem/eva/releases/latest") {
          return Response.json(
            {
              tag_name: "v0.2.0",
              assets: Object.keys(files).map((name) => ({
                name,
                browser_download_url: `http://127.0.0.1:${String(server.port)}/download/${name}`,
              })),
            },
            { status: latestStatus },
          );
        }
        if (brokenDownloads) return new Response("broken", { status: 500 });
        const body = files[path.replace("/download/", "")];
        return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
      },
    });
  });
  afterEach(() => {
    void server.stop(true);
    rmSync(folder, { recursive: true, force: true });
  });

  function inputs(currentVersion = "0.1.0"): Parameters<typeof updateExecutable>[0] {
    return {
      currentVersion,
      executablePath: executable,
      platform: "linux",
      arch: "x64",
      apiBaseUrl: `http://127.0.0.1:${String(server.port)}`,
      publicKey,
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout: `${probeAnswer}\n`, stderr: "" }) },
      environment: {},
    };
  }

  async function failure(run: Promise<unknown>): Promise<unknown> {
    return run.then(
      () => null,
      (error: unknown) => error,
    );
  }

  test("as an update channel, a check finds the release and installs nothing", async () => {
    const channel = executableUpdateChannel(inputs());
    expect(channel.kind).toBe("executable");
    expect(await channel.check()).toEqual({ current: "0.1.0", latest: "0.2.0", available: true });
    expect(await executableUpdateChannel(inputs("0.2.0")).check()).toMatchObject({ available: false });
    expect(readFileSync(executable, "utf8")).toBe("old build");
  });

  test("as an update channel, apply installs the release, and is a no-op when up to date", async () => {
    expect(await executableUpdateChannel(inputs("0.2.0")).apply()).toEqual({
      current: "0.2.0",
      latest: "0.2.0",
      available: false,
    });
    expect(await executableUpdateChannel(inputs()).apply()).toEqual({
      current: "0.1.0",
      latest: "0.2.0",
      available: false,
    });
    expect(readFileSync(executable, "utf8")).toBe("new build");
  });

  test("a newer signed release replaces the executable, and the old one stays beside it", async () => {
    expect(await updateExecutable(inputs())).toEqual({ status: "updated", from: "0.1.0", to: "0.2.0" });
    expect(readFileSync(executable, "utf8")).toBe("new build");
    expect(readFileSync(`${executable}.old`, "utf8")).toBe("old build");
    expect(existsSync(`${executable}.new`)).toBe(false);
  });

  test("an old executable that is still open moves aside under its own name (Windows supervisor)", async () => {
    // A folder stands in for a file that cannot be removed, as Windows keeps a running executable.
    mkdirSync(`${executable}.old`);
    writeFileSync(join(`${executable}.old`, "busy"), "");
    writeFileSync(`${executable}.old-1`, "a leftover that nothing holds any more");
    mkdirSync(`${executable}.old-2`);
    writeFileSync(join(`${executable}.old-2`, "busy"), "a leftover that still runs");
    writeFileSync(`${executable}.old-notes`, "a file of the person's own");
    expect(await updateExecutable(inputs())).toEqual({ status: "updated", from: "0.1.0", to: "0.2.0" });
    expect(readFileSync(executable, "utf8")).toBe("new build");
    expect(existsSync(`${executable}.old-1`)).toBe(false);
    expect(existsSync(`${executable}.old-2`)).toBe(true);
    expect(existsSync(`${executable}.old-notes`)).toBe(true);
    const moved = readdirSync(folder).filter((name) => /^eva\.old-\d{4,}$/.test(name));
    expect(moved).toHaveLength(1);
    expect(readFileSync(join(folder, moved[0] ?? ""), "utf8")).toBe("old build");
  });

  test("the same version is up to date and changes nothing", async () => {
    expect(await updateExecutable(inputs("0.2.0"))).toEqual({ status: "up_to_date", version: "0.2.0" });
    expect(readFileSync(executable, "utf8")).toBe("old build");
  });

  test("a wrong signature or a changed download changes nothing", async () => {
    files["SHA256SUMS.sig"] = signText("something else");
    expect(String(await failure(updateExecutable(inputs())))).toContain("signature");
    const sums = `${"0".repeat(64)}  eva-linux-x64\n# version 0.2.0\n`;
    files = { ...files, SHA256SUMS: sums, "SHA256SUMS.sig": signText(sums) };
    expect(String(await failure(updateExecutable(inputs())))).toContain("does not match its signed checksum");
    expect(readFileSync(executable, "utf8")).toBe("old build");
  });

  test("a new executable that does not start, or names another version, changes nothing (lesson 91)", async () => {
    probeAnswer = "0.1.9";
    expect(String(await failure(updateExecutable(inputs())))).toContain("did not start and say 0.2.0");
    expect(readFileSync(executable, "utf8")).toBe("old build");
    expect(existsSync(`${executable}.new`)).toBe(false);
    const crashing = { ...inputs(), runner: { run: () => Promise.reject(new Error("bad format")) } };
    expect(String(await failure(updateExecutable(crashing)))).toContain("did not start");
  });

  test("an old signed build under a new tag is refused (no rollback)", async () => {
    const fresh = new TextEncoder().encode("new build");
    for (const versionLine of ["# version 0.1.0\n", ""]) {
      const sums = `${sha256Hex(fresh)}  eva-linux-x64\n${versionLine}`;
      files = { ...files, SHA256SUMS: sums, "SHA256SUMS.sig": signText(sums) };
      expect(String(await failure(updateExecutable(inputs())))).toContain("not a newer version");
    }
    expect(readFileSync(executable, "utf8")).toBe("old build");
  });

  test("a missing asset, a GitHub error, an unreachable server and an unknown machine are clear errors", async () => {
    Reflect.deleteProperty(files, "eva-linux-x64");
    expect(String(await failure(updateExecutable(inputs())))).toContain("has no eva-linux-x64");
    latestStatus = 404;
    expect(String(await failure(updateExecutable(inputs())))).toContain("GitHub answered 404");
    expect(String(await failure(updateExecutable({ ...inputs(), apiBaseUrl: "http://127.0.0.1:1" })))).toContain(
      "could not be reached",
    );
    const unknown = await failure(updateExecutable({ ...inputs(), platform: "darwin" }));
    expect(isEvaError(unknown, "update_failed")).toBe(true);
  });

  test("a download that the server refuses is a clear error", async () => {
    brokenDownloads = true;
    expect(String(await failure(updateExecutable(inputs())))).toContain("SHA256SUMS could not be downloaded (500)");
  });
});
