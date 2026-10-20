# Plan: a file explorer on the web page

Issue: #253.

## Motivation

The person reads a vault file today only through a chat. Eva works from a phone, so the web page must show the vault's folders and text files directly.

## Shape

- Core: `src/core/files/file-browser.ts`. `browseVault(vaultPath, path, redact)` returns a folder listing or a file view.
- Eva: `browseFiles(path)`. It throws `vault_not_found` when no vault is set.
- API: `GET /api/files?path=<path from the vault root>`.
- Web: a fifth destination, "Files", at `#/files/<path>`. `FilesView.tsx` shows the path bar, the listing and the file text.
- Pure client helpers in `client/file-paths.ts`, with unit tests.

## Gaps and decisions

1. **Root.** The vault root. Projects and clones live inside it (`AGENTS.md`: the vault layout is a contract). Extra project roots stay out for now.
2. **Read or edit.** Read only. The issue asks to read and navigate.
3. **Hidden entries.** Show dotfiles, such as `.eva/`. Hide `.git` and refuse a path through it: git data is not for people to read.
4. **Clones.** Show them. The person asked for `.js` and `.py` files, which live in clones.
5. **Secrets.** Refuse a file whose name looks like a secrets file, with the same rule as `resolveSendableFile`. Redact the text of every shown file with the `Redactor` before it leaves the core (`AGENTS.md` rule).
6. **Escape.** Resolve each path with `realpathSync` and check that it stays inside the vault, as `resolveSendableFile` does (lesson 72). A symbolic link that points out shows as a link that cannot open.
7. **Text or binary.** A file is text when its first 8 KB hold no NUL byte and decode as UTF-8. Show at most 1 MB, the same limit as a project file.
8. **Markdown.** Show a `.md` file as formatted text with `toWebHtml`, and offer the plain text too.
9. **Errors.** A missing path or a path outside the vault is an `EvaError` with the new code `file_not_found` (HTTP 404). A binary, large or secrets file is a normal answer with a reason, not an error.
10. **Phone.** The tab bar gets five columns. The address holds the path, so the back button goes up a folder.
