import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Rules for every style sheet of the web app (issue 675). A rule that breaks one of them needs a
 * comment just before it that starts with "Motion exception:" and gives the reason.
 */

const webFolder = join(import.meta.dir, "../../../../src/frontends/web");
const exceptionMark = "Motion exception:";

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly comment: string;
}

interface Block {
  readonly prelude: string;
  readonly comment: string;
  readonly declarations: Declaration[];
  readonly children: Block[];
  readonly parent: Block | null;
}

/** A small CSS reader: blocks with their prelude, their declarations and the comment just before each. */
function parse(css: string): Block {
  const root: Block = { prelude: "", comment: "", declarations: [], children: [], parent: null };
  let current = root;
  let text = "";
  let comment = "";
  let index = 0;
  while (index < css.length) {
    const char = css.charAt(index);
    if (css.startsWith("/*", index)) {
      const end = css.indexOf("*/", index + 2);
      const body = css.slice(index + 2, end === -1 ? css.length : end);
      // Only a comment with nothing but space between it and the code describes that code.
      comment = text.trim() === "" ? `${comment} ${body}` : comment;
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = css.indexOf(char, index + 1);
      text += css.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "{") {
      const block: Block = { prelude: text.trim(), comment, declarations: [], children: [], parent: current };
      current.children.push(block);
      current = block;
      text = "";
      comment = "";
    } else if (char === ";" || char === "}") {
      const colon = text.indexOf(":");
      if (text.trim() !== "" && colon !== -1) {
        current.declarations.push({
          property: text.slice(0, colon).trim(),
          value: text.slice(colon + 1).trim(),
          comment,
        });
      }
      text = "";
      comment = "";
      if (char === "}") current = current.parent ?? root;
    } else {
      text += char;
    }
    index += 1;
  }
  return root;
}

function* blocksOf(block: Block): Generator<Block> {
  for (const child of block.children) {
    yield child;
    yield* blocksOf(child);
  }
}

function ancestors(block: Block): Block[] {
  const list: Block[] = [];
  for (let parent = block.parent; parent !== null; parent = parent.parent) list.push(parent);
  return list;
}

