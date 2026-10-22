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
