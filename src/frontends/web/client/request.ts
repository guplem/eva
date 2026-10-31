/** One request of the page to the local API, and its failure. The login cookie carries the token. */
import type { EvaErrorCode } from "../../../shared/errors.ts";
import { withinTime } from "./time-limit.ts";

export class ApiError extends Error {
  readonly status: number;
  /** The `EvaErrorCode` of the failure, or null when the answer has none. */
  readonly code: EvaErrorCode | null;

  constructor(status: number, message: string, code: EvaErrorCode | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Eva answers a quick request at once. Only a hung network takes longer. */
const quickLimitMs = 20_000;

/** The limit of a quick read: it changes nothing, so a try again is safe. */
export const quickRead = {
  ms: quickLimitMs,
  message: "Eva did not answer in 20 seconds. Check the connection and try again.",
} as const;

/** A send can reach Eva and only lose the answer, so the person checks the chat before a second send. */
export const quickSend = {
  ms: quickLimitMs,
  message: "Eva did not answer in 20 seconds. The message may have been sent: check the chat before you send it again.",
} as const;

/**
 * `keepalive`: the request still goes out while the browser hides or closes the page.
 * `limit`: the request fails with this message after this time. Give it only to quick requests,
 * never to a login, an upload or a transcription.
 */
export async function request<Body>(
  method: string,
  path: string,
  body?: unknown,
  options: {
    readonly keepalive?: boolean;
    readonly limit?: { readonly ms: number; readonly message: string };
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<Body> {
  // A Blob, such as a voice note, goes as it is.
  const sent =
    body === undefined
      ? {}
      : body instanceof Blob
        ? { contentType: body.type, body }
        : { contentType: "application/json", body: JSON.stringify(body) };
  const { limit, headers, ...fetchOptions } = options;
  const run = async (signal?: AbortSignal): Promise<Body> => {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { ...headers, ...(sent.contentType === undefined ? {} : { "content-type": sent.contentType }) },
      ...(sent.body === undefined ? {} : { body: sent.body }),
      ...fetchOptions,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw await failureOf(response);
    return response.status === 204 ? (undefined as Body) : ((await response.json()) as Body);
  };
  return limit === undefined ? run() : withinTime(limit.ms, limit.message, run);
}

export async function failureOf(response: Response): Promise<ApiError> {
  const text = await response.text();
  let message = text;
  let code: EvaErrorCode | null = null;
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: EvaErrorCode };
    message = parsed.error ?? text;
    code = parsed.code ?? null;
  } catch {
    // Not JSON: keep the text.
  }
  return new ApiError(response.status, message, code);
}
