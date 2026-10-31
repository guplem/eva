/** The header that carries a tab's unlock secret: the core decrypts a vault file only with it (#707). */
export const unlockHeader = "x-eva-unlock";

/**
 * The shortest vault password. The thief of the remote has the wrapped key and can try passwords
 * offline, so a password must be long. The core checks it, and the page says it before a send.
 */
export const minimumPasswordLength = 12;

/** The problem with a new password and its second copy, or null when the core can take them. */
export function newPasswordProblem(password: string, again: string): string | null {
  // Characters as a person sees them, as the core counts them.
  if ([...new Intl.Segmenter().segment(password.trim())].length < minimumPasswordLength)
    return `The vault password needs at least ${String(minimumPasswordLength)} characters.`;
  if (password !== again) return "The two passwords are not the same.";
  return null;
}
