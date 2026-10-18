# Approve a device from the web page, and list the devices

Issue: #147. Related: #137 (PR #145, not merged yet).

## Why

A new browser gets into the web page with a short code. Today only Telegram allows it. With #137, the terminal also allows it. A person with no Telegram and no terminal at hand has no way to let a second device in.

An allowed device can do almost everything. Today the page can only log out every device at once. So, to stop a lost phone, the person also logs out every good device.

## What changes

1. **The web page is a third approver.** The local API attaches a `DeviceLoginApprover`. It can approve while at least one logged-in page has its event socket open. It sends each request to those pages. The page shows "A new device wants to get in. Allow it?" with the code and the account, and Allow and Deny buttons.
2. **Settings lists the devices.** Each row shows the label, the date, and a Remove button. The row of this browser says so. Removing a device logs out only that device.

## Design

### Core: `src/core/remote-access/device-logins.ts`

- `PendingLogin` keeps the approvers that were asked.
- `waitingFor(approver)` lists the requests that still wait and that this approver was asked. The page reads this list after a dead socket.
- `DeviceLoginApprover.settled?(id, answer)`: optional. `answer()` calls it on each approver that was asked. The page closes its dialog, and Telegram edits its question to "Allowed" or "Denied", whoever answered.
- `list(currentToken)` returns `{ id, label, createdAt, current }` for each device. The `id` is the first 16 hex digits of the stored hash. It needs no new stored field and no migration.
- `forgetById(id)` removes one device. It returns false when no single device has the id.

### Local API: `src/frontends/api/local-api.ts`

- At start, attach the web approver. `canApprove()` is true while a socket is open. `ask()` and `settled()` send an event to each open socket.
- Socket events: `{ kind: "device_login_request", request }` and `{ kind: "device_login_settled", id }`. Both are new sent names, and additions only.
- `GET /api/devices/requests`: the requests that wait for the page.
- `POST /api/devices/requests/:id` with `{ answer: "allow" | "deny" }`. 404 when the request is unknown, expired or answered.
- `GET /api/devices`: the device list, with `current` for the device cookie of the caller.
- `DELETE /api/devices/:id`: removes one device. 404 for an unknown id.
- `DELETE /api/devices` stays.

### Web page

- `App.tsx`: keep the waiting requests, as for tool approvals. Read them again in `recover()`. Show one dialog at a time. A tool approval comes first: it holds a running turn.
- New `DevicesPanel.tsx` in Settings: the list with Remove buttons, and "Log out every device".
- `LoginView.tsx`: the waiting text names Telegram or another open Eva page.

## Gaps and decisions

1. **When can the page approve?** Decision: while a logged-in page has its socket open. A sleeping phone can keep a dead socket open, so a request can wait 5 minutes for nobody. Telegram and the terminal still get the request too. A "seen lately" rule adds state for a small gain. The socket is how the page hears of a request. With no open page, the page cannot answer, so `request()` must not count it. Same as Telegram with no paired chat.
2. **Can a device login approve and remove devices, or only the token?** Decision: both logins. The issue says "a device that is already allowed". The lost-phone case needs removal from another device, which may also be a device login. The review of #137 (commit 5e3f44d) made the typed code token only, and said "Approving from the page stays for #147". This issue then asks for it in words: "approves a new browser from the page of a device that is already allowed". Accepted risk: a lost phone that is still logged in can allow more devices until the person removes it. The PR says so. `DELETE /api/devices` already works for a device login. PR #145 makes `POST /api/devices/allow` (the typed code) token only. That rule is about typing a code, which can allow a request that another program made. The page answers one request by id, after the person compares the code, as in Telegram.
3. **A request from Eva's own computer (PR #145).** Only the terminal may answer it. The web approver does not set `servesThisComputer`, so `DeviceLogins` never asks it. `waitingFor(approver)` then hides such a request from the page too.
4. **Device id.** Decision: the first 16 hex digits of the token hash. A new stored `id` field would need a migration. The hash prefix is stable, and it cannot log anyone in.
5. **Redaction.** The account comes from a header, and the label holds the user agent, which the requester controls. Decision: pass both through `eva.redact` in the events and the device list. It costs one call, and it keeps the root rule simple.
6. **Expiry.** A request expires after 5 minutes. The page drops it on the next read, or when an answer gets a 404. No timer on the page: the clocks of the phone and the server can differ. A failed answer drops the dialog too, with "This request no longer waits". Telegram keeps an expired question until someone presses a button, as today.
7. **Event schema.** The two new kinds travel beside `SessionEvent`, as `schedule_card` does. They have no `seq`: they are not session events. The client widens its event type.
8. **PR #145.** It makes `DeviceLoginApprover.name` required and adds `request.approvers`. Whichever PR merges second sets the web approver's name and lets `LoginView` read `approvers`.

## Tests

- Unit: `device-logins.test.ts` for `waitingFor`, `settled`, `list` and `forgetById`.
- Unit: `local-api.test.ts` for the routes, the socket events, and the approver that follows the open sockets.
- E2E: `test/e2e/web-ui.spec.ts` for the device list and the approval dialog, if the demo server can make a request.
