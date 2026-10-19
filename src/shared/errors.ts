/** The error codes Eva raises on purpose. Anything else is a bug. */
export type EvaErrorCode =
  | "config_invalid"
  | "instance_locked"
  | "process_timeout"
  | "process_failed"
  | "git_failed"
  | "vault_not_found"
  | "project_not_found"
  | "engine_failed"
  | "session_busy"
  | "session_not_found"
  | "schedule_invalid"
  | "update_failed"
  | "device_login_unavailable"
  | "rate_limited"
  | "setting_forbidden"
  | "github_failed"
  | "google_failed"
  | "tailscale_install_failed"
  | "engine_install_failed"
  | "project_invalid"
  | "project_changed"
  | "title_invalid"
  | "vault_ahead"
  | "vault_setup_busy";

/** An expected failure, with a code a caller can branch on and a message a person can read. */
export class EvaError extends Error {
  readonly code: EvaErrorCode;

  constructor(code: EvaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvaError";
    this.code = code;
  }
}

/** True when `error` is an EvaError with this code. */
export function isEvaError(error: unknown, code?: EvaErrorCode): error is EvaError {
  return error instanceof EvaError && (code === undefined || error.code === code);
}
