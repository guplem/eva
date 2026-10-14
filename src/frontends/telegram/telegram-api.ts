/**
 * The Telegram Bot API seam. The token sits in every Telegram URL, so an error never
 * carries the URL: only the method name, the code and Telegram's description (lesson 95).
 */

export class TelegramError extends Error {
  readonly method: string;
  readonly code: number;

  constructor(method: string, code: number, description: string) {
    super(`Telegram ${method} failed (${String(code)}): ${description}`);
    this.name = "TelegramError";
    this.method = method;
    this.code = code;
  }
}

export interface TelegramApi {
  call<Result>(method: string, params?: Readonly<Record<string, unknown>>): Promise<Result>;
}

export interface HttpTelegramApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
  /** A long poll waits up to its own timeout; this bounds every other call. */
  readonly timeoutMs?: number;
}

interface TelegramResponse<Result> {
  readonly ok: boolean;
  readonly result?: Result;
  readonly error_code?: number;
  readonly description?: string;
}

export class HttpTelegramApi implements TelegramApi {
  private readonly options: HttpTelegramApiOptions;

  constructor(options: HttpTelegramApiOptions) {
    this.options = options;
  }

  async call<Result>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<Result> {
    const pollSeconds = typeof params["timeout"] === "number" ? params["timeout"] : 0;
    const timeoutMs = (this.options.timeoutMs ?? 30_000) + pollSeconds * 1_000;
    let response: Response;
    try {
      response = await fetch(
        `${this.options.baseUrl ?? "https://api.telegram.org"}/bot${this.options.token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error) {
      throw new TelegramError(method, 0, error instanceof Error ? error.name : "network error");
    }
    let body: TelegramResponse<Result>;
    try {
      body = (await response.json()) as TelegramResponse<Result>;
    } catch {
      throw new TelegramError(method, response.status, "the answer was not JSON");
    }
    if (!body.ok || body.result === undefined) {
      throw new TelegramError(method, body.error_code ?? response.status, body.description ?? "no description");
    }
    return body.result;
  }
}
