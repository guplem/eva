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

export interface TelegramUpload {
  /** The form field of the file, such as `document`. */
  readonly field: string;
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface TelegramApi {
  call<Result>(method: string, params?: Readonly<Record<string, unknown>>): Promise<Result>;
  /** Sends a file as a multipart form, such as `sendDocument`. */
  upload<Result>(
    method: string,
    params: Readonly<Record<string, string | number>>,
    file: TelegramUpload,
  ): Promise<Result>;
  /** Downloads a file that `getFile` named. */
  download(filePath: string): Promise<Uint8Array>;
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
    return this.request<Result>(method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(this.timeoutMs + pollSeconds * 1_000),
    });
  }

  async upload<Result>(
    method: string,
    params: Readonly<Record<string, string | number>>,
    file: TelegramUpload,
  ): Promise<Result> {
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, String(value));
    form.append(file.field, new Blob([file.bytes]), file.name);
    // An upload of up to 50 MB needs more time than a call.
    return this.request<Result>(method, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs * 10),
    });
  }

  async download(filePath: string): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/file/bot${this.options.token}/${filePath}`, {
        signal: AbortSignal.timeout(this.timeoutMs * 10),
      });
    } catch (error) {
      throw new TelegramError("download", 0, error instanceof Error ? error.name : "network error");
    }
    if (!response.ok) throw new TelegramError("download", response.status, "the file is not available");
    return new Uint8Array(await response.arrayBuffer());
  }

  private get baseUrl(): string {
    return this.options.baseUrl ?? "https://api.telegram.org";
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  private async request<Result>(method: string, init: RequestInit): Promise<Result> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/bot${this.options.token}/${method}`, init);
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
