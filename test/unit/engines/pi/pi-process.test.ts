import { describe, expect, test } from "bun:test";
import { readJsonLines, systemPiProcessStarter } from "../../../../src/engines/pi/pi-process.ts";

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(records: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for await (const record of records) all.push(record);
  return all;
}

describe("readJsonLines (lesson 52)", () => {
  test("splits on LF only, keeps U+2028 inside a string, and joins a character that a chunk cut", async () => {
    const bytes = new TextEncoder().encode('{"a":"café"}\r\n{"b":"x y"}\nnot json\n[1]\n\n{"c":1}');
    const cut = bytes.indexOf(0xa9); // the second byte of "é"
    const records = await collect(readJsonLines(streamOf([bytes.slice(0, cut), bytes.slice(cut)])));
    expect(records).toEqual([{ a: "café" }, { b: "x y" }, { c: 1 }]);
  });

  test("a record of hundreds of kilobytes arrives whole", async () => {
    const text = "x".repeat(600_000);
    const records = await collect(readJsonLines(streamOf([new TextEncoder().encode(`{"text":"${text}"}\n`)])));
    expect((records[0]?.["text"] as string).length).toBe(600_000);
  });
});

describe("systemPiProcessStarter", () => {
  const echo = [
    'process.stderr.write("starting up\\n");',
    "for await (const line of console) process.stdout.write(JSON.stringify({ echo: JSON.parse(line) }) + '\\n');",
  ].join("\n");

  test("sends records on stdin, reads them on stdout, and keeps the end of stderr", async () => {
    const pi = systemPiProcessStarter([process.execPath, "-e", echo], {
      cwd: process.cwd(),
      environment: { ...process.env } as Record<string, string>,
    });
    pi.send({ type: "prompt", message: "hi" });
    const iterator = pi.records[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ echo: { type: "prompt", message: "hi" } });
    await pi.close(5_000);
    expect((await iterator.next()).done).toBe(true);
    expect(pi.stderrTail()).toContain("starting up");
  });

  test("a process that ignores the end of stdin is stopped after the timeout", async () => {
    const stubborn = "setInterval(() => undefined, 1000);";
    const pi = systemPiProcessStarter([process.execPath, "-e", stubborn], {
      cwd: process.cwd(),
      environment: { ...process.env } as Record<string, string>,
    });
    const started = Date.now();
    await pi.close(200);
    expect(await collect(pi.records)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
