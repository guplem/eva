# Login page in the EVE style

Issue: #168. Part of #161.

## Motivation

The login page is the first page that a new phone or computer sees. The owner chose the EVE style for the whole web page. The design is in `docs/design/eve/`, section "Confirm this device".

## What changes

- `src/frontends/web/client/LoginView.tsx`: the device code page, the token form, and the asking, denied and expired states.
- `src/frontends/web/login.css`: the styles of the login page only. `index.html` links it, as it links `visor.css`.
- `src/frontends/web/client/login-faces.ts`: the face of each login state, from `stateFaces`.
- Tests: `test/e2e/web-ui.spec.ts` and `test/unit/frontends/web/client/login-faces.test.ts`.

## Gaps and decisions

1. **The code format.** The reference shows `K7Q·4MF`, six letters with a dot. Eva's codes have four letters. Decision: show the code as it is, with no dot. The command and the copied text stay exact.
2. **Copy when the page has no clipboard.** The clipboard exists only on a secure page (HTTPS or localhost). Decision: hide "Copy code" when `navigator.clipboard` is missing, as the code is large and easy to type. After a copy, the button says "Copied" for 2 s.
3. **The ways to allow.** The reference shows three ways. Decision: show only the ways in `approvers`, each with its icon (`term`, `chat`, `laptop`). Keep the exact command. Keep the hint for `eva setup`, in a smaller line, because the terminal is busy during setup.
4. **Compare the code.** Today's text says "if it shows the same code". The reference drops it. Decision: keep it as "if it shows this code", because comparing the code stops a login from another device.
5. **The token form design.** The reference does not show it. Decision: build it from the same parts: the visor, a title, a muted line, an input with the input radius, a main pill button, and the token link as a ghost button.
6. **The way back from the token form.** Decision: after "Log in with the token instead", a ghost button "Use the code instead" returns to the same request. No new request starts. The page keeps polling that request while the token form shows, so an Allow still opens the page by itself.
7. **The faces.** Decision: the waiting page rotates faces. The asking state shows the searching face. Denied shows sad (`stateFaces.failed`). Expired shows skeptical (`stateFaces.conflict`), as the issue asks. The plain token form shows neutral.
8. **The visor size on a phone.** Decision: one `<Visor size={128} />`, and a CSS rule sets 76 px below 760 px wide, as the layout rules of `styles.css` do.
9. **Roles and labels.** Keep the `Token` label, the `Log in` and `Ask again` buttons, the `status` text of the token form, and the `alert` for a wrong token. The e2e tests use them.
10. **Reduced motion.** The three dots stop, as the visor does.
