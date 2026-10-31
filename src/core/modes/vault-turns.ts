/**
 * The vault steps around a turn of a chat that works in the vault: the Assistant and a specialist
 * (#703). Before: pull, then a snapshot. After: a snapshot, then a save. An undo takes back only
 * what changed between the two snapshots (#525).
 */
import type { SessionRecord } from "../sessions/session-store.ts";
import type { VaultSyncState } from "../vault/vault-sync.ts";
import { turnSnapshotRef } from "../vault/vault-snapshots.ts";

export interface VaultSyncPort {
  pull(): Promise<VaultSyncState>;
  save(): Promise<VaultSyncState>;
  /** Saves the files of the vault under a hidden ref. It never fails the turn. */
  snapshot(ref: string): Promise<void>;
  /** The files that changed between two snapshots, or null when one is missing. */
  changedFiles?(before: string, after: string): Promise<readonly string[] | null>;
}

/** The refs of the two snapshots of one turn. */
export interface TurnSnapshots {
  readonly before: string;
  readonly after: string;
}

export class VaultTurns {
  private readonly vaultSync: VaultSyncPort;
  /** The index of the running turn of each session, from its start, for the snapshot after it. */
  private readonly turnBySession: Map<string, number>;

  constructor(vaultSync: VaultSyncPort) {
    this.vaultSync = vaultSync;
    this.turnBySession = new Map();
  }

  async before(session: SessionRecord): Promise<void> {
    await this.vaultSync.pull();
    // After the pull: the remote's changes are not the answer's. The record gets the turn at its
    // end, so its index is the count of turns now (#525).
    const turnIndex = session.turns.length;
    this.turnBySession.set(session.id, turnIndex);
    await this.vaultSync.snapshot(turnSnapshotRef(session.id, turnIndex, "before"));
  }

  /**
   * `beforeSnapshot` writes the mode's own edits that waited for the turn, so an undo of the turn
   * undoes them too. Returns the refs of the turn's snapshots, or null for a turn with no start.
   */
  async after(session: SessionRecord, beforeSnapshot?: () => Promise<void> | undefined): Promise<TurnSnapshots | null> {
    const turnIndex = this.turnBySession.get(session.id);
    this.turnBySession.delete(session.id);
    await beforeSnapshot?.();
    if (turnIndex !== undefined) await this.vaultSync.snapshot(turnSnapshotRef(session.id, turnIndex, "after"));
    await this.vaultSync.save();
    return turnIndex === undefined
      ? null
      : {
          before: turnSnapshotRef(session.id, turnIndex, "before"),
          after: turnSnapshotRef(session.id, turnIndex, "after"),
        };
  }
}
