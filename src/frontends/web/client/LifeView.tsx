/**
 * The Life pages (#911): one page for each kind of entity in the vault's `Life/` folder. The list
 * shows a card for each entity, with a body fitted to its kind. An entity opens its own page with
 * its facts, its text and the files beside it. `life-pages.ts` holds every rule. This file only draws.
 */
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { api, ApiError, type LifeEntity, type LifeEntityDetail } from "./api.ts";
import { goTo, goUp } from "./back-layers.ts";
import { displayFormat } from "./display-format.ts";
import { useShowError } from "./error-toast.tsx";
import { FactList } from "./FactList.tsx";
import { fileAddressOf } from "./file-paths.ts";
import { Icon, type IconName } from "./icons.tsx";
import {
  bodyWithoutTitle,
  caseSteps,
  lifeAddressOf,
  lifeCardOf,
  lifeCardPill,
  lifeCounts,
  lifeFacts,
  lifeGroups,
  lifePages,
  matchesLifeSearch,
  type CaseStep,
  type DayState,
  type LifeCard,
  type LifeCardBody,
  type LifePill,
} from "./life-pages.ts";
import { FactsSkeleton } from "./Loading.tsx";
import { BackButton } from "./MainNav.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { countOf } from "./project-format.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { toWebHtml } from "./web-format.ts";
import type { LifeKind } from "../../../shared/life-kinds.ts";

/** The search filters as the person types, after a short pause, so a long list does not stutter. */
const searchPauseMs = 150;

