/**
 * The vault sync of a running Eva: "sync now", the idle sweep, the timed pull, and the log
 * lines and alert of a sync problem. No step runs under an Assistant turn (lessons 22, 30).
 */
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

export const noVaultState: VaultSyncState = {
  status: "skipped",
  lastCommitAt: null,
  lastPushAt: null,
  lastError: "No vault is configured.",
  withheldFiles: [],
};

export interface VaultUpkeepOptions {
  /** Null when no vault is configured. */
  readonly vaultSync: VaultSync | null;
  readonly now: () => Date;
  /** The live `sync.enabled` setting. Off stops the automatic steps, never a request from the person. */
  readonly syncEnabled: () => boolean;
  /** True while an Assistant chat runs a turn. */
  readonly assistantBusy: () => boolean;
  readonly reportProblem: (problem: AlertProblem | null) => void;
  /** Runs after each sync step, such as the check for a vault record from a newer Eva. */
  readonly afterSync?: () => void;
  readonly logger?: Logger;
}

export class VaultUpkeep {
  private readonly options: VaultUpkeepOptions;
  private lastPullAt: Date | null;
  /** A slow git step can outlast a timer period; this flag keeps the sweep from running twice at once. */
  private sweeping: boolean;
  /** When the vault sync went offline, for the 30-minute alert; null while it is not offline. */
  private offlineSince: Date | null;

  constructor(options: VaultUpkeepOptions) {
    this.lastPullAt = null;
    this.sweeping = false;
    this.offlineSince = null;
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
    return this.logSyncState(await vaultSync.pull());
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
  async syncNow(): Promise<VaultSyncState> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return noVaultState;
    if (this.options.assistantBusy())
      return {
        ...vaultSync.currentState,
        status: "skipped",
        lastError: "Eva is working in an Assistant chat. Sync again when it ends.",
      };
    this.lastPullAt = this.options.now();
    this.logSyncState(await vaultSync.pull());
    return this.logSyncState(await vaultSync.save());
  }

  /** The vault notes that conflict now, so a phone can pick a version of each. */
  async conflicts(): Promise<VaultConflictReport> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return { state: noVaultState, conflicts: [] };
    const report = await vaultSync.conflicts();
    return { ...report, state: this.logSyncState(report.state) };
  }

  /** A pick for one conflicted note. It waits for the end of an Assistant turn, as a sync does: the turn can write the same note. */
  async resolve(path: string, choice: ConflictChoice): Promise<ConflictResolution> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null) return { state: noVaultState, conflicts: [], found: false };
    if (this.options.assistantBusy())
      return {
        state: {
          ...vaultSync.currentState,
          status: "skipped",
          lastError: "Eva is working in an Assistant chat. Pick again when it ends.",
        },
        conflicts: [],
        found: false,
      };
    const result = await vaultSync.resolve(path, choice);
    this.options.logger?.log("info", "A vault conflict got a pick.", { path, choice, found: result.found });
    return { ...result, state: this.logSyncState(result.state) };
  }
  /** Saves changes made outside a turn. It never runs during an Assistant turn (lessons 22, 30). */
  async sweep(): Promise<VaultSyncState["status"]> {
    const vaultSync = this.options.vaultSync;
    if (vaultSync === null || this.sweeping || this.options.assistantBusy()) return "skipped";
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
    if (this.options.assistantBusy()) return;
    this.lastPullAt = now;
    this.logSyncState(await vaultSync.pull());
  }

  private noticeSyncProblem(state: VaultSyncState): void {
    const now = this.options.now();
    if (state.status !== "offline") this.offlineSince = null;
    else this.offlineSince ??= now;
    const offlineForMs = this.offlineSince === null ? 0 : now.getTime() - this.offlineSince.getTime();
    const problem = vaultSyncProblem(state, offlineForMs);
    if (problem !== "keep") this.options.reportProblem(problem);
  }

  /** Logs a sync problem and the files that the sync held back (lessons 16, 26), and raises its alert. */
  private logSyncState(state: VaultSyncState): VaultSyncState {
    this.noticeSyncProblem(state);
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
