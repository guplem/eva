/**
 * The vault sync of a running Eva: "sync now", the idle sweep, the timed pull, and the log
 * lines and alert of a sync problem. No step runs under the turn of a chat in the vault: an
 * Assistant or specialist turn (lessons 22, 30). "Assistant turn" below covers both.
 */
import { EvaError } from "../../shared/errors.ts";
import type { Logger } from "../../shared/logger.ts";
import type { AlertProblem } from "../alerts/alert-center.ts";
import { vaultSyncProblem } from "../alerts/problem-rules.ts";
import type { EvaConfig } from "../settings/home.ts";
import type {
  ConflictChoice,
  ConflictResolution,
  VaultConflictReport,
  VaultSync,
  VaultSyncState,
} from "./vault-sync.ts";
import { emptyUndo, type UndoAnswer, type UndoPreview } from "./vault-snapshots.ts";

export const noVaultState: VaultSyncState = {
  status: "skipped",
  lastCommitAt: null,
  lastPushAt: null,
  lastError: "No vault is configured.",
  withheldFiles: [],
};

/** Why "sync now" did not run, so a client can tell a wait from a failure without reading the text. */
export type SyncSkipReason = "assistant_busy" | "no_vault";

/** A read of the conflicts counts as a pull: it saves nothing. */
type SyncStep = "pull" | "save";

/** The state after "sync now". An older Eva sends no reason. */
export interface SyncNowState extends VaultSyncState {
  readonly skipReason?: SyncSkipReason;
}

export interface VaultUpkeepOptions {
  /** Null when no vault is configured. */
  readonly vaultSync: VaultSync | null;
  readonly now: () => Date;
  /** The `sync.enabled` setting. Off stops the automatic steps, never a request from the person. */
  readonly syncEnabled: () => boolean;
  /** True while a chat in the vault runs a turn: an Assistant chat or a specialist chat (#703). */
  readonly vaultTurnRunning: () => boolean;
  readonly reportProblem: (problem: AlertProblem | null) => void;
  /** Runs after each sync step, such as the check for a vault record from a newer Eva. */
  readonly afterSync?: () => void;
  /**
   * Runs after a timed pull or "Sync now" that fetched and ended "ok", with sync on and no
   * Assistant turn, such as the hub claim that a start could not make (#529).
   */
  readonly afterFetch?: () => void;
  readonly logger?: Logger;
}

export class VaultUpkeep {
  private readonly options: VaultUpkeepOptions;
  private lastPullAt: Date | null;
  /** A slow git step can outlast a timer period; this flag keeps the sweep from running twice at once. */
  private sweeping: boolean;
  /** When the vault sync went offline, for the 30-minute alert; null while it is not offline. */
  private offlineSince: Date | null;
  /** The sync steps in a row that ended in an error, for the alert on the second one. */
  private errorsInRow: number;
  /** The state of the last call, to tell a new failed step from a call that ran none. */
  private lastState: VaultSyncState | null;

  constructor(options: VaultUpkeepOptions) {
    this.lastPullAt = null;
    this.sweeping = false;
    this.offlineSince = null;
    this.errorsInRow = 0;
    this.lastState = null;
    this.options = options;
  }

  get currentState(): VaultSyncState {
    return this.options.vaultSync?.currentState ?? noVaultState;
  }

