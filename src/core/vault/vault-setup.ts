/**
 * The vault step of the web page: the same choices as `eva setup`, with no terminal. Eva clones a
 * repository that the person picks, or starts a new vault from the template and pushes it to a new
 * private repository. The folder is the saved one when it is empty, else `<home>/vault`.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { loadConfig, saveConfig, type HomePaths } from "../settings/home.ts";
import { loadSettings } from "../settings/settings.ts";
import { createGitHubRepository, listGitHubRepositories, type GitHubRepository } from "./github-repositories.ts";
import { checkVaultRepository, cloneVault, isAddress, pushNewVault, vaultNeedsPush } from "./vault-clone.ts";
import { createVaultFromTemplate } from "./vault-template.ts";

export interface VaultSetupOptions {
  readonly paths: HomePaths;
  readonly runner: ProcessRunner;
  /** The vault folder as saved now, with the machine default, or null. */
  readonly savedVaultPath: () => string | null;
  /** Eva's git environment, with the GitHub token as it is saved now. */
  readonly gitEnvironment: () => Readonly<Record<string, string>>;
  /** The saved GitHub token: one that the page saved since the start works at once. */
  readonly githubToken: () => string | undefined;
  /** The GitHub API address; a test points it at a fake server. */
  readonly githubApiBaseUrl?: string;
}

export interface NewVaultAnswers {
  readonly name: string;
  readonly language: string;
  readonly topics: readonly string[];
  /** The name of a new private repository, or the address of an empty one. Empty: the vault stays local. */
  readonly repository: string;
}

export interface VaultSetupResult {
  readonly folder: string;
  /** The vault's repository, or null when the vault is only on this computer. */
  readonly repository: string | null;
  /** Why a new vault stays local, such as a refused repository name; null when all went well. */
  readonly problem: string | null;
}

const noToken = "Save a GitHub token first, in the GitHub step.";

export class VaultSetup {
  private readonly options: VaultSetupOptions;
  /** A second click must not clone into the folder that the first one fills. */
  private running: boolean;

  constructor(options: VaultSetupOptions) {
    this.options = options;
    this.running = false;
  }

  /** The repositories that the saved token reaches, pushed most recently first. */
  async repositories(): Promise<GitHubRepository[]> {
    return listGitHubRepositories({ token: this.token(), ...this.api() });
  }

  /** Clones the repository that the person picked or typed: an address, or a name such as `you/vault`. */
  clone(answer: string): Promise<VaultSetupResult> {
    return this.once(async () => {
      const repository = vaultAddress(answer);
      const folder = this.freeFolder();
      const environment = this.options.gitEnvironment();
      const reason = await checkVaultRepository({ repository, runner: this.options.runner, environment });
      if (reason !== null) throw new EvaError("git_failed", `git could not read ${repository}: ${reason}`);
      await this.orRemove(folder, () => cloneVault({ repository, folder, runner: this.options.runner, environment }));
      this.saveFolder(folder);
      return { folder, repository, problem: null };
    });
  }

  /** Starts a new vault from the template, then puts it in a private GitHub repository. */
  create(answers: NewVaultAnswers): Promise<VaultSetupResult> {
    return this.once(async () => {
      const folder = this.freeFolder();
      await this.orRemove(folder, () =>
        createVaultFromTemplate({
          folder,
          answers: {
            name: answers.name.trim() || "the owner",
            language: answers.language.trim() || "English",
            timeZone: this.timeZone(),
            topics: answers.topics.map((topic) => topic.trim()).filter((topic) => topic !== ""),
          },
          runner: this.options.runner,
          environment: this.options.gitEnvironment(),
        }),
      );
      // The local vault comes first, so a failed push loses nothing, and the page offers it again.
      this.saveFolder(folder);
      if (this.options.githubToken() === undefined && !isAddress(answers.repository))
        return { folder, repository: null, problem: noToken };
      if (answers.repository.trim() === "") return { folder, repository: null, problem: null };
      return this.pushTo(folder, answers.repository);
    });
  }

