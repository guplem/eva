/**
 * The preview of a widget from a clone (#693). It shows the clone's folder as it is, so the
 * person sees a change with no push and no merge. A clone is agent work, so it gets no more trust
 * than an installed widget: a sandboxed frame, a token path, the policy, and the path checks.
 * The preview never serves a hidden name such as `.git/`, a link, or a file that git ignores.
 *
 * "Example data" answers the contract paths with the clone's mock files, and refuses each write.
 * "My data" answers them from the vault. A widget that is set up keeps its values and approval,
 * and asks only for what the clone adds; any other widget asks for each permission. What the
 * person approves here stays in `state/widget-previews.json`, apart from the approved records and
 * from `.eva/widgets.json`, until the clone goes.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { listClones, repositoryName } from "../projects/clones.ts";
import type { Project } from "../projects/project-catalog.ts";
import type { LastLocation } from "../vault/about-me.ts";
import { contentHash } from "../vault/template-alignment.ts";
import { widgetAddress, type WidgetAddress } from "./widget-address.ts";
import { approvalSchema, configOf, matches, type WidgetApprovals } from "./widget-approvals.ts";
import { grantChange, readOnlyFallbacks, type WidgetGrant } from "./widget-changes.ts";
import { checkManifest, manifestPath, type WidgetManifest } from "./widget-contract.ts";
import { serveFolderFile, type WidgetCopies } from "./widget-copies.ts";
import { answerDataPath, contractLocation, jsonAnswer, type WidgetAnswer } from "./widget-data.ts";
import { checkHost } from "./widget-hosts.ts";
import { readWidgetList, widgetInputValueSchema, type WidgetInputValue } from "./widget-list.ts";
import { themeCss, type WidgetTheme } from "./widget-policy.ts";
import { checkValues, inspectFiles } from "./widget-values.ts";

export type PreviewMode = "example" | "mine";

/** The clone of a widget project, as the project page names it. */
export interface PreviewPlace {
  readonly project: string;
  readonly clone: string;
  readonly repository: string;
}

/** What "My data" asks before it shows the person's data. */
export interface PreviewAsk {
  readonly manifest: WidgetManifest;
  /** True when the widget is set up in Eva: `added` lists only what the clone adds. */
  readonly setUp: boolean;
  readonly added: readonly string[];
  /** The values to start the form with. */
  readonly values: Readonly<Record<string, WidgetInputValue>>;
  /** The hash of the manifest that the person sees, so an approval fits that manifest only. */
  readonly digest: string;
}

export interface WidgetPreview {
  readonly name: string;
  readonly size: WidgetManifest["size"] | null;
  readonly mode: PreviewMode;
  /** The token path of the entry page, or null when the preview cannot show yet. */
  readonly src: string | null;
  readonly token: string | null;
  readonly problems: readonly string[];
  /** "My data" only: what to approve first, or null. */
  readonly ask: PreviewAsk | null;
}

/** One preview grant. The file is `{ version, previews: [grant] }`. */
export const previewGrantSchema = z.object({
  /** The clone's repository folder on this computer. */
  folder: z.string(),
  repository: z.string(),
  paths: approvalSchema.shape.paths,
  location: z.boolean(),
  hosts: z.array(z.string()),
  prompt: z.string().nullable(),
  values: z.record(z.string(), widgetInputValueSchema),
  /** The hash of each written schema, by its path in the clone, as the person approved it. */
  schemas: z.record(z.string(), z.string()),
  approvedAt: z.string(),
});

export const widgetPreviewsVersion = 1;

type PreviewGrant = z.infer<typeof previewGrantSchema>;

/** The grants of the previews on this computer. Without a path, they live in memory only. */
export class PreviewGrants {
  private readonly path: string | null;
  private readonly grants: Map<string, PreviewGrant>;

  constructor(path: string | null) {
    this.path = path;
    this.grants = new Map();
    const read = path === null ? null : readJsonTolerant(path);
    const list = read?.ok === true ? (read.value as { previews?: unknown } | null)?.previews : undefined;
    for (const raw of Array.isArray(list) ? list : []) {
      const parsed = previewGrantSchema.safeParse(raw);
      if (parsed.success) this.grants.set(parsed.data.folder, parsed.data);
    }
  }

  get(folder: string): PreviewGrant | null {
    return this.grants.get(folder) ?? null;
  }

  save(grant: PreviewGrant): void {
    this.grants.set(grant.folder, grant);
    this.write();
  }

