/**
 * The widgets of the home page (#691): the list of the settings, the review and the approval of
 * a widget, the tokens of the grid, and the answers of the widget routes.
 *
 * Three rules keep the person's data safe. A widget runs no code before the person approves one
 * commit. Each request checks the approved record on this computer, never the vault. And each
 * request also checks the vault entry, so an agent that turns a widget off or changes its folder
 * stops it at once.
 */
import { randomBytes } from "node:crypto";
import { EvaError } from "../../shared/errors.ts";
import type { Project } from "../projects/project-catalog.ts";
import type { LastLocation } from "../vault/about-me.ts";
import { widgetAddress, type WidgetAddress } from "./widget-address.ts";
import {
  configOf,
  matches,
  ownValue,
  type ApprovedPath,
  type WidgetApproval,
  type WidgetApprovals,
} from "./widget-approvals.ts";
import { checkManifest, checkWidget, manifestPath, type WidgetInput, type WidgetManifest } from "./widget-contract.ts";
import type { WidgetCopies } from "./widget-copies.ts";
import { answerData, type WidgetAnswer } from "./widget-data.ts";
import { checkHost } from "./widget-hosts.ts";
import { readWidgetList, writeWidgetList, type WidgetEntry, type WidgetInputValue } from "./widget-list.ts";
import { isPlainName } from "./widget-places.ts";
import { checkValues } from "./widget-values.ts";
import { themeCss, type WidgetTheme } from "./widget-policy.ts";
import type { DataFormatRecord } from "./data-format-writer.ts";
import type { FormatConflict } from "./data-formats.ts";
import { installedSchema, WidgetFormats } from "./widget-formats.ts";
import { oneLine } from "./widget-prompt.ts";
import type { AlertProblem } from "../alerts/alert-center.ts";
import type { GithubRequest } from "../projects/repository-facts.ts";
import { grantChange, readOnlyFallbacks, type GrantChange, type WidgetGrant } from "./widget-changes.ts";
import { releaseNotes } from "./widget-notes.ts";
import type { WaitingUpdate, WidgetUpdates } from "./widget-updates.ts";

export interface WidgetsOptions {
  readonly vaultPath: string;
  readonly approvals: WidgetApprovals;
  readonly copies: WidgetCopies;
  readonly projects: () => readonly Project[];
  /** The addresses of the widgets that ship with Eva. */
  readonly baseWidgets: readonly string[];
  /** The newest location that Eva knows, or null. */
  readonly location: () => LastLocation | null;
  /** Runs a vault write between two sync steps. */
  readonly exclusive: <Result>(work: () => Result) => Promise<Result>;
  readonly redact: (text: string) => string;
  readonly now: () => Date;
  /** The data formats (#692). Without them, this Eva writes no `DATA_FORMAT.md`. */
  readonly formats?: {
    readonly record: DataFormatRecord;
    /** Only the hub writes the files. */
    readonly isHub: () => boolean;
    /** Tells the person once that Eva wrote over an edit of these files. */
    readonly notify: (edited: readonly string[]) => void;
    readonly log: (reason: string) => void;
    /** True while an Assistant or specialist chat runs a turn in the vault. */
    readonly vaultBusy: () => boolean;
  };
  /** The updates (#693). Without them, this Eva checks no update. */
  readonly updates?: {
    readonly state: WidgetUpdates;
    /** Minutes between two checks of the person's own widgets: a setting that applies at once. */
    readonly ownMinutes: () => number;
    /** Opens, renews or closes the notice of an update that waits. */
    readonly report: (key: string, problem: AlertProblem | null) => void;
    /** Closes a notice with no "resolved" line, such as the notice of a refused update. */
    readonly dismiss: (key: string) => void;
    /** Reads the release notes. Without it, a notice has no notes. */
    readonly github?: GithubRequest;
    readonly log: (reason: string) => void;
  };
}

export type WidgetSource = "list" | "project" | "base";

/** One widget of the settings list. */
export interface WidgetItem {
  readonly id: string;
  readonly repository: string;
  readonly owner: string;
  /** The name of the widget: the manifest's, or the repository's before a review. */
  readonly name: string;
  readonly sources: readonly WidgetSource[];
  /** "approve": on in the vault, with no matching approval on this computer. */
  readonly state: "off" | "on" | "approve";
  readonly size: WidgetManifest["size"] | null;
  /** The manifest problems of the last review, or an empty list when it was fine. Null before a review. */
  readonly problems: readonly string[] | null;
  /** The update that waits for the person on this computer, or null. */
  readonly update: WidgetUpdateView | null;
}

