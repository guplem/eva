# Plan: web notifications (issue 360)

## Motivation

The person gives Eva a long task and leaves the page. A schedule runs while nobody looks. A tool call waits for an approval. Now the person learns about each one only when they open the page again. Eva works from a phone, and a phone stops a page in the background. So the notification must reach a closed page too.

## Gaps

Each gap is a missing fact or an open decision. The decision follows each gap once it is known.

1. **Delivery.** Web Push with a service worker, or the `Notification` API from the open page?
2. **Push code.** Our own Web Push code (VAPID and payload encryption with WebCrypto), or the `web-push` package?
3. **Storage.** Where do the VAPID keys, the push subscriptions and the on/off settings live?
4. **Events.** Which events send a notification, and how does Eva know the origin of a turn (a chat, a schedule, Telegram)?
5. **Page in view.** How does Eva skip a notification while the person looks at the page?
6. **Machines.** What do a hub and a satellite each send? Does a turn that Telegram started also send a notification?
7. **Service worker file.** How does `Bun.serve` serve it, also from the single executable?
8. **Tap.** Which address opens the chat of the notification?
9. **Device removal.** What happens to a subscription when the person removes a device login?
10. **Settings page.** Which section and which cards?
11. **Outbound request.** Which seam sends the HTTP request to the push service, so tests use a fake?

## Decisions

Issue 369 already sends Eva's alerts as Web Push. This plan extends that path. It adds no second one.

1. **Delivery:** Web Push and the service worker of issue 369 (`src/core/alerts/web-push.ts`, `src/frontends/web/service-worker-script.ts`). Only a push reaches a closed page or a phone in the background.
2. **Push code:** keep the empty push and Eva's own VAPID code. The worker reads the text from Eva with the login cookie, so no chat text passes through a push service.
3. **Storage:** each stored subscription gets an optional `kinds` list. Each device picks its own kinds, as each device turns notifications on for itself. A missing list means every kind. The vault is not the home: one device can want less than another.
4. **Events:** four kinds.
   - `alerts`: Eva's problem alerts, as now.
   - `replies`: a `turn_finished` or `turn_failed` of a chat.
   - `schedules`: the same, for a chat with `source: "schedule"`.
   - `approvals`: an `approval_needed`.
   - A turn that a Telegram message started sends no push: the person sees the answer in Telegram already.
   - The body is the start of the last text of the turn. Session events are already redacted.
5. **Page in view:** the page tells Eva over HTTP that it is in view, with its push address. The claim lasts 90 seconds, and the page renews it each minute while it stays in view. Eva sends no push to that address while the claim lasts. A phone that sleeps cannot say "hidden", so the claim ends by itself. The worker still shows each push that it gets: Safari ends a subscription that gets silent pushes.
6. **Machines:** the alerts stay on the hub only. Each machine sends the chat kinds of its own chats to its own subscriptions. So a satellite page can turn on notifications too, for its chats.
7. **Service worker file:** edit the script text in `service-worker-script.ts`.
8. **Tap:** a chat notification opens `/#/chat/<id>`.
9. **Device removal:** each subscription keeps the device id of a device login. A removal of that device login drops its subscriptions.
10. **Settings page:** the kind switches go in the `PushCard` (`item="notifications"`, Access section).
11. **Outbound request:** the `PushSender` seam, with a fake in tests.
12. **Per device list:** Eva records the addresses that got each pushed entry. The worker asks for the entries of its own address only, so a device never shows an entry that was not for it.