  /** Drops the grant of each clone that is gone. */
  prune(): void {
    let changed = false;
    for (const folder of this.grants.keys()) {
      if (existsSync(folder)) continue;
      this.grants.delete(folder);
      changed = true;
    }
    if (changed) this.write();
  }

  private write(): void {
    if (this.path === null) return;
    const file = { version: widgetPreviewsVersion, previews: [...this.grants.values()] };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }
}

export interface WidgetPreviewsOptions {
  readonly vaultPath: string;
  readonly approvals: WidgetApprovals;
  readonly copies: WidgetCopies;
  readonly grants: PreviewGrants;
  readonly projects: () => readonly Project[];
  readonly location: () => LastLocation | null;
  readonly exclusive: <Result>(work: () => Result) => Promise<Result>;
  readonly redact: (text: string) => string;
  readonly now: () => Date;
  /** Hears each vault file that a preview wrote, as the data formats do for an installed widget. */
  readonly wrote: (path: string) => void;
}

interface PreviewSession {
  readonly folder: string;
  readonly mode: PreviewMode;
  readonly manifest: WidgetManifest;
  readonly theme: WidgetTheme;
  readonly hosts: readonly string[];
  /** "mine": what the preview may reach, and the values of `config.json`. */
  readonly grant: WidgetGrant | null;
  readonly values: Readonly<Record<string, WidgetInputValue>>;
  /** "mine" on the approval of a set-up widget: the record and commit that it stands on. */
  readonly record: { readonly id: string; readonly commit: string } | null;
  readonly expiresAt: number;
}

/** A preview is a moment of work: its token ends after an hour, or when the page closes. */
const previewLifeMs = 60 * 60_000;

export class WidgetPreviews {
  private readonly options: WidgetPreviewsOptions;
  private readonly sessions: Map<string, PreviewSession>;

  constructor(options: WidgetPreviewsOptions) {
    this.options = options;
    this.sessions = new Map();
  }

  /** Opens a preview of a clone. "mine" shows the person's data, or asks first. */
  async open(
    place: PreviewPlace,
    mode: PreviewMode,
    theme: WidgetTheme,
    ownHosts: readonly string[],
  ): Promise<WidgetPreview> {
    this.options.grants.prune();
    const { folder, address } = this.target(place);
    const check = await inspectFiles((path) => Promise.resolve(readFolderText(folder, path)), ownHosts);
    const manifest = check.manifest;
    const problems = check.problems.map((problem) => this.options.redact(problem));
    const view = { name: this.options.redact(manifest?.name ?? place.repository), size: manifest?.size ?? null, mode };
    if (manifest === null || problems.length > 0) return { ...view, src: null, token: null, problems, ask: null };
    const hosts = manifest.hosts.flatMap((host) => {
      const hostCheck = checkHost(host.url, ownHosts);
      return hostCheck.ok ? [hostCheck.origin] : [];
    });
    if (mode === "example")
      return {
        ...view,
        ...this.start({ folder, manifest, mode, theme, hosts, grant: null, values: {}, record: null }),
        problems,
        ask: null,
      };
    const mine = this.mine(folder, address, manifest);
    if ("ask" in mine) return { ...view, src: null, token: null, problems, ask: mine.ask };
    return {
      ...view,
      ...this.start({ folder, manifest, mode, theme, hosts: mine.grant.hosts, ...mine }),
      problems,
      ask: null,
    };
  }

  /**
   * Approves "My data" for this clone with these values: the whole manifest of the clone, as the
   * person saw it. It changes no approved record and no vault entry.
   */
  async approve(
    place: PreviewPlace,
    digest: string,
    values: Readonly<Record<string, WidgetInputValue>>,
    theme: WidgetTheme,
    ownHosts: readonly string[],
  ): Promise<WidgetPreview> {
    const { folder, address } = this.target(place);
    const text = readFolderText(folder, manifestPath);
    const manifest = text === null ? null : checkManifest(text).manifest;
    if (manifest === null || text === null || contentHash(text) !== digest)
      throw new EvaError("widget_invalid", "The clone changed. Open the preview again.");
    const kept = checkValues(this.options.vaultPath, manifest.inputs, values);
    for (const host of manifest.hosts) {
      const hostCheck = checkHost(host.url, ownHosts);
      if (!hostCheck.ok) throw new EvaError("widget_invalid", hostCheck.reason);
    }
    const { grant } = grantChange(null, manifest, kept, new Set(), new Set());
    this.options.grants.save({
      folder,
      repository: address?.url ?? "",
      ...grant,
      values: kept,
      schemas: schemaHashes(grant, (path) => readFolderText(folder, path)),
      approvedAt: this.options.now().toISOString(),
    });
    return this.open(place, "mine", theme, ownHosts);
  }