/** What the activation shows: the inputs to fill and the permissions to approve, at one commit. */
export interface WidgetReview {
  readonly id: string;
  readonly repository: string;
  readonly owner: string;
  readonly commit: string;
  /** Null when the manifest fails: `problems` says why. */
  readonly manifest: WidgetManifest | null;
  readonly problems: readonly string[];
  /** The values that the vault holds now, so a second computer fills the form. */
  readonly values: Readonly<Record<string, WidgetInputValue>>;
  /** The approved commit on this computer, or null for a widget with no approval. */
  readonly installed: string | null;
  /** The permissions beyond the approval, one sentence each. Null with no approval or no valid manifest. */
  readonly added: readonly string[] | null;
  /** True when the widget follows a contract that this Eva does not know yet. */
  readonly newerContract?: true;
}

/** An update that waits for the person: its commit, and why it did not install by itself. */
export interface WidgetUpdateView {
  readonly commit: string;
  readonly permissions: readonly string[];
  readonly reasons: readonly string[];
  readonly notes: readonly string[];
}

/** One card of the grid. */
export interface WidgetFrame {
  readonly id: string;
  readonly name: string;
  readonly size: WidgetManifest["size"];
  /** The token path of the entry page, or null for a widget to approve on this computer. */
  readonly src: string | null;
  readonly token: string | null;
}

interface FrameSession {
  readonly id: string;
  readonly commit: string;
  theme: WidgetTheme;
  readonly expiresAt: number;
}

/** A token ends after this time. The page asks again before, so a phone that stays open keeps working. */
const tokenLifeMs = 6 * 60 * 60_000;
/** A token with less life left is replaced at the next ask. The page asks each minute while it is in view. */
const tokenRenewMs = 60 * 60_000;
/** A review reads the network, so the list reuses one for a while. */
const reviewKeepMs = 10 * 60_000;
/** A widget that the person did not make is checked once a day. */
const dayMs = 24 * 60 * 60_000;
/**
 * The own hosts of a check in the background. A host that the record lacks is a new permission
 * anyway, and the review of that update checks each host with the page's own hosts.
 */
const defaultOwnHosts: readonly string[] = ["127.0.0.1", "localhost"];

/** The notice of one waiting commit: a newer commit is news, so it gets a notice of its own. */
function updateKey(id: string, commit: string): string {
  return `widget_update:${id}:${commit.slice(0, 12)}`;
}

export class Widgets {
  private readonly options: WidgetsOptions;
  private readonly sessions: Map<string, FrameSession>;
  private readonly reviews: Map<string, { readonly review: WidgetReview; readonly at: number }>;
  /** The data formats of the approved widgets: the prompt lines and the checks read them. */
  readonly formats: WidgetFormats;
  /** The widgets whose copy switches to a new commit now: their files wait. */
  private readonly installing: Set<string>;
  private checking: Promise<void> | null;

  constructor(options: WidgetsOptions) {
    this.options = options;
    this.sessions = new Map();
    this.reviews = new Map();
    this.installing = new Set();
    this.checking = null;
    this.formats = new WidgetFormats({
      vaultPath: options.vaultPath,
      approvals: options.approvals,
      copies: options.copies,
      exclusive: options.exclusive,
      record: options.formats?.record ?? null,
      isHub: options.formats?.isHub ?? (() => false),
      notify: options.formats?.notify ?? (() => undefined),
    });
  }

  /** The list of the settings: the vault entries, then each widget project, then each base widget. */
  list(): WidgetItem[] {
    const entries = readWidgetList(this.options.vaultPath);
    const listed = new Set(entries.map((entry) => entry.id));
    const projects = new Set(this.projectAddresses().map((address) => address.id));
    const base = new Set(this.baseAddresses().map((address) => address.id));
    return this.allAddresses(entries).map(({ address, entry }) => {
      const record = this.options.approvals.get(address.id);
      const reviewed = this.reviews.get(address.id)?.review;
      const sources: WidgetSource[] = [
        ...(listed.has(address.id) ? ["list" as const] : []),
        ...(projects.has(address.id) ? ["project" as const] : []),
        ...(base.has(address.id) ? ["base" as const] : []),
      ];
      return {
        id: address.id,
        repository: address.url,
        owner: address.owner,
        name: this.options.redact(record?.name ?? reviewed?.manifest?.name ?? address.name),
        sources,
        state: entry?.enabled !== true ? "off" : matches(record, entry) ? "on" : "approve",
        size: record?.size ?? reviewed?.manifest?.size ?? null,
        problems: reviewed === undefined ? null : reviewed.problems.map((problem) => this.options.redact(problem)),
        update: this.waitingOf(address.id),
      };
    });
  }