/** Splits a list at its top-level commas, so `a, b:is(c, d)` gives two parts. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(part.trim());
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part.trim());
  return parts.filter((entry) => entry !== "");
}

function excepted(block: Block, declaration?: Declaration): boolean {
  const comments = [declaration?.comment ?? "", block.comment, ...ancestors(block).map((parent) => parent.comment)];
  return comments.some((comment) => comment.includes(exceptionMark));
}

const sheets = readdirSync(webFolder)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, root: parse(readFileSync(join(webFolder, name), "utf8")) }));

function* rules(): Generator<{ readonly sheet: string; readonly block: Block }> {
  for (const { name, root } of sheets) {
    for (const block of blocksOf(root)) {
      if (!block.prelude.startsWith("@")) yield { sheet: name, block };
    }
  }
}

const hoverGate = /@media[^{]*\(hover:\s*hover\)/;

function hoverGated(block: Block): boolean {
  return ancestors(block).some((parent) => hoverGate.test(parent.prelude));
}

// A forced-colors rule draws the system colours for every state at once, also on a touch screen.
function forcedColors(block: Block): boolean {
  return ancestors(block).some((parent) => parent.prelude.includes("forced-colors"));
}

// These make the browser lay out or paint again on each frame. `transform` and `opacity` do not.
const costlyProperty =
  /^(width|height|min-height|max-height|top|left|right|bottom|inset|margin.*|padding.*|flex-basis|grid-template-.*|background-position|box-shadow|all)$/;

function transitionedProperties(value: string): string[] {
  return splitList(value).map((item) => item.split(/\s+/)[0] ?? "");
}

const timingProperty = /^(transition|animation)(-duration|-delay|-timing-function)?$/;
const rawDuration = /(^|[\s,(])(?!0m?s\b)\d*\.?\d+m?s\b/;
const rawCurve = /(^|[\s,])(ease|ease-in|ease-out|ease-in-out)(?=$|[\s,])|cubic-bezier\(/;

describe("the style sheets of the web app", () => {
  test("found the style sheets", () => {
    expect(sheets.map((sheet) => sheet.name)).toContain("styles.css");
  });

  test("a hover style needs a pointer that can hover, so a tap on a phone never leaves it on", () => {
    const ungated: string[] = [];
    for (const { sheet, block } of rules()) {
      if (!block.prelude.includes(":hover") || hoverGated(block) || forcedColors(block)) continue;
      ungated.push(`${sheet}: ${block.prelude}`);
    }
    expect(ungated).toEqual([]);
  });

  test("a gated hover rule holds only hover selectors, so a press or a focus style still shows on a phone", () => {
    const mixed: string[] = [];
    for (const { sheet, block } of rules()) {
      if (!hoverGated(block) || ancestors(block).some((parent) => !parent.prelude.startsWith("@"))) continue;
      const others = splitList(block.prelude).filter((selector) => !selector.includes(":hover"));
      if (block.prelude.includes(":hover") && others.length > 0) mixed.push(`${sheet}: ${others.join(", ")}`);
    }
    expect(mixed).toEqual([]);
  });

  test("motion animates no property that makes the browser lay out or paint again on each frame", () => {
    const costly: string[] = [];
    for (const { name, root } of sheets) {
      for (const block of blocksOf(root)) {
        const inKeyframes = ancestors(block).some((parent) => parent.prelude.startsWith("@keyframes"));
        for (const declaration of block.declarations) {
          if (excepted(block, declaration)) continue;
          const animated = inKeyframes
            ? [declaration.property]
            : declaration.property === "transition" || declaration.property === "transition-property"
              ? transitionedProperties(declaration.value)
              : [];
          for (const property of animated.filter((entry) => costlyProperty.test(entry))) {
            costly.push(`${name}: ${block.prelude} animates ${property}`);
          }
        }
      }
    }
    expect(costly).toEqual([]);
  });

  test("each motion token in use is defined", () => {
    const text = sheets.map(({ name }) => readFileSync(join(webFolder, name), "utf8")).join("\n");
    const used = new Set([...text.matchAll(/var\((--(?:dur|ease)-[\w-]+)\)/g)].map((match) => match[1] ?? ""));
    expect(used.size).toBeGreaterThan(3);
    for (const token of used) expect(text, token).toContain(`${token}:`);
  });

  test("motion that plays once takes its duration and curve from the motion tokens", () => {
    const raw: string[] = [];
    for (const { sheet, block } of rules()) {
      // The visor and the looping waits keep the timing that the EVE guide gives them.
      if (sheet === "visor.css") continue;
      for (const declaration of block.declarations) {
        if (!timingProperty.test(declaration.property) || declaration.value.includes("infinite")) continue;
        if (excepted(block, declaration)) continue;
        if (rawDuration.test(declaration.value) || rawCurve.test(declaration.value)) {
          raw.push(`${sheet}: ${block.prelude} { ${declaration.property}: ${declaration.value} }`);
        }
      }
    }
    expect(raw).toEqual([]);
  });

  test("a box that scrolls keeps its scroll, so the page behind it does not move", () => {
    const chaining: string[] = [];
    for (const { sheet, block } of rules()) {
      const scrolls = block.declarations.some(
        (declaration) => /^overflow(-y)?$/.test(declaration.property) && /\b(auto|scroll)\b/.test(declaration.value),
      );
      const contained = block.declarations.some((declaration) =>
        declaration.property.startsWith("overscroll-behavior"),
      );
      if (scrolls && !contained && !excepted(block)) chaining.push(`${sheet}: ${block.prelude}`);
    }
    expect(chaining).toEqual([]);
  });

  test("the page itself does not bounce or chain its scroll up or down", () => {
    for (const root of ["html", "body"]) {
      const page = [...rules()].filter(
        ({ sheet, block }) => sheet === "styles.css" && splitList(block.prelude).includes(root),
      );
      const values = page
        .flatMap(({ block }) => block.declarations)
        .filter((d) => d.property === "overscroll-behavior-y" || d.property === "overscroll-behavior");
      expect(
        values.map((declaration) => declaration.value),
        root,
      ).toContain("none");
    }
  });

  test("a tap on a control fires at once, with no wait for a double tap", () => {
    const controls = [...rules()].filter(({ sheet, block }) => {
      const selectors = splitList(block.prelude);
      return sheet === "styles.css" && ["button", "a", '[role="button"]'].every((s) => selectors.includes(s));
    });
    const values = controls.flatMap(({ block }) => block.declarations).filter((d) => d.property === "touch-action");
    expect(values.map((declaration) => declaration.value)).toContain("manipulation");
  });
});