  /** Drops what the person approved for each clone that is gone. */
  prune(): void {
    this.options.grants.prune();
  }

  has(token: string): boolean {
    return this.sessions.has(token);
  }

  isLive(token: string): boolean {
    return this.live(token) !== null;
  }

  hostsOf(token: string): readonly string[] {
    return this.sessions.get(token)?.hosts ?? [];
  }

  release(tokens: readonly string[]): void {
    for (const token of tokens) this.sessions.delete(token);
  }

  /** Answers one request of a preview, or null for a token that does not work. */
  async serve(token: string, path: string, method: string, body: Uint8Array | null): Promise<WidgetAnswer | null> {
    const session = this.live(token);
    if (session === null) return null;
    const [first = ""] = path.split("/");
    // Without case: on a file system that ignores case, `Eva/` is `eva/`.
    const contract = first.toLowerCase();
    if (path === "eva/theme.css" && (method === "GET" || method === "HEAD"))
      return { status: 200, contentType: "text/css; charset=utf-8", body: themeCss(session.theme) };
    const grant = session.grant;
    if (grant !== null && first === "data")
      return answerDataPath({
        vaultPath: this.options.vaultPath,
        paths: grant.paths,
        path,
        method,
        body,
        schemaOf: (schema) => parsed(readFolderText(session.folder, schema)),
        exclusive: this.options.exclusive,
        redact: this.options.redact,
        wrote: this.options.wrote,
      });
    // Example data changes nothing: the widget shows its demo note.
    if (method !== "GET" && method !== "HEAD") return { status: 405 };
    const location = session.manifest.inputs.some((input) => input.type === "eva-location");
    if (path === "eva/location.json") {
      if (grant !== null) return jsonAnswer(grant.location ? contractLocation(this.options.location()) : null);
      return location ? await this.file(session, "example/location.json") : jsonAnswer(null);
    }
    if (contract === "eva" || path === "") return { status: 404 };
    if (grant !== null) {
      if (path === "config.json") return jsonAnswer(configOf(grant, { inputs: session.values }));
      if (contract === "data" || path.toLowerCase() === "config.json") return { status: 404 };
    }
    return this.file(session, path);
  }

  /** The grant of "My data": the clone's manifest on the approval of the widget or of an earlier preview. */
  private mine(
    folder: string,
    address: WidgetAddress | null,
    manifest: WidgetManifest,
  ):
    | { readonly ask: PreviewAsk }
    | {
        readonly grant: WidgetGrant;
        readonly values: Readonly<Record<string, WidgetInputValue>>;
        readonly record: PreviewSession["record"];
      } {
    const id = address?.id ?? null;
    const record = id === null ? null : this.options.approvals.get(id);
    const entry = id === null ? undefined : readWidgetList(this.options.vaultPath).find((each) => each.id === id);
    const setUp = record !== null && entry !== undefined && matches(record, entry);
    const stored = this.options.grants.get(folder);
    const copy = address;
    const base: Base | null =
      stored !== null
        ? { grant: stored, values: stored.values, hash: (path) => stored.schemas[path] ?? null, readOnly: new Set() }
        : setUp && copy !== null
          ? {
              grant: record,
              values: entry.inputs,
              hash: (path) => installedHash(this.options.copies, copy, path),
              readOnly: readOnlyFallbacks(record, installedManifest(this.options.copies, copy)),
            }
          : null;
    const values = base?.values ?? entry?.inputs ?? {};
    const changed = new Set<string>();
    for (const input of manifest.inputs) {
      const old = base?.grant.paths.find((each) => each.input === input.id)?.schema ?? null;
      if (input.access !== "write" || input.schema === undefined || old === null || base === null) continue;
      const now = readFolderText(folder, input.schema);
      if (base.hash(old) !== (now === null ? null : contentHash(now))) changed.add(input.id);
    }
    const change = grantChange(base?.grant ?? null, manifest, values, changed, base?.readOnly ?? new Set());
    let valid = true;
    try {
      checkValues(this.options.vaultPath, manifest.inputs, values);
    } catch {
      valid = false;
    }
    if (base !== null && valid && change.added.length === 0) {
      const standsOn = stored === null && record !== null && id !== null ? { id, commit: record.commit } : null;
      return { grant: change.grant, values, record: standsOn };
    }
    const text = readFolderText(folder, manifestPath) ?? "";
    return {
      ask: {
        manifest,
        setUp: base !== null,
        added: change.added.map((line) => this.options.redact(line)),
        values,
        digest: contentHash(text),
      },
    };
  }

