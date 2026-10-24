/**
 * The ports of the demo server of the browser tests. Two checkouts on one computer can test at
 * the same time when each sets other ports, or `auto`, in EVA_E2E_PORT and EVA_E2E_GALLERY_PORT.
 */
import { createServer } from "node:net";

type Environment = Record<string, string | undefined>;

const variables = { demo: "EVA_E2E_PORT", gallery: "EVA_E2E_GALLERY_PORT" } as const;
const defaults = { demo: 7499, gallery: 7498 } as const;

export interface E2ePorts {
  /** The local API of the demo vault. */
  demo: number;
  /** The test page of EVE's faces (`visor-gallery.html`). */
  gallery: number;
}

/** Reads the ports. Call `resolveAutoPorts` first when a variable can be `auto`. */
export function e2ePorts(environment: Environment = process.env): E2ePorts {
  return { demo: readPort(environment, "demo"), gallery: readPort(environment, "gallery") };
}

/**
 * Writes a free port in place of each `auto`. Playwright's config runs it once: the demo server
 * and the test workers inherit the environment, so they all read the same numbers.
 */
export async function resolveAutoPorts(environment: Environment, freePort = findFreePort): Promise<void> {
  for (const variable of Object.values(variables)) {
    if (environment[variable] === "auto") environment[variable] = String(await freePort());
  }
}

function readPort(environment: Environment, name: keyof E2ePorts): number {
  const value = environment[variables[name]];
  if (value === undefined || value === "") return defaults[name];
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variables[name]} must be a port from 1 to 65535, or auto: ${value}`);
  }
  return port;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}