export function LifeView({
  kind,
  entityId,
}: {
  readonly kind: LifeKind;
  readonly entityId: string | null;
}): ReactElement {
  // The list state stays while an entity is open, so Back returns to the same search and filter.
  const [list, setList] = useState<readonly LifeEntity[] | "failed" | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(lifePages[kind].defaultFilter);
  const showError = useShowError();

  useEffect(() => {
    // An answer for an older kind must not fill the list of a newer one.
    let isCurrent = true;
    setList(null);
    api.lifeEntities(kind).then(
      (found) => {
        if (isCurrent) setList(found);
      },
      (caught: unknown) => {
        if (!isCurrent) return;
        setList("failed");
        showError(caught);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [kind, listVersion, showError]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), searchPauseMs);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="main life-view">
      {entityId === null ? (
        <LifeList
          kind={kind}
          list={list}
          search={search}
          query={query}
          filter={filter}
          onSearch={setSearch}
          onFilter={setFilter}
          onRetry={() => setListVersion((version) => version + 1)}
        />
      ) : (
        <LifeEntityPage key={entityId} kind={kind} entityId={entityId} />
      )}
    </div>
  );
}

// The list

interface LifeListProps {
  readonly kind: LifeKind;
  readonly list: readonly LifeEntity[] | "failed" | null;
  readonly search: string;
  readonly query: string;
  readonly filter: string;
  readonly onSearch: (text: string) => void;
  readonly onFilter: (filter: string) => void;
  readonly onRetry: () => void;
}

function LifeList({ kind, list, search, query, filter, onSearch, onFilter, onRetry }: LifeListProps): ReactElement {
  const page = lifePages[kind];
  const now = new Date();
  const entities: readonly LifeEntity[] = list === null || list === "failed" ? [] : list;
  const found = entities.filter((entity) => matchesLifeSearch(entity, query));
  const groups = lifeGroups(kind, found, filter, now);
  const hasEntities = entities.length > 0;
  return (
    <>
      <div className="main-header">
        <div className="header-text">
          <h1>{page.title}</h1>
          <div className="sub">{hasEntities ? lifeCounts(kind, entities, now) : page.description}</div>
        </div>
      </div>
      <div className="life-page">
        {hasEntities && (
          <div className="life-tools">
            <input
              className="project-search life-search"
              type="search"
              aria-label={page.searchLabel}
              placeholder={page.searchLabel}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            {page.filters.length > 0 && (
              <div className="filter-chips" role="group" aria-label="Show">
                {page.filters.map((choice) => (
                  <button
                    key={choice.id}
                    className="filter-chip"
                    aria-pressed={filter === choice.id}
                    onClick={() => onFilter(choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {list === null && <LifeListSkeleton kind={kind} />}
        {list === "failed" && (
          <div className="callout danger life-failed" role="alert">
            Eva could not read the {page.title.toLowerCase()}. <button onClick={onRetry}>Try again</button>
          </div>
        )}
        {Array.isArray(list) && !hasEntities && (
          <div className="life-empty">
            <Visor size={76} face={stateFaces.resting} />
            <strong>No {page.title.toLowerCase()} yet.</strong>
            <p>{page.empty}</p>
          </div>
        )}
        {hasEntities && groups.length === 0 && (
          <div className="life-none" role="status">
            {query.trim() === "" ? (
              <>
                Nothing to show with this filter.{" "}
                <button className="ghost" onClick={() => onFilter("all")}>
                  Show all
                </button>
              </>
            ) : (
              <>Nothing matches “{query.trim()}”.</>
            )}
          </div>
        )}
        {groups.map((group) => (
          <section key={group.label ?? "all"} className="life-group" aria-label={group.label ?? page.title}>
            {group.label !== null && (
              <h2 className="life-group-title">
                {group.label} <span className="life-group-count">{group.entities.length}</span>
              </h2>
            )}
            <ul className={kind === "periods" ? "life-grid rows" : "life-grid"}>
              {group.entities.map((entity) => (
                <li key={entity.id}>
                  <LifeCardButton kind={kind} card={lifeCardOf(entity, now)} entityId={entity.id} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** Cards in the grid of the list, with a title, a line and a block, so the page does not jump when the list comes. */
function LifeListSkeleton({ kind }: { readonly kind: LifeKind }): ReactElement {
  const widths = ["62%", "48%", "70%", "54%"];
  return (
    <div className="skeleton life-skeleton" aria-busy="true">
      <span className="visually-hidden" role="status">
        Loading the {lifePages[kind].title.toLowerCase()}…
      </span>
      <ul
        className={kind === "periods" ? "life-grid rows skeleton-shapes" : "life-grid skeleton-shapes"}
        aria-hidden="true"
        inert
      >
        {widths.map((width, index) => (
          <li key={index}>
            <span className="card life-card">
              <span className="life-card-head">
                {(kind === "people" || kind === "pets") && <span className="project-mark skeleton-block" />}
                <span className="skeleton-text life-card-title">
                  <span className="skeleton-line title" style={{ width }} />
                </span>
              </span>
              <span className="skeleton-text">
                <span className="skeleton-line" style={{ width: widths[(index + 2) % widths.length] }} />
              </span>
              <span className="skeleton-text">
                <span className="skeleton-line" style={{ width: "36%" }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatePill({
  pill,
  tooltip,
  icon,
}: {
  readonly pill: LifePill;
  readonly tooltip?: string;
  readonly icon?: IconName;
}): ReactElement {
  return (
    <span className={`pill ${icon === undefined ? "dot " : ""}${pill.tone} life-pill`} data-tooltip={tooltip}>
      {icon !== undefined && <Icon name={icon} />}
      {pill.text}
    </span>
  );
}

/** A day with its state in words. A missed day also gets the alert icon, so the state has a shape. */
function DayPill({ day }: { readonly day: DayState }): ReactElement {
  return (
    <StatePill
      pill={{ text: day.words, tone: day.tone }}
      tooltip={day.text}
      {...(day.overdue ? { icon: "alert" as const } : {})}
    />
  );
}

function markStyle(color: string): CSSProperties {
  return { "--project-color": color } as CSSProperties;
}

function LifeCardButton({
  kind,
  card,
  entityId,
}: {
  readonly kind: LifeKind;
  readonly card: LifeCard;
  readonly entityId: string;
}): ReactElement {
  const { body } = card;
  const pill = lifeCardPill(body);
  const mark = body.kind === "people" || body.kind === "pets" ? body : null;
  const eyebrow = body.kind === "objects" ? body.type : body.kind === "periods" ? body.span : null;
  const title = body.kind === "objects" ? (body.model ?? card.title) : card.title;
  return (
    <button className={`card life-card ${kind}`} onClick={() => goTo(lifeAddressOf(kind, entityId))}>
      <span className="life-card-head">
        {mark !== null && (
          <span className="project-mark life-mark" style={markStyle(mark.color)} aria-hidden="true">
            {mark.initials}
          </span>
        )}
        <span className="life-card-name">
          {eyebrow !== null && <span className="life-eyebrow">{eyebrow}</span>}
          <b className="life-card-title">{title}</b>
        </span>
        {pill !== null && <StatePill pill={pill} />}
      </span>
      <CardBody body={body} />
      {card.summary !== null && <span className="life-summary">{card.summary}</span>}
      {card.warnings > 0 && (
        <span className="pill warn life-pill">
          <Icon name="alert" /> {countOf(card.warnings, "warning")}
        </span>
      )}
    </button>
  );
}

function Line({ icon, children }: { readonly icon: IconName; readonly children: ReactNode }): ReactElement {
  return (
    <span className="life-line">
      <Icon name={icon} />
      <span>{children}</span>
    </span>
  );
}

/** What a card shows for its kind. The entity page shows it too, above the facts. */
function CardBody({ body }: { readonly body: LifeCardBody }): ReactElement | null {
  switch (body.kind) {
    case "cases": {
      const due = body.current?.due ?? null;
      const deadline = body.deadline?.due ?? null;
      const cost = body.deadline?.cost ?? null;
      return (
        <>
          {body.progress !== null && <StepsProgress progress={body.progress} />}
          {body.current !== null && (
            <span className="life-current">
              <Line icon="forward">{body.current.text}</Line>
              {body.current.waitingFor !== null && <Line icon="user">Waits for {body.current.waitingFor}</Line>}
            </span>
          )}
          {(due !== null || deadline !== null || cost !== null) && (
            <span className="life-pills">
              {due !== null && <DayPill day={due} />}
              {deadline !== null && <DayPill day={deadline} />}
              {cost !== null && <span className="life-small">{cost}</span>}
            </span>
          )}
          {body.closed !== null && <Line icon="check">Closed on {body.closed}</Line>}
        </>
      );
    }
    case "people":
      return body.relation === null ? null : <span className="life-relation">{body.relation}</span>;
    case "objects":
      return body.ids.length === 0 && body.owner === null ? null : (
        <>
          {body.ids.length > 0 && (
            <span className="tags">
              {body.ids.map((id) => (
                <span key={id} className="tag mono">
                  {id}
                </span>
              ))}
            </span>
          )}
          {body.owner !== null && <Line icon="user">Owner: {body.owner}</Line>}
        </>
      );
    case "pets": {
      const kindWords = [body.species, body.breed].filter((part) => part !== null).join(" · ");
      return kindWords === "" && body.life === null ? null : (
        <span className="life-facts-line">
          {kindWords !== "" && <span>{kindWords}</span>}
          {body.life !== null && <span className="muted">{body.life}</span>}
        </span>
      );
    }
    case "periods": {
      const work = [body.role, body.org].filter((part) => part !== null).join(" at ");
      return (
        <span className="life-facts-line">
          {body.type !== null && <span className="tag">{body.type}</span>}
          {work !== "" && <span>{work}</span>}
          {body.length !== null && <span className="muted">{body.length}</span>}
        </span>
      );
    }
  }
}

function StepsProgress({
  progress,
}: {
  readonly progress: { done: number; total: number; words: string };
}): ReactElement {
  const share = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
  return (
    <span className="life-progress">
      <span className="life-progress-track" role="img" aria-label={progress.words}>
        <span className="life-progress-fill" style={{ width: `${String(share)}%` }} />
      </span>
      <span className="life-small">{progress.words}</span>
    </span>
  );
}

// The entity page

type EntityState = LifeEntityDetail | "missing" | "failed" | null;

function LifeEntityPage({ kind, entityId }: { readonly kind: LifeKind; readonly entityId: string }): ReactElement {
  const page = lifePages[kind];
  const [entity, setEntity] = useState<EntityState>(null);
  const [version, setVersion] = useState(0);
  const showError = useShowError();
  useEffect(() => {
    let isCurrent = true;
    api.lifeEntity(kind, entityId).then(
      (found) => {
        if (isCurrent) setEntity(found);
      },
      (caught: unknown) => {
        if (!isCurrent) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setEntity("missing");
          return;
        }
        setEntity("failed");
        showError(caught);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [kind, entityId, version, showError]);

  const back = (): void => goUp(lifeAddressOf(kind));
  const now = new Date();
  const card = entity !== null && typeof entity === "object" ? lifeCardOf(entity, now) : null;
  const pill = card === null ? null : lifeCardPill(card.body);
  return (
    <>
      <div className="main-header">
        <BackButton label={`Back to ${page.title.toLowerCase()}`} text={page.title} onClick={back} />
        <div className="header-text">
          <div className="header-title">
            <h1>{card?.title ?? (entity === "missing" ? "Not found" : entityId)}</h1>
            {pill !== null && <StatePill pill={pill} />}
          </div>
          {typeof entity === "object" && entity !== null && <div className="sub mono">{entity.folder}</div>}
        </div>
      </div>
      <div className="life-page life-entity">
        {entity === null && (
          <section className="card project-facts life-facts">
            <FactsSkeleton label={`Loading ${entityId}…`} rows={4} />
          </section>
        )}
        {entity === "failed" && (
          <div className="callout danger life-failed" role="alert">
            Eva could not read this page. <button onClick={() => setVersion((value) => value + 1)}>Try again</button>
          </div>
        )}
        {entity === "missing" && (
          <div className="life-empty life-missing" role="status">
            <Visor size={76} face={stateFaces.resting} />
            <strong>Eva cannot find “{entityId}”.</strong>
            <p>Its folder may have a new name, or it is gone.</p>
            <button onClick={back}>Back to {page.title}</button>
          </div>
        )}
        {card !== null && typeof entity === "object" && entity !== null && (
          <EntityDetails entity={entity} card={card} />
        )}
      </div>
    </>
  );
}

function EntityDetails({ entity, card }: { readonly entity: LifeEntityDetail; readonly card: LifeCard }): ReactElement {
  const facts = lifeFacts(entity, { clock: displayFormat().clock });
  const body = bodyWithoutTitle(entity.body, entity.title).trim();
  const steps = entity.kind === "cases" ? caseSteps(entity.fields, new Date()) : [];
  return (
    <>
      {entity.warnings.length > 0 && (
        <div className="warning-banner" role="note">
          <Icon name="alert" />
          <ul>
            {entity.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <section className={`card project-facts life-facts ${entity.kind}`} aria-label="Facts">
        {card.summary !== null && <p className="life-lead">{card.summary}</p>}
        {card.body.kind !== "cases" && <CardBody body={card.body} />}
        {facts.length > 0 && <FactList facts={facts} />}
        <div className="tags">
          <a className="mode-chip link-chip" href={fileAddressOf(entity.folder)}>
            <Icon name="folder" /> Open in Files
          </a>
        </div>
      </section>
      {card.body.kind === "cases" && (steps.length > 0 || card.body.current !== null) && (
        <section className="card life-steps" aria-label="Steps">
          <div className="life-section-head">
            <h2>Steps</h2>
            {card.body.progress !== null && <StepsProgress progress={card.body.progress} />}
          </div>
          {steps.length > 0 ? (
            <ol className="life-step-list">
              {steps.map((step, index) => (
                <StepRow key={index} step={step} />
              ))}
            </ol>
          ) : (
            <CardBody body={card.body} />
          )}
        </section>
      )}
      {body !== "" && (
        <section className="card life-text" aria-label="Notes">
          <MarkdownBody html={toWebHtml(body, { vaultLinks: true })} className="answer-body life-markdown" />
        </section>
      )}
      {entity.files.length > 0 && (
        <section className="card life-files" aria-label="Files">
          <h2>Files</h2>
          <ul className="life-file-list">
            {entity.files.map((file) => (
              <li key={file.path}>
                <a className="life-file" href={fileAddressOf(file.path)}>
                  <Icon name={file.kind === "folder" ? "folder" : "file"} />
                  <span>{file.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const stepStateWords: Readonly<Record<CaseStep["state"], string>> = {
  done: "Done",
  current: "Now",
  todo: "To do",
};

/** A step with a mark of its state: a check when done, a filled dot now, an empty ring to do. */
function StepRow({ step }: { readonly step: CaseStep }): ReactElement {
  return (
    <li className={`life-step ${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
      <span className="life-step-mark" aria-hidden="true">
        {step.state === "done" && <Icon name="check" />}
      </span>
      <span className="life-step-text">
        <span className="visually-hidden">{stepStateWords[step.state]}: </span>
        <span>{step.text}</span>
        <span className="life-step-meta">
          {step.doneOn !== null && <span className="muted">Done on {step.doneOn}</span>}
          {step.waitingFor !== null && <Line icon="user">Waits for {step.waitingFor}</Line>}
          {step.due !== null && step.state !== "done" && <DayPill day={step.due} />}
        </span>
      </span>
    </li>
  );
}
