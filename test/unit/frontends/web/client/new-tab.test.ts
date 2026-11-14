import { describe, expect, test } from "bun:test";
import { opensNewTab, tabLinkProps } from "../../../../../src/frontends/web/client/new-tab.ts";

interface FakeClick {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  prevented: boolean;
  preventDefault(): void;
}

function click(button: number, keys: { ctrlKey?: boolean; metaKey?: boolean } = {}): FakeClick {
  return {
    button,
    ctrlKey: keys.ctrlKey ?? false,
    metaKey: keys.metaKey ?? false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function setup(): { opened: string[]; tabs: string[]; props: ReturnType<typeof tabLinkProps> } {
  const opened: string[] = [];
  const tabs: string[] = [];
  const props = tabLinkProps(
    "#/files",
    () => opened.push("here"),
    (address) => tabs.push(address),
  );
  return { opened, tabs, props };
}

describe("opensNewTab", () => {
  test("a middle click, a Ctrl click and a Cmd click open a new tab", () => {
    expect(opensNewTab(click(1))).toBe(true);
    expect(opensNewTab(click(0, { ctrlKey: true }))).toBe(true);
    expect(opensNewTab(click(0, { metaKey: true }))).toBe(true);
  });

  test("a plain click and a right click do not", () => {
    expect(opensNewTab(click(0))).toBe(false);
    expect(opensNewTab(click(2))).toBe(false);
  });
});

describe("tabLinkProps", () => {
  test("a plain click opens the page in this tab", () => {
    const { opened, tabs, props } = setup();
    const event = click(0);
    props.onClick(event);
    expect(opened).toEqual(["here"]);
    expect(tabs).toEqual([]);
    expect(event.prevented).toBe(false);
  });

  test("a Ctrl click opens the address in a new tab and leaves this tab", () => {
    const { opened, tabs, props } = setup();
    const event = click(0, { ctrlKey: true });
    props.onClick(event);
    expect(tabs).toEqual(["#/files"]);
    expect(opened).toEqual([]);
    expect(event.prevented).toBe(true);
  });

  test("a middle click opens the address in a new tab", () => {
    const { opened, tabs, props } = setup();
    const event = click(1);
    props.onAuxClick(event);
    expect(tabs).toEqual(["#/files"]);
    expect(opened).toEqual([]);
    expect(event.prevented).toBe(true);
  });

  test("a right click does nothing of its own", () => {
    const { opened, tabs, props } = setup();
    props.onAuxClick(click(2));
    expect(tabs).toEqual([]);
    expect(opened).toEqual([]);
  });

  test("a middle press does not start the scroll of the browser", () => {
    const { props } = setup();
    const middle = click(1);
    props.onMouseDown(middle);
    expect(middle.prevented).toBe(true);
    const left = click(0);
    props.onMouseDown(left);
    expect(left.prevented).toBe(false);
  });
});
