/**
 * The facts of a front matter as a list of names and values: dates, links, lists and nested maps.
 * A project page and a Life page show them the same way.
 */
import { Fragment, type ReactElement } from "react";
import { Icon } from "./icons.tsx";
import type { Fact, FactLink, FactValue } from "./front-matter-facts.ts";

export function FactList({ facts }: { readonly facts: readonly Fact[] }): ReactElement {
  return (
    <dl className="chat-facts">
      {facts.map((fact) => (
        <Fragment key={fact.key}>
          <dt>{fact.label}</dt>
          <dd>
            <FactValueView value={fact.value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * A link chip names its site first, so the person sees at once where it goes. With a name, such as
 * "Result", the chip says what the link is, and the site follows.
 */
export function FactLinkChip({ link, name }: { readonly link: FactLink; readonly name?: string }): ReactElement {
  const web = !link.href.startsWith("mailto:");
  const detail = name === undefined ? link.label : [link.site, link.label].filter((part) => part !== "").join(" ");
  return (
    <a
      className="mode-chip link-chip"
      href={link.href}
      data-tooltip={link.href}
      {...(web ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      <Icon name={web ? "external" : "send"} /> {name ?? link.site}
      {detail !== "" && <span className="link-chip-site">{detail}</span>}
    </a>
  );
}

function FactValueView({ value }: { readonly value: FactValue }): ReactElement {
  switch (value.kind) {
    case "date":
      return (
        <time dateTime={value.raw} data-tooltip={value.raw}>
          {value.text}
        </time>
      );
    case "link":
      return <FactLinkChip link={value.link} />;
    case "list":
      return (
        <div className="tags">
          {value.items.map((item, index) =>
            item.kind === "text" || item.kind === "date" ? (
              <span key={index} className="tag">
                <FactValueView value={item} />
              </span>
            ) : (
              <FactValueView key={index} value={item} />
            ),
          )}
        </div>
      );
    case "map":
      return <FactList facts={value.facts} />;
    case "text":
      return (
        <span className="fact-text">
          {value.parts.map((part, index) =>
            part.href === undefined ? (
              part.text
            ) : (
              <a
                key={index}
                href={part.href}
                // A page of the app, such as a person, stays in the tab, so Back returns here.
                {...(part.href.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}
              >
                {part.text}
              </a>
            ),
          )}
        </span>
      );
  }
}
