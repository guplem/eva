/**
 * Eva's read-only copy of each widget (#691), in `widgets/<owner>/<name>/` of the instance, never
 * in the vault. A review fetches the newest commit of the default branch with no checkout, so
 * Eva reads `eva-widget.json` and the schemas at one commit without serving any code. The
 * approval checks out exactly that commit. Eva serves only the files of the checkout.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, type Stats } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import type { WidgetAddress } from "./widget-address.ts";
import { commitPattern } from "./widget-approvals.ts";
import type { WidgetAnswer } from "./widget-data.ts";
import { isPlainName } from "./widget-places.ts";

export interface WidgetCopiesOptions {
  /** The `widgets` folder of the instance. */
  readonly folder: string;
  readonly runner: ProcessRunner;
  /** Eva's git environment, with the GitHub token, so a private widget of the person fetches too. */
  readonly environment: Readonly<Record<string, string>>;
  /** The git address of a widget. A test gives a local remote. */
  readonly remoteOf?: (address: WidgetAddress) => string;
}

/** A fetch of a small repository; a slow network still ends. */
const fetchTimeoutMs = 120_000;
const gitTimeoutMs = 30_000;
/** A larger file is not part of a small web page. */
const maxServedBytes = 25 * 1024 * 1024;

const contentTypes: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  wasm: "application/wasm",
};

export class WidgetCopies {
  private readonly options: WidgetCopiesOptions;
  /** The git work of each copy, one step after the other: two fetches in one folder fail on its lock. */
  private readonly queues: Map<string, Promise<unknown>>;

  constructor(options: WidgetCopiesOptions) {
    this.options = options;
    this.queues = new Map();
  }

  folderOf(address: WidgetAddress): string {
    // The id is in lower case, so two spellings of one name never get two folders.
    const [owner = "", name = ""] = address.id.split("/");
    return join(this.options.folder, owner, name);
  }

  /** Fetches the newest commit of the default branch, and returns its name. Nothing is checked out. */
  fetchNewest(address: WidgetAddress): Promise<string> {
    return this.oneAtATime(address, () => this.fetchNow(address));
  }

  private async fetchNow(address: WidgetAddress): Promise<string> {
    const folder = this.folderOf(address);
    if (!existsSync(join(folder, ".git"))) {
      mkdirSync(folder, { recursive: true });
      await this.git(folder, ["init", "-q"]);
      // A link in a widget becomes a plain file, and no hook of the person's git config runs here.
      await this.git(folder, ["config", "core.symlinks", "false"]);
      await this.git(folder, ["config", "core.hooksPath", join(folder, ".git", "no-hooks")]);
    }
    const remote = this.options.remoteOf?.(address) ?? `${address.url}.git`;
    const fetched = await this.git(
      folder,
      [...githubCredentialArguments, "fetch", "-q", "--depth", "1", "--no-tags", "--", remote, "HEAD"],
      fetchTimeoutMs,
    );
    if (fetched.exitCode !== 0) {
      throw new EvaError(
        "git_failed",
        `Eva cannot read ${address.url}. Check the address. A private repository needs a GitHub login of Eva that can read it. ${failureReason(fetched, "git")}`,
      );
    }
    const commit = (await this.git(folder, ["rev-parse", "FETCH_HEAD^{commit}"])).stdout.trim();
    // A ref keeps the commit's objects until the approval, whatever git cleans up.
    await this.git(folder, ["update-ref", "refs/eva/reviewed", commit]);
    return commit;
  }

  /** The text of a file at a fetched commit, or null when the commit has no such file. */
  async readAt(address: WidgetAddress, commit: string, path: string): Promise<string | null> {
    if (!commitPattern.test(commit)) return null;
    const read = await this.git(this.folderOf(address), ["cat-file", "blob", `${commit}:${path}`]);
    return read.exitCode === 0 ? read.stdout : null;
  }

  /** Checks out exactly this fetched commit, and removes every file that it does not hold. */
  install(address: WidgetAddress, commit: string): Promise<void> {
    return this.oneAtATime(address, () => this.installNow(address, commit));
  }

  private async installNow(address: WidgetAddress, commit: string): Promise<void> {
    if (!commitPattern.test(commit)) throw new EvaError("widget_invalid", "This is not a commit of the widget.");
    const folder = this.folderOf(address);
    const checkout = await this.git(folder, [
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "-q",
      "--detach",
      "--force",
      commit,
    ]);
    if (checkout.exitCode !== 0)
      throw new EvaError("git_failed", `Eva could not install ${address.url}: ${failureReason(checkout, "git")}`);
    await this.git(folder, ["clean", "-q", "-ffdx"]);
    await this.git(folder, ["update-ref", "refs/eva/approved", commit]);
  }

  /** Removes the copy and its history. */
  remove(address: WidgetAddress): void {
    rmSync(this.folderOf(address), { recursive: true, force: true });
  }

  /** Answers a file of the checkout, by its path from the copy root. Never `.git/`, a hidden file or a link. */
  serveFile(address: WidgetAddress, path: string): WidgetAnswer {
    const segments = path.split("/");
    if (!segments.every(isPlainName)) return { status: 404 };
    const root = this.folderOf(address);
    let stats: Stats | null = null;
    for (let index = 1; index <= segments.length; index += 1) {
      try {
        stats = lstatSync(join(root, ...segments.slice(0, index)));
      } catch {
        return { status: 404 };
      }
      if (stats.isSymbolicLink() || (index < segments.length && !stats.isDirectory())) return { status: 404 };
    }
    if (!stats?.isFile()) return { status: 404 };
    if (stats.size > maxServedBytes) return { status: 413 };
    const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
    return {
      status: 200,
      contentType: contentTypes[extension] ?? "application/octet-stream",
      body: readFileSync(join(root, ...segments)),
    };
  }

  private oneAtATime<Result>(address: WidgetAddress, work: () => Promise<Result>): Promise<Result> {
    const before = this.queues.get(address.id) ?? Promise.resolve();
    const run = before.then(work, work);
    const settled = run.catch(() => undefined);
    this.queues.set(address.id, settled);
    // The queue of a copy that waits for nothing goes, so the map does not grow.
    void settled.then(() => {
      if (this.queues.get(address.id) === settled) this.queues.delete(address.id);
    });
    return run;
  }

  private git(cwd: string, args: readonly string[], timeoutMs = gitTimeoutMs): ReturnType<ProcessRunner["run"]> {
    return this.options.runner.run(["git", ...args], {
      cwd,
      environment: { ...this.options.environment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs,
    });
  }
}
