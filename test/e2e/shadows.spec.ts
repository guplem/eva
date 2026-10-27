import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * A box that scrolls cuts everything outside its padding, also the shadow of a card in it.
 * The cut shows as a hard line in the soft shadow (issue 625).
 */

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Each card whose shadow a scrolling parent cuts, with the cut sides, such as `ul.files-list: top`. */
function cutShadows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Past seven tenths of its blur, a shadow is too faint to see, so a cut there does not show.
    const visibleShare = 0.7;
    const sides = ["top", "right", "bottom", "left"] as const;
    type Sides = Record<(typeof sides)[number], number>;

    function reach(boxShadow: string): Sides {
      const most: Sides = { top: 0, right: 0, bottom: 0, left: 0 };
      for (const layer of boxShadow.split(/,(?![^(]*\))/)) {
        if (layer.includes("inset")) continue;
        const lengths = (layer.replace(/[a-z]+\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
        const size = blur * visibleShare + spread;
        most.top = Math.max(most.top, size - y);
        most.bottom = Math.max(most.bottom, size + y);
        most.left = Math.max(most.left, size - x);
        most.right = Math.max(most.right, size + x);
      }
      return most;
    }

    function label(element: Element): string {
      const classes = [...element.classList].join(".");
      return element.tagName.toLowerCase() + (classes === "" ? "" : `.${classes}`);
    }

    const found = new Set<string>();
    for (const card of document.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(card);
      if (style.boxShadow === "none") continue;
      const box = card.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const needs = reach(style.boxShadow);
      for (let parent = card.parentElement; parent !== null; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        // A sticky bar, such as the message box, rests on the edge of its box on purpose.
        if (parentStyle.position === "sticky") break;
        if (parentStyle.overflowX === "visible" && parentStyle.overflowY === "visible") continue;
        const outer = parent.getBoundingClientRect();
        const left = outer.left + parseFloat(parentStyle.borderLeftWidth);
        const top = outer.top + parseFloat(parentStyle.borderTopWidth);
        const clip = { top, left, right: left + parent.clientWidth, bottom: top + parent.clientHeight };
        // A card that is partly scrolled away shows a cut on purpose.
        const inside =
          box.top >= clip.top - 1 &&
          box.left >= clip.left - 1 &&
          box.right <= clip.right + 1 &&
          box.bottom <= clip.bottom + 1;
        if (!inside) break;
        const room: Sides = {
          top: box.top - clip.top,
          right: clip.right - box.right,
          bottom: clip.bottom - box.bottom,
          left: box.left - clip.left,
        };
        // The edge of the screen hides a cut. Mid-scroll, more cards wait past the edge, so a cut there is a scroll.
        const hidden: Sides = {
          top: clip.top <= 1 || parent.scrollTop > 1 ? 1 : 0,
          right:
            clip.right >= innerWidth - 1 || parent.scrollLeft + parent.clientWidth < parent.scrollWidth - 1 ? 1 : 0,
          bottom:
            clip.bottom >= innerHeight - 1 || parent.scrollTop + parent.clientHeight < parent.scrollHeight - 1 ? 1 : 0,
          left: clip.left <= 1 || parent.scrollLeft > 1 ? 1 : 0,
        };
        const cut = sides.filter((side) => hidden[side] === 0 && needs[side] > room[side] + 1);
        if (cut.length > 0) found.add(`${label(card)}: ${cut.join(" ")}`);
        break;
      }
    }
    return [...found];
  });
}

test("No box that scrolls cuts the shadow of a card in it (issue 625)", async ({ page }, testInfo) => {
  await page.route("**/api/files/favorites", (route) =>
    route.fulfill({
      json: [
        { path: "Notes", name: "Notes", kind: "folder" },
        { path: "AGENTS.md", name: "AGENTS.md", kind: "file" },
      ],
    }),
  );
  await logIn(page);
  const file = `Notes/${testInfo.project.name}-list.md`;
  // Only the hash changes, so the page does not load again: wait for the cards of each page.
  const pages: [string, Locator[]][] = [
    ["#/chats", [page.locator(".composer-box")]],
    ["#/files/Notes", [page.getByRole("list", { name: "Contents of Notes" })]],
    [`#/files/${file}`, [page.getByRole("region", { name: "File text" })]],
    ["#/projects", [page.locator(".project-card").first()]],
    ["#/schedules", [page.locator(".schedule-panel").first()]],
    ["#/settings", [page.locator(".section-card").first()]],
  ];
  for (const [address, cards] of pages) {
    await page.goto(`/${address}`);
    if (address.startsWith("#/files")) {
      cards.push(page.getByRole("navigation", { name: "Favorites" }).getByRole("link", { name: "Notes" }));
    }
    for (const card of cards) await expect(card).toBeVisible();
    expect(await cutShadows(page), address).toEqual([]);
  }

  await page.goto("/#/files");
  await page.getByRole("searchbox", { name: "Search the vault" }).fill("list");
  await expect(page.getByRole("list", { name: "Search results" })).toBeVisible();
  expect(await cutShadows(page), "search").toEqual([]);
});