  /** Adds a widget by its address, off. */
  add(text: string): WidgetItem[] {
    const address = widgetAddress(text);
    if (address === null)
      throw new EvaError(
        "widget_invalid",
        "This is not the address of a GitHub repository, such as https://github.com/owner/name.",
      );
    const entries = readWidgetList(this.options.vaultPath);
    if (entries.some((entry) => entry.id === address.id))
      throw new EvaError("widget_invalid", "This widget is in the list already.");
    writeWidgetList(this.options.vaultPath, [
      ...entries,
      { id: address.id, repository: address.url, enabled: false, inputs: {} },
    ]);
    return this.list();
  }

  /** Reads the manifest at the newest commit, and checks it, its schemas and its hosts. */
  async review(id: string, ownHosts: readonly string[]): Promise<WidgetReview> {
    const address = this.known(id);
    const commit = await this.options.copies.fetchNewest(address);
    const review = await this.inspect(address, commit, ownHosts);
    this.reviews.set(id, { review, at: this.options.now().getTime() });
    return review;
  }

  /** Checks the manifest, its schemas and its hosts at a fetched commit, and compares it with the approval. */
  private async inspect(address: WidgetAddress, commit: string, ownHosts: readonly string[]): Promise<WidgetReview> {
    const id = address.id;
    const manifestText = await this.options.copies.readAt(address, commit, manifestPath);
    const parsed = manifestText === null ? null : checkManifest(manifestText);
    const files = new Map<string, string | null>([[manifestPath, manifestText]]);
    for (const input of parsed?.manifest?.inputs ?? []) {
      if (input.schema !== undefined)
        files.set(input.schema, await this.options.copies.readAt(address, commit, input.schema));
    }
    const check = checkWidget((path) => files.get(path) ?? null);
    const manifest = parsed?.manifest ?? null;
    const problems = [...check.manifest, ...check.schemas];
    if (manifest !== null) {
      for (const host of manifest.hosts) {
        const hostCheck = checkHost(host.url, ownHosts);
        if (!hostCheck.ok) problems.push(hostCheck.reason);
      }
      if ((await this.options.copies.readAt(address, commit, manifest.entry)) === null)
        problems.push(`The page ${manifest.entry} of the manifest is missing.`);
      // The widget route answers `data/` and `eva/` itself, and never serves a hidden file.
      const [top = ""] = manifest.entry.split("/");
      if (!manifest.entry.split("/").every(isPlainName) || ["data", "eva"].includes(top.toLowerCase()))
        problems.push(
          `Eva cannot serve the page ${manifest.entry}. Put the page outside data/ and eva/, with no hidden name.`,
        );
    }
    const entry = readWidgetList(this.options.vaultPath).find((candidate) => candidate.id === id);
    const record = this.options.approvals.get(id);
    const shown = problems.length === 0 ? manifest : null;
    const added =
      record === null || shown === null
        ? null
        : (await this.changeOf(address, record, shown, commit, entry?.inputs ?? {})).added.map((line) =>
            this.options.redact(line),
          );
    return {
      id: address.id,
      repository: address.url,
      owner: address.owner,
      commit,
      manifest: shown,
      problems: problems.map((problem) => this.options.redact(problem)),
      values: entry?.inputs ?? {},
      installed: record?.commit ?? null,
      added,
      ...(check.newerContract === true ? { newerContract: true } : {}),
    };
  }

  /**
   * What the manifest at `commit` asks for beyond the approval. Each written schema compares by
   * its text at the two commits: the record keeps its path only. Both commits are in the copy.
   */
  private async changeOf(
    address: WidgetAddress,
    record: WidgetApproval,
    manifest: WidgetManifest,
    commit: string,
    values: Readonly<Record<string, WidgetInputValue>>,
  ): Promise<GrantChange> {
    const copies = this.options.copies;
    const approvedText = await copies.readAt(address, record.commit, manifestPath);
    const approvedManifest = approvedText === null ? null : checkManifest(approvedText).manifest;
    const readOnly = readOnlyFallbacks(record, approvedManifest);
    const changedSchemas = new Set<string>();
    for (const input of manifest.inputs) {
      const old = record.paths.find((approved) => approved.input === input.id)?.schema ?? null;
      if (input.access !== "write" || input.schema === undefined || old === null) continue;
      const [before, after] = await Promise.all([
        copies.readAt(address, record.commit, old),
        copies.readAt(address, commit, input.schema),
      ]);
      if (before !== after) changedSchemas.add(input.id);
    }
    return grantChange(record, manifest, values, changedSchemas, readOnly);
  }