  private start(session: Omit<PreviewSession, "expiresAt">): { readonly src: string; readonly token: string } {
    const now = this.options.now().getTime();
    for (const [token, each] of this.sessions) if (each.expiresAt <= now) this.sessions.delete(token);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { ...session, expiresAt: now + previewLifeMs });
    return { src: `/widgets/${token}/${session.manifest.entry}`, token };
  }

  private live(token: string): PreviewSession | null {
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    // The clone went, or the approval that the preview stands on changed: the token ends.
    const record = session.record === null ? null : this.options.approvals.get(session.record.id);
    const entry =
      session.record === null
        ? undefined
        : readWidgetList(this.options.vaultPath).find((each) => each.id === session.record?.id);
    const standing =
      session.record === null ||
      (record?.commit === session.record.commit && entry !== undefined && matches(record, entry));
    if (session.expiresAt <= this.options.now().getTime() || !existsSync(session.folder) || !standing) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  /** A file of the clone that git tracks or that git does not ignore. */
  private async file(session: PreviewSession, path: string): Promise<WidgetAnswer> {
    const answer = serveFolderFile(session.folder, path);
    if (answer.status !== 200) return answer;
    return (await this.options.copies.ignoredIn(session.folder, path)) ? { status: 404 } : answer;
  }

  /** The clone's repository folder, from the list of clones, never from a name: a name cannot point outside it. */
  private target(place: PreviewPlace): { readonly folder: string; readonly address: WidgetAddress | null } {
    const project = this.options.projects().find((candidate) => candidate.id === place.project);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${place.project} in the vault.`);
    const clone = listClones(project.path).find((candidate) => candidate.name === place.clone);
    const repository = clone?.repositories.find((candidate) => candidate.name === place.repository);
    if (repository === undefined)
      throw new EvaError(
        "project_not_found",
        `${place.project} has no repository ${place.repository} in ${place.clone}.`,
      );
    const url = project.frontMatter.repos.find(
      (candidate) =>
        project.frontMatter.repoTypes[candidate] === "widget" && repositoryName(candidate) === repository.name,
    );
    if (url === undefined) throw new EvaError("widget_invalid", `${repository.name} is not a widget repository.`);
    return { folder: repository.path, address: widgetAddress(url) };
  }
}

interface Base {
  readonly grant: WidgetGrant;
  readonly values: Readonly<Record<string, WidgetInputValue>>;
  /** The hash of a schema as it was approved, by its path, or null. */
  readonly hash: (path: string) => string | null;
  readonly readOnly: ReadonlySet<string>;
}

/** The text of a file of a folder, with the checks of a served file, or null. */
function readFolderText(folder: string, path: string): string | null {
  const answer = serveFolderFile(folder, path);
  if (answer.status !== 200 || answer.body === undefined) return null;
  return typeof answer.body === "string" ? answer.body : Buffer.from(answer.body).toString("utf-8");
}

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function installedHash(copies: WidgetCopies, address: WidgetAddress, path: string): string | null {
  const answer = copies.serveFile(address, path);
  if (answer.status !== 200 || answer.body === undefined) return null;
  return contentHash(typeof answer.body === "string" ? answer.body : Buffer.from(answer.body).toString("utf-8"));
}

function installedManifest(copies: WidgetCopies, address: WidgetAddress): WidgetManifest | null {
  const answer = copies.serveFile(address, manifestPath);
  if (answer.status !== 200 || answer.body === undefined) return null;
  const text = typeof answer.body === "string" ? answer.body : Buffer.from(answer.body).toString("utf-8");
  return checkManifest(text).manifest;
}

function schemaHashes(grant: WidgetGrant, read: (path: string) => string | null): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of grant.paths) {
    if (path.schema === null) continue;
    const text = read(path.schema);
    if (text !== null) hashes[path.schema] = contentHash(text);
  }
  return hashes;
}