  /** Puts a local vault with no remote in a private GitHub repository, such as after a failed push. */
  push(repository: string): Promise<VaultSetupResult> {
    return this.once(async () => {
      const folder = this.options.savedVaultPath();
      if (folder === null || !(await this.needsPush()))
        throw new EvaError("config_invalid", "The vault needs no push: it has a repository, or no commit yet.");
      const result = await this.pushTo(folder, repository);
      if (result.problem !== null) throw new EvaError("github_failed", result.problem);
      return result;
    });
  }

  /** True for a saved vault with a commit and no remote, which the page offers to push. */
  async needsPush(): Promise<boolean> {
    const folder = this.options.savedVaultPath();
    if (folder === null) return false;
    return vaultNeedsPush({ folder, runner: this.options.runner, environment: this.options.gitEnvironment() });
  }

  private async pushTo(folder: string, answer: string): Promise<VaultSetupResult> {
    const name = answer.trim();
    try {
      const repository = isAddress(name)
        ? name
        : (await createGitHubRepository({ token: this.token(), name, ...this.api() })).cloneUrl;
      await pushNewVault({
        repository,
        folder,
        runner: this.options.runner,
        environment: this.options.gitEnvironment(),
      });
      return { folder, repository, problem: null };
    } catch (error) {
      if (!isEvaError(error, "github_failed") && !isEvaError(error, "git_failed")) throw error;
      return { folder, repository: null, problem: error.message };
    }
  }

  private async once(work: () => Promise<VaultSetupResult>): Promise<VaultSetupResult> {
    if (this.running) throw new EvaError("vault_setup_busy", "Eva sets up the vault already. Wait for it to end.");
    this.running = true;
    try {
      return await work();
    } finally {
      this.running = false;
    }
  }

  private freeFolder(): string {
    const folder = this.options.savedVaultPath() ?? join(this.options.paths.root, "vault");
    if (!existsSync(folder)) return folder;
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      throw new EvaError("vault_not_found", `${folder} is not a folder that Eva can read.`);
    }
    if (entries.length > 0)
      throw new EvaError("vault_not_found", `${folder} holds files already, so Eva does not put a new vault there.`);
    return folder;
  }

  /**
   * Removes what a failed step wrote into the empty or missing folder. A half vault, such as a
   * `.git` with no commit, would count as a vault, and the page could not offer the step again.
   */
  private async orRemove(folder: string, step: () => Promise<void>): Promise<void> {
    const existed = existsSync(folder);
    try {
      await step();
    } catch (error) {
      // The folder was empty or missing before the step, so each file in it is the step's own.
      if (!existed) rmSync(folder, { recursive: true, force: true });
      else for (const entry of readdirSync(folder)) rmSync(join(folder, entry), { recursive: true, force: true });
      throw error;
    }
  }

  /** Only the machine's file, as `eva setup` saves it: a merge with defaults would write over the vault's settings. */
  private saveFolder(folder: string): void {
    saveConfig(this.options.paths, { ...loadConfig(this.options.paths), vaultPath: folder });
  }

  private timeZone(): string {
    try {
      const saved = loadSettings(this.options.paths).config.timeZone;
      if (saved !== null) return saved;
    } catch {
      // A broken settings file must not stop the new vault; the machine's time zone serves.
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  private token(): string {
    const token = this.options.githubToken();
    if (token === undefined) throw new EvaError("github_failed", noToken);
    return token;
  }

  private api(): { baseUrl?: string } {
    return this.options.githubApiBaseUrl === undefined ? {} : { baseUrl: this.options.githubApiBaseUrl };
  }
}

/** An address as it is, or `you/vault` as a GitHub address. Never a bare word: git reads it as a folder here. */
function vaultAddress(answer: string): string {
  const text = answer.trim();
  if (isAddress(text)) return text;
  const name = text.replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(name)) return `https://github.com/${name}.git`;
  throw new EvaError(
    "config_invalid",
    `Eva cannot read "${text}". Pick a repository, or type a name such as you/vault.`,
  );
}