  /** Reviews each widget whose last review is old, so the list shows each manifest problem. A failure is a problem too. */
  async reviewAll(ownHosts: readonly string[]): Promise<WidgetItem[]> {
    const now = this.options.now().getTime();
    const due = this.list().filter((item) => {
      const kept = this.reviews.get(item.id);
      return kept === undefined || now - kept.at > reviewKeepMs;
    });
    await Promise.all(
      due.map(async (item) => {
        try {
          await this.review(item.id, ownHosts);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const address = this.known(item.id);
          this.reviews.set(item.id, {
            review: {
              id: item.id,
              repository: address.url,
              owner: address.owner,
              commit: "",
              manifest: null,
              problems: [reason],
              values: {},
              installed: this.options.approvals.get(item.id)?.commit ?? null,
              added: null,
            },
            at: now,
          });
        }
      }),
    );
    return this.list();
  }

  /**
   * Approves the widget at the reviewed commit with these input values, installs that commit and
   * turns the widget on. Eva checks the manifest again at that commit: the page's copy grants nothing.
   * A written format that conflicts with the folder's fails, unless `readOnly`: each input with a
   * conflict then gets read access only (#692).
   */
  async approve(
    id: string,
    commit: string,
    values: Readonly<Record<string, WidgetInputValue>>,
    ownHosts: readonly string[],
    readOnly = false,
  ): Promise<WidgetItem[]> {
    const address = this.known(id);
    const reviewed = this.reviews.get(id)?.review;
    if (reviewed?.commit !== commit) throw new EvaError("widget_invalid", "The widget changed. Open it again.");
    const manifest = reviewed.manifest;
    if (manifest === null) throw new EvaError("widget_invalid", reviewed.problems.join(" "));
    const kept = this.checkValues(manifest.inputs, values);
    const paths = manifest.inputs.flatMap((input): ApprovedPath[] =>
      input.type === "folder" || input.type === "file"
        ? [
            {
              input: input.id,
              type: input.type,
              path: typeof ownValue(kept, input.id) === "string" ? (ownValue(kept, input.id) as string) : null,
              access: input.access ?? "read",
              files: input.files ?? null,
              schema: input.schema ?? null,
            },
          ]
        : [],
    );
    const hosts = manifest.hosts.map((host) => {
      const hostCheck = checkHost(host.url, ownHosts);
      if (!hostCheck.ok) throw new EvaError("widget_invalid", hostCheck.reason);
      return hostCheck.origin;
    });
    // Before the install: the copy must keep the approved commit while the approval can still fail.
    const conflicts = this.formats.conflictsOf(id, manifest.name, paths, await this.schemasAt(address, commit, paths));
    // Reading is always allowed. Only a write that conflicts needs the person's choice.
    const written = new Map(
      [...conflicts].filter(([input]) => paths.some((each) => each.input === input && each.access === "write")),
    );
    if (written.size > 0 && !readOnly) throw new EvaError("widget_format_conflict", conflictText(manifest, written));
    // Read access only: the widget then sets no format, so the folder keeps the other widgets' fields.
    const approvedPaths = paths.map((approved): ApprovedPath =>
      conflicts.has(approved.input) ? { ...approved, access: "read", schema: null } : approved,
    );
    this.installing.add(id);
    try {
      await this.options.copies.install(address, commit);
    } finally {
      this.installing.delete(id);
    }
    this.options.approvals.save(id, {
      repository: address.url,
      commit,
      name: manifest.name,
      size: manifest.size,
      entry: manifest.entry,
      paths: approvedPaths,
      location: manifest.inputs.some((input) => input.type === "eva-location"),
      hosts,
      prompt: manifest.prompt ?? null,
      approvedAt: this.options.now().toISOString(),
    });
    this.revoke(id);
    // An approved update ends its wait; a newer commit than the approved one asks again.
    this.clearWaiting(id, false);
    this.saveEntry(address, { enabled: true, inputs: kept });
    // In the background: a vault sync step can hold the vault for a while, and the approval is done.
    void this.syncFormats();
    return this.list();
  }