  /** The pull before an Assistant turn. With sync off, the turn reads the vault as it is. */
  async pull(): Promise<VaultSyncState> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return noVaultState;
    // No log line: a skip says nothing new, and logSyncState would clear a sync alert.
    if (!this.options.syncEnabled()) return vaultSync.currentState;
    this.lastPullAt = this.options.now();
    return this.logSyncState(await vaultSync.pull(), "pull");
  }

  /** The save after an Assistant turn. With sync off, the changes wait for "Sync now". */
  async save(): Promise<VaultSyncState> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return noVaultState;
    // As in pull: no log line.
    if (!this.options.syncEnabled()) return vaultSync.currentState;
    return this.logSyncState(await vaultSync.save());
  }

  /** "Sync now": brings the remote's changes in, then commits and pushes this machine's changes. */
  async syncNow(): Promise<SyncNowState> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return { ...noVaultState, skipReason: "no_vault" };
    if (this.options.vaultTurnRunning())
      return {
        ...vaultSync.currentState,
        status: "skipped",
        lastError: "Eva is working in the vault in a chat. Sync again when it ends.",
        skipReason: "assistant_busy",
      };
    this.lastPullAt = this.options.now();
    // Between the pull and the save, so the save pushes what afterFetch writes.
    await this.pullThenAfterFetch(vaultSync, this.options.syncEnabled());
    return this.logSyncState(await vaultSync.save());
  }

  /** The vault notes that conflict now, so a phone can pick a version of each. */
  async conflicts(): Promise<VaultConflictReport> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return { state: noVaultState, conflicts: [] };
    const report = await vaultSync.conflicts();
    return { ...report, state: this.logSyncState(report.state, "pull") };
  }

  /** A pick for one conflicted note. It waits for the end of an Assistant turn, as a sync does: the turn can write the same note. */
  async resolve(path: string, choice: ConflictChoice): Promise<ConflictResolution> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return { state: noVaultState, conflicts: [], found: false };
    if (this.options.vaultTurnRunning())
      return {
        state: {
          ...vaultSync.currentState,
          status: "skipped",
          lastError: "Eva is working in the vault in a chat. Pick again when it ends.",
        },
        conflicts: [],
        found: false,
      };
    const result = await vaultSync.resolve(path, choice);
    this.options.logger?.log("info", "A vault conflict got a pick.", { path, choice, found: result.found });
    return { ...result, state: this.logSyncState(result.state) };
  }

  /** Saves the files of the vault under a hidden ref, before and after an Assistant turn. With sync off, Eva runs no git step of her own. */
  async snapshot(ref: string): Promise<void> {
    if (this.options.syncEnabled()) await this.options.vaultSync?.snapshot(ref);
  }

  /** What an undo of these answers would do now, for the question before a retry. */
  async undoPreview(answers: readonly UndoAnswer[]): Promise<UndoPreview> {
    // With sync off, Eva runs no git step of her own, so a retry asks nothing.
    if (!this.options.syncEnabled()) return emptyUndo;
    return (await this.options.vaultSync?.undoPreview(answers)) ?? emptyUndo;
  }

  /**
   * Undoes the file changes of these answers before a retry. It waits for the end of every
   * Assistant turn, as a pick does: a turn can write the same files. The pull first brings the
   * remote's changes, so a file that changed there stays. The save then commits the undo.
   */
  async undo(answers: readonly UndoAnswer[]): Promise<UndoPreview> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null || !this.options.syncEnabled()) return emptyUndo;
    if (this.options.vaultTurnRunning()) throw busyUndo();
    await this.pull();
    // A turn can start during the pull.
    if (this.options.vaultTurnRunning()) throw busyUndo();
    const result = await vaultSync.undo(answers);
    this.options.logger?.log("info", "A retry undid the file changes of its answers.", {
      restored: result.restore.length,
      changed: result.changed.length,
      notKept: result.notKept.length,
    });
    await this.save();
    return result;
  }

  /** Deletes the snapshots of a deleted chat, but those in `keep`. */
  async deleteSnapshots(sessionId: string, keep?: ReadonlySet<string>): Promise<void> {
    await this.options.vaultSync?.deleteSnapshots(sessionId, keep);
  }

  /** Saves changes made outside a turn. It never runs during an Assistant turn (lessons 22, 30). */
  async sweep(): Promise<VaultSyncState["status"]> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null || this.sweeping || this.options.vaultTurnRunning()) return "skipped";
    this.sweeping = true;
    try {
      return this.logSyncState(await vaultSync.save()).status;
    } finally {
      this.sweeping = false;
    }
  }

  /** Pulls when the interval of the sync settings has passed since the last pull. */
  async pullIfDue(sync: EvaConfig["sync"]): Promise<void> {
    const minutes = sync.pullIntervalMinutes;
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null || minutes === null || !sync.enabled) return;
    const now = this.options.now();
    if (this.lastPullAt !== null && now.getTime() - this.lastPullAt.getTime() < minutes * 60_000) return;
    // A pull never changes the files under a running Assistant turn (lessons 22, 30).
    if (this.options.vaultTurnRunning()) return;
    this.lastPullAt = now;
    await this.pullThenAfterFetch(vaultSync, true);
  }

  /** A conflict read or pick never fetches, so it never comes here. */
  private async pullThenAfterFetch(vaultSync: VaultSync, syncEnabled: boolean): Promise<VaultSyncState> {
    const freshBefore = vaultSync.freshPulls;
    const state = this.logSyncState(await vaultSync.pull(), "pull");
    // An Assistant turn can start while git fetches.
    if (syncEnabled && state.status === "ok" && vaultSync.freshPulls > freshBefore && !this.options.vaultTurnRunning())
      this.options.afterFetch?.();
    return state;
  }

  private noticeSyncProblem(state: VaultSyncState, step: SyncStep): void {
    const now = this.options.now();
    if (state.status !== "offline") this.offlineSince = null;
    else this.offlineSince ??= now;
    const offlineForMs = this.offlineSince === null ? 0 : now.getTime() - this.offlineSince.getTime();
    // A call that ran no git step returns the same state object, so it is no new failure.
    const newStep = state !== this.lastState;
    this.lastState = state;
    if (newStep && state.status === "error") this.errorsInRow += 1;
    // A pull can work while every push fails, so only a save ends a run of errors (#631).
    else if (newStep && step === "save") this.errorsInRow = 0;
    if (step === "pull" && state.status === "ok" && this.errorsInRow > 0) return;
    const problem = vaultSyncProblem(state, offlineForMs, this.errorsInRow);
    if (problem !== "keep") this.options.reportProblem(problem);
  }

  /** Logs a sync problem and the files that the sync held back (lessons 16, 26), and raises its alert. */
  private logSyncState(state: VaultSyncState, step: SyncStep = "save"): VaultSyncState {
    this.noticeSyncProblem(state, step);
    // A pull can bring a migration record from a newer Eva at any time.
    this.options.afterSync?.();
    if (state.status === "conflict" || state.status === "error" || state.status === "offline") {
      this.options.logger?.log(state.status === "offline" ? "warn" : "error", "Vault sync failed.", {
        status: state.status,
        reason: state.lastError,
      });
    }
    if (state.withheldFiles.length > 0) {
      this.options.logger?.log("warn", "Vault sync held back files that look like secrets or are too large.", {
        files: state.withheldFiles,
      });
    }
    return state;
  }
}

function busyUndo(): EvaError {
  return new EvaError("session_busy", "Eva is working in the vault in a chat. Retry again when it ends.");
}
