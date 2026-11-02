/**
 * Specialist mode (#703): the harness in a project folder, with the project's `AGENTS.md` as its
 * only instructions, such as a gym coach. A general project's chat, such as for building a house,
 * runs the same way (#768). As in Project mode, Eva adds no prompt, no skill and no
 * MCP server, and the engine hides each instruction file above the folder. The folder is in the
 * vault, so Eva syncs the vault around each turn, as in Assistant mode, and turns off the folder's
 * hooks and the harness's own memory: the specialist keeps its memory in its folder.
 */
import { dirname } from "node:path";
import type { WallRoots } from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ModeContext, PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import { withGitCeiling } from "./project-mode.ts";
import { VaultTurns, type VaultSyncPort } from "./vault-turns.ts";

export interface SpecialistPreparerOptions {
  readonly vaultSync: VaultSyncPort;
  readonly environment: Readonly<Record<string, string>>;
  /**
   * Whether the project's chats still start in its folder, read at each turn. A type changed by
   * hand or on another machine would otherwise run a trusted chat at the root of a software project.
   */
  readonly isSpecialist?: (projectId: string) => boolean;
  /** The folders that the chat may not open, read at each turn (#711). */
  readonly wallRoots: () => WallRoots;
  /**
   * The folder of the files that the person sent to the project's chats, or null with no vault.
   * The chat reads them, but never changes them: they are temporary (#768).
   */
  readonly receivedFolder?: (projectId: string) => string | null;
}

export class SpecialistPreparer implements TurnPreparer {
  private readonly options: SpecialistPreparerOptions;
  private readonly vaultTurns: VaultTurns;

  constructor(options: SpecialistPreparerOptions) {
    this.options = options;
    this.vaultTurns = new VaultTurns(options.vaultSync);
  }

  async prepare(session: SessionRecord): Promise<PreparedTurn> {
    // Before the pull: a refused turn changes no file.
    if (session.projectId !== null && this.options.isSpecialist?.(session.projectId) === false)
      throw new EvaError(
        "project_invalid",
        "This project works in clones now, so this chat takes no message. Start a new chat in the project.",
      );
    await this.vaultTurns.before(session);
    const roots = this.options.wallRoots();
    const received = session.projectId === null ? null : (this.options.receivedFolder?.(session.projectId) ?? null);
    return {
      startFolder: session.startFolder,
      projectFolder: session.startFolder,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      // The folder is the person's own vault content, so Eva asks no trust question.
      trusted: true,
      harnessMemory: false,
      folderHooks: false,
      fileWall: {
        area: session.startFolder,
        ...roots,
        ...(received === null ? {} : { readOnly: [...(roots.readOnly ?? []), received] }),
      },
      // The project folder is no repository: without the ceiling, git there would read the vault.
      environment: withGitCeiling(this.options.environment, dirname(session.startFolder)),
    };
  }

  describe(session: SessionRecord): Promise<ModeContext> {
    return Promise.resolve({
      parts: [],
      engine: {
        mode: "project",
        startFolder: session.startFolder,
        projectFolder: session.startFolder,
        trusted: true,
        pluginFolders: [],
        environment: this.options.environment,
      },
    });
  }

  async afterTurn(session: SessionRecord, _outcome: TurnOutcome): Promise<string | null> {
    await this.vaultTurns.after(session);
    return null;
  }
}
