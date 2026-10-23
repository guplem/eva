import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppSkeleton,
  ButtonSpinner,
  CardsSkeleton,
  ConversationSkeleton,
  FactsSkeleton,
  ListSkeleton,
  ProgressBar,
} from "../../../../../src/frontends/web/client/Loading.tsx";

function spinner(share?: number | null): string {
  return renderToStaticMarkup(createElement(ButtonSpinner, share === undefined ? {} : { share }));
}

describe("ButtonSpinner", () => {
  test("with no share, its arc turns, hidden from a screen reader", () => {
    const markup = spinner();
    expect(markup).toContain('class="button-spinner running"');
    expect(markup).toContain('aria-hidden="true"');
  });

  test("a known share fills that part of the ring", () => {
    const markup = spinner(0.42);
    expect(markup).toContain('class="button-spinner"');
    expect(markup).toContain('stroke-dasharray="42 100"');
  });

  test("a share outside 0 to 1 stays on the ring", () => {
    expect(spinner(1.7)).toContain('stroke-dasharray="100 100"');
    expect(spinner(-0.2)).toContain('stroke-dasharray="0 100"');
  });
});

describe("ProgressBar", () => {
  test("a known share fills the bar and shows the percentage", () => {
    const markup = renderToStaticMarkup(createElement(ProgressBar, { label: "Installing", share: 0.42 }));
    expect(markup).toContain('aria-valuenow="42"');
    expect(markup).toContain("42%");
    expect(markup).not.toContain("running");
  });

  test("with no share, its lines run", () => {
    const markup = renderToStaticMarkup(createElement(ProgressBar, { label: "Looking" }));
    expect(markup).toContain("progress-track running");
    expect(markup).not.toContain("aria-valuenow");
  });
});

describe("skeletons", () => {
  test("each one is busy, and only a labelled one has a status", () => {
    const samples = [
      createElement(FactsSkeleton, { label: "Reading", rows: 3 }),
      createElement(ListSkeleton, {}),
      createElement(ConversationSkeleton, {}),
      createElement(CardsSkeleton, {}),
    ];
    const markups = samples.map((sample) => renderToStaticMarkup(sample));
    for (const markup of markups) expect(markup).toContain('aria-busy="true"');
    expect(markups.map((markup) => markup.includes('role="status"'))).toEqual([true, false, false, false]);
  });

  test("the first load copies the page that opens", () => {
    for (const page of ["chat", "list", "files", "cards"] as const) {
      const markup = renderToStaticMarkup(createElement(AppSkeleton, { page }));
      expect(markup).toContain("Loading Eva…");
    }
    expect(renderToStaticMarkup(createElement(AppSkeleton, { page: "chat" }))).toContain("conversation-skeleton");
    expect(renderToStaticMarkup(createElement(AppSkeleton, { page: "files" }))).toContain("list-skeleton");
  });
});
