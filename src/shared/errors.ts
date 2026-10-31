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
  /** The chat is closed: Eva reused its clone, so it takes no message. */
  | "session_closed"
  /** Eva has no snapshot of the files that a fork or a retry asked for. */
  | "snapshot_missing"
  | "schedule_invalid"
  | "update_failed"
  | "device_login_unavailable"
  | "rate_limited"
  | "setting_forbidden"
  | "github_failed"
  | "google_failed"
  | "claude_login_failed"
  | "tailscale_install_failed"
  | "tailscale_account_refused"
  | "engine_install_failed"
  | "project_invalid"
  | "project_changed"
  | "title_invalid"
  /** A text action or a saved prompt of the message box menu with a bad name or text. */
  | "menu_item_invalid"
  | "vault_ahead"
  | "vault_setup_busy"
  | "file_not_found"
  | "voice_unavailable"
  | "rules_changed"
  | "file_changed"
  | "file_not_writable"
  | "file_not_downloadable"
  /** An answer to an approval that does not fit it, such as no answers to the model's questions. */
  | "approval_invalid"
  /** A person stopped a question with Ctrl+C, or its input ended. */
  | "prompt_stopped"
  /** The running Eva refused a request of the CLI, and her answer named no code. */
  | "request_failed"
  /** A vault password that is too short to set (#707). */
  | "vault_password_invalid"
  /** A vault password that does not unlock the vault's key (#707). */
  | "vault_password_wrong"
  /** The vault's key file is broken, or someone changed it (#707). */
  | "vault_key_invalid"
  /** This device has no unlocked vault key, or the request cannot use one (#707). */
  | "vault_locked"
  /** The vault has no key yet, so it has no password to type (#707). */
  | "vault_key_missing"
  /** An encrypted vault file that does not decrypt, such as one that someone changed (#707). */
  | "vault_file_unreadable"
  /** A widget address, input or manifest that Eva cannot use (#691). */
  | "widget_invalid"
  /** No widget of the list has this id. */
  | "widget_not_found"
  /** The widget has no approved record on this computer, or its record no longer matches the vault. */
  | "widget_needs_approval"
  /** A written data format of the widget conflicts with the format of its folder (#692). */
  | "widget_format_conflict";

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