  /**
   * Writes the data formats again. It waits for no running Assistant turn: a write then would land
   * in the turn's snapshots. The next sync step tries again, as it does after a failure.
   */
  async syncFormats(): Promise<void> {
    if (this.options.formats?.vaultBusy() === true) return;
    try {
      await this.formats.sync();
    } catch (error) {
      this.options.formats?.log(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Checks each approved widget for a new commit of its default branch (#693). The person's own
   * widgets are due after the set minutes, every other widget after a day; `force` checks every
   * widget now. An update with no new permission installs by itself. Any other update waits,
   * and the person gets one notice for each waiting commit. A failed check waits for the next.
   */
  async checkUpdates(force = false, ownHosts: readonly string[] = defaultOwnHosts): Promise<WidgetItem[]> {
    // Each tick of a minute starts a check: one that runs already is enough.
    if (this.checking !== null && !force) return this.list();
    const run = (this.checking ?? Promise.resolve()).then(() => this.checkAll(force, ownHosts));
    this.checking = run;
    try {
      await run;
    } finally {
      if (this.checking === run) this.checking = null;
    }
    return this.list();
  }

  private async checkAll(force: boolean, ownHosts: readonly string[]): Promise<void> {
    const updates = this.options.updates;
    if (updates === undefined) return;
    const own = new Set(this.projectAddresses().map((address) => address.id));
    const now = this.options.now().getTime();
    const entries = readWidgetList(this.options.vaultPath);
    // A widget with no approval here has no update: its next approval reads the newest commit.
    for (const { id } of updates.state.waiting())
      if (this.options.approvals.get(id) === null) this.clearWaiting(id, true);
    await Promise.all(
      entries.map(async (entry) => {
        const record = this.options.approvals.get(entry.id);
        const address = record === null ? null : widgetAddress(record.repository);
        // A widget that waits for an approval on this computer gets the newest commit at that approval.
        if (record === null || address === null || !matches(record, entry)) return;
        const checkedAt = updates.state.get(entry.id)?.checkedAt ?? null;
        const everyMs = own.has(entry.id) ? Math.max(5, updates.ownMinutes()) * 60_000 : dayMs;
        if (!force && checkedAt !== null && now - Date.parse(checkedAt) < everyMs) return;
        try {
          await this.checkOne(address, record, entry, ownHosts);
        } catch (error) {
          updates.log(this.options.redact(error instanceof Error ? error.message : String(error)));
        }
        updates.state.set(entry.id, address.url, { checkedAt: new Date(now).toISOString() });
      }),
    );
    // Each tick renews the notices: a restart, or a reminder, sends them again.
    for (const { id, repository, waiting } of updates.state.waiting())
      updates.report(updateKey(id, waiting.commit), this.updateProblem(repository, waiting));
  }

  private async checkOne(
    address: WidgetAddress,
    record: WidgetApproval,
    entry: WidgetEntry,
    ownHosts: readonly string[],
  ): Promise<void> {
    const updates = this.options.updates;
    if (updates === undefined) return;
    const id = address.id;
    const newest = await this.options.copies.newestCommit(address);
    const state = updates.state.get(id);
    if (newest === record.commit) {
      // The branch went back to the approved commit: nothing waits any more.
      this.clearWaiting(id, true);
      return;
    }
    if (newest === state?.waiting?.commit || newest === state?.refused) return;
    const commit = await this.options.copies.fetchNewest(address);
    const review = await this.inspect(address, commit, ownHosts);
    this.reviews.set(id, { review, at: this.options.now().getTime() });
    const reasons = [...review.problems];
    let change: GrantChange | null = null;
    if (review.manifest !== null) {
      const manifest = review.manifest;
      try {
        this.checkValues(manifest.inputs, entry.inputs);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error));
      }
      change = await this.changeOf(address, record, manifest, commit, entry.inputs);
      const conflicts = this.formats.conflictsOf(
        id,
        manifest.name,
        change.grant.paths,
        await this.schemasAt(address, commit, change.grant.paths),
      );
      const written = new Map(
        [...conflicts].filter(([input]) =>
          change?.grant.paths.some((each) => each.input === input && each.access === "write"),
        ),
      );
      if (written.size > 0) reasons.push(conflictText(manifest, written));
      if (change.added.length === 0 && reasons.length === 0) {
        await this.installUpdate(address, record, manifest, change.grant, commit);
        return;
      }
    }
    const notes = await this.notesOf(address, record.commit, commit);
    const old = state?.waiting ?? null;
    if (old !== null) updates.dismiss(updateKey(id, old.commit));
    const waiting: WaitingUpdate = {
      commit,
      permissions: (change?.added ?? []).map((line) => this.options.redact(line)),
      reasons: reasons.map((line) => this.options.redact(line)),
      notes,
      foundAt: this.options.now().toISOString(),
    };
    // The renewal at the end of the check sends the notice.
    updates.state.set(id, address.url, { waiting });
  }

  /**
   * Installs an update that asks for nothing new. The copy switches whole, and the record gets the
   * new commit only after the files are in place. The tokens of the old commit stop, so the grid
   * loads the new version at its next ask.
   */
  private async installUpdate(
    address: WidgetAddress,
    record: WidgetApproval,
    manifest: WidgetManifest,
    grant: WidgetGrant,
    commit: string,
  ): Promise<void> {
    this.installing.add(address.id);
    try {
      await this.options.copies.install(address, commit);
    } finally {
      this.installing.delete(address.id);
    }
    this.options.approvals.save(address.id, {
      ...record,
      ...grant,
      commit,
      name: manifest.name,
      size: manifest.size,
      entry: manifest.entry,
    });
    this.revoke(address.id);
    this.clearWaiting(address.id, true);
    void this.syncFormats();
  }

  /** Keeps the installed version, and asks again only for a newer commit than the waiting one. */
  refuseUpdate(id: string): WidgetItem[] {
    const address = this.known(id);
    const waiting = this.options.updates?.state.get(id)?.waiting ?? null;
    if (waiting === null) throw new EvaError("widget_invalid", "No update of this widget waits.");
    this.options.updates?.state.set(id, address.url, { waiting: null, refused: waiting.commit });
    this.options.updates?.dismiss(updateKey(id, waiting.commit));
    return this.list();
  }

  /** Ends the wait of an update: it installed, or nothing waits any more. `quiet` sends no "resolved" line. */
  private clearWaiting(id: string, quiet: boolean): void {
    const updates = this.options.updates;
    const state = updates?.state.get(id) ?? null;
    const waiting = state?.waiting ?? null;
    if (updates === undefined || state === null || waiting === null) return;
    const key = updateKey(id, waiting.commit);
    updates.state.set(id, state.repository, { waiting: null });
    if (quiet) updates.dismiss(key);
    else updates.report(key, null);
  }

  private waitingOf(id: string): WidgetUpdateView | null {
    const waiting = this.options.updates?.state.get(id)?.waiting ?? null;
    if (waiting === null) return null;
    const { commit, permissions, reasons, notes } = waiting;
    return { commit, permissions, reasons, notes };
  }

  /** The release notes since the approved commit, or else the commit subjects. A failure gives none. */
  private async notesOf(address: WidgetAddress, from: string, to: string): Promise<string[]> {
    const github = this.options.updates?.github;
    if (github === undefined) return [];
    try {
      return (await releaseNotes(github, `${address.owner}/${address.name}`, from, to)).map((line) =>
        this.options.redact(line),
      );
    } catch (error) {
      this.options.updates?.log(this.options.redact(error instanceof Error ? error.message : String(error)));
      return [];
    }
  }

  /** The notice of a waiting update: the new permissions or the reasons, then the notes, and where to answer. */
  private updateProblem(repository: string, waiting: WaitingUpdate): AlertProblem {
    const name = this.options.redact(
      this.options.approvals.get(widgetAddress(repository)?.id ?? "")?.name ?? repository,
    );
    const lines = [
      waiting.permissions.length > 0
        ? `An update of the widget ${name} asks for new permissions: ${waiting.permissions.join(" ")}`
        : `An update of the widget ${name} waits: ${waiting.reasons.join(" ")}`,
      ...(waiting.permissions.length > 0 && waiting.reasons.length > 0 ? [waiting.reasons.join(" ")] : []),
      ...(waiting.notes.length > 0 ? [`What changed: ${waiting.notes.join("; ")}.`] : []),
      "The old version keeps running. Open Settings, Personalize, Widgets to approve or keep the old version.",
    ];
    return {
      level: "warn",
      message: oneLine(lines.join(" ")),
      resolvedMessage: `The widget ${name} is up to date.`,
    };
  }

  /** The schema of each input with a path, read at the commit, by its path in the widget. */
  private async schemasAt(
    address: WidgetAddress,
    commit: string,
    paths: readonly ApprovedPath[],
  ): Promise<Map<string, unknown>> {
    const schemas = new Map<string, unknown>();
    for (const approved of paths) {
      if (approved.schema === null || approved.path === null || schemas.has(approved.schema)) continue;
      const text = await this.options.copies.readAt(address, commit, approved.schema);
      try {
        if (text !== null) schemas.set(approved.schema, JSON.parse(text) as unknown);
      } catch {
        // The review refuses a schema that does not parse, so only a changed commit has one.
      }
    }
    return schemas;
  }

  /** Turns a widget off, or on again with its approval. With no matching approval, the page must review it. */
  setEnabled(id: string, enabled: boolean): WidgetItem[] {
    const address = this.known(id);
    this.revoke(id);
    const entry = readWidgetList(this.options.vaultPath).find((candidate) => candidate.id === id);
    if (enabled && (entry === undefined || !matches(this.options.approvals.get(id), entry)))
      throw new EvaError("widget_needs_approval", "Approve this widget on this computer first.");
    this.saveEntry(address, { enabled, inputs: entry?.inputs ?? {} });
    return this.list();
  }

  /** Removes the approval, the copy and the vault entry. The person's data stays. */
  remove(id: string): WidgetItem[] {
    const address = this.known(id);
    this.revoke(id);
    this.reviews.delete(id);
    this.clearWaiting(id, true);
    this.options.updates?.state.remove(id);
    this.options.approvals.remove(id);
    this.options.copies.remove(address);
    const entries = readWidgetList(this.options.vaultPath);
    writeWidgetList(
      this.options.vaultPath,
      entries.filter((entry) => entry.id !== id),
    );
    // In the background: the list answers at once, and the formats lose the widget's fields.
    void this.syncFormats();
    return this.list();
  }

  /** Moves a widget one place up or down. The whole list goes into the vault, so each computer has the same order. */
  move(id: string, direction: "up" | "down"): WidgetItem[] {
    const entries = readWidgetList(this.options.vaultPath);
    const all = this.allAddresses(entries).map(
      ({ address, entry }): WidgetEntry =>
        entry ?? { id: address.id, repository: address.url, enabled: false, inputs: {} },
    );
    const from = all.findIndex((entry) => entry.id === id);
    if (from === -1) throw new EvaError("widget_not_found", "No widget of the list has this id.");
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= all.length) return this.list();
    const moved = all.filter((entry) => entry.id !== id);
    moved.splice(to, 0, ...all.slice(from, from + 1));
    writeWidgetList(this.options.vaultPath, moved);
    return this.list();
  }

  /**
   * The cards of the grid, in the list order, each with a token. A token in `keep` that still
   * works for its widget stays, so a reconnect does not reload a widget.
   */
  frames(theme: WidgetTheme, keep: readonly string[]): WidgetFrame[] {
    const now = this.options.now().getTime();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    const kept = new Map<string, string>();
    for (const token of keep) {
      const session = this.sessions.get(token);
      if (session !== undefined && session.expiresAt - now > tokenRenewMs) kept.set(session.id, token);
    }
    return readWidgetList(this.options.vaultPath)
      .filter((entry) => entry.enabled)
      .map((entry) => {
        const record = this.options.approvals.get(entry.id);
        const name = widgetAddress(entry.repository)?.name ?? entry.id;
        if (record === null || !matches(record, entry))
          return {
            id: entry.id,
            name: this.options.redact(name),
            size: record?.size ?? "small",
            src: null,
            token: null,
          };
        let token = kept.get(entry.id);
        const session = token === undefined ? undefined : this.sessions.get(token);
        if (token === undefined || session?.commit !== record.commit) {
          token = randomBytes(32).toString("base64url");
          this.sessions.set(token, { id: entry.id, commit: record.commit, theme, expiresAt: now + tokenLifeMs });
        } else {
          session.theme = theme;
        }
        return {
          id: entry.id,
          name: this.options.redact(record.name),
          size: record.size,
          src: `/widgets/${token}/${record.entry}`,
          token,
        };
      });
  }

  /** Ends the tokens of a page that closes. */
  release(tokens: readonly string[]): void {
    for (const token of tokens) this.sessions.delete(token);
  }

  /** True while the token works: its widget is on, approved and unchanged. */
  isLive(token: string): boolean {
    return this.liveSession(token) !== null;
  }

  /** The approved hosts of a token, for the policy of its answers. It reads no vault file: each answer needs it. */
  hostsOf(token: string): readonly string[] {
    const session = this.sessions.get(token);
    return session === undefined ? [] : (this.options.approvals.get(session.id)?.hosts ?? []);
  }

  /**
   * Answers one request of a widget, or null for a token that does not work. `path` is the
   * decoded part after the token. A contract path never falls through to the copy's mock files.
   */
  async serve(token: string, path: string, method: string, body: Uint8Array | null): Promise<WidgetAnswer | null> {
    const live = this.liveSession(token);
    if (live === null) return null;
    const { session, record, entry, address } = live;
    const [first, second] = path.split("/");
    // Without case: on a file system that ignores case, `Data/` or `Config.json` would read the mock files of the copy.
    const contract = (first ?? "").toLowerCase();
    if (first === "data") {
      const approved = record.paths.find((candidate) => candidate.input === second);
      const value = approved?.path ?? null;
      if (approved === undefined || value === null || second === undefined) return { status: 404 };
      const prefix = `data/${second}`;
      const rest = path === prefix ? null : path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
      if (rest === undefined) return { status: 404 };
      const open = { ...approved, path: value };
      if (method === "GET" || method === "HEAD") return answerData(this.options.vaultPath, open, rest, "GET", null);
      const schema =
        method === "PUT" && approved.schema !== null
          ? installedSchema(this.options.copies, address, approved.schema)
          : null;
      const write = body === null ? null : { body, schema, redact: this.options.redact };
      return this.options.exclusive(() => {
        const answer = answerData(this.options.vaultPath, open, rest, method, write);
        if (method === "PUT" && answer.status === 204) this.formats.wrote(rest === null ? value : `${value}/${rest}`);
        return answer;
      });
    }
    if (method !== "GET" && method !== "HEAD") return { status: 405 };
    if (path === "config.json") return json(configOf(record, entry));
    if (path === "eva/location.json") return json(record.location ? locationOf(this.options.location()) : null);
    if (path === "eva/theme.css")
      return { status: 200, contentType: "text/css; charset=utf-8", body: themeCss(session.theme) };
    if (contract === "eva" || contract === "data" || path.toLowerCase() === "config.json" || path === "")
      return { status: 404 };
    // While git switches the copy, a file could come from either commit.
    if (this.installing.has(session.id)) return { status: 503 };
    return this.options.copies.serveFile(address, path);
  }

  private liveSession(token: string): {
    readonly session: FrameSession;
    readonly record: WidgetApproval;
    readonly entry: WidgetEntry;
    readonly address: WidgetAddress;
  } | null {
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    const record = this.options.approvals.get(session.id);
    if (session.expiresAt <= this.options.now().getTime() || record?.commit !== session.commit) {
      this.sessions.delete(token);
      return null;
    }
    // A failed read of the vault list, such as during a sync, refuses this request only: the
    // token stays, so the widget works again at its next request. Off and remove end it in `revoke`.
    const entry = readWidgetList(this.options.vaultPath).find((candidate) => candidate.id === session.id);
    const address = widgetAddress(record.repository);
    if (entry?.enabled !== true || !matches(record, entry) || address === null) return null;
    return { session, record, entry, address };
  }

  private checkValues(
    inputs: readonly WidgetInput[],
    values: Readonly<Record<string, WidgetInputValue>>,
  ): Record<string, WidgetInputValue> {
    return checkValues(this.options.vaultPath, inputs, values);
  }

  private saveEntry(address: WidgetAddress, change: Pick<WidgetEntry, "enabled" | "inputs">): void {
    const entries = readWidgetList(this.options.vaultPath);
    const index = entries.findIndex((entry) => entry.id === address.id);
    const next: WidgetEntry = { id: address.id, repository: address.url, ...change };
    writeWidgetList(
      this.options.vaultPath,
      index === -1 ? [...entries, next] : entries.map((entry, at) => (at === index ? next : entry)),
    );
  }

  private revoke(id: string): void {
    for (const [token, session] of this.sessions) if (session.id === id) this.sessions.delete(token);
  }

  private known(id: string): WidgetAddress {
    const found = this.allAddresses(readWidgetList(this.options.vaultPath)).find(({ address }) => address.id === id);
    if (found === undefined) throw new EvaError("widget_not_found", "No widget of the list has this id.");
    return found.address;
  }

  private allAddresses(entries: readonly WidgetEntry[]): { address: WidgetAddress; entry: WidgetEntry | null }[] {
    const seen = new Set<string>();
    const all: { address: WidgetAddress; entry: WidgetEntry | null }[] = [];
    const add = (address: WidgetAddress | null, entry: WidgetEntry | null): void => {
      if (address === null || seen.has(address.id)) return;
      seen.add(address.id);
      all.push({ address, entry });
    };
    for (const entry of entries) add(widgetAddress(entry.repository), entry);
    for (const address of [...this.projectAddresses(), ...this.baseAddresses()]) add(address, null);
    return all;
  }

  /** Each repository of the widget type in the person's projects (#681). */
  private projectAddresses(): WidgetAddress[] {
    return this.options.projects().flatMap((project) =>
      project.frontMatter.repos.flatMap((url) => {
        const address = project.frontMatter.repoTypes[url] === "widget" ? widgetAddress(url) : null;
        return address === null ? [] : [address];
      }),
    );
  }

  private baseAddresses(): WidgetAddress[] {
    return this.options.baseWidgets.flatMap((url) => {
      const address = widgetAddress(url);
      return address === null ? [] : [address];
    });
  }
}

/** The location of the contract: no source, so a widget does not learn which device sent it. */
function locationOf(location: LastLocation | null): Omit<LastLocation, "source"> | null {
  if (location === null) return null;
  const { latitude, longitude, accuracy, at } = location;
  return { latitude, longitude, accuracy, at };
}

/** The warning of a conflict: each folder and field, and what the person can do. */
function conflictText(manifest: WidgetManifest, conflicts: ReadonlyMap<string, readonly FormatConflict[]>): string {
  const lines = [...conflicts].map(([input, found]) => {
    const folder = manifest.inputs.find((candidate) => candidate.id === input)?.label ?? input;
    const fields = found.map((conflict) => `the field "${conflict.path}" is ${conflict.reason}`).join("; ");
    return `${folder}: ${fields}.`;
  });
  return oneLine(
    `${manifest.name} does not fit the data that the folder holds already. ${lines.join(" ")} Turn it on with read access only, or pick another folder.`,
  );
}

function json(value: unknown): WidgetAnswer {
  return { status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(value) };
}
