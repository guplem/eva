/**
 * The service worker of the web app, as the text that `/sw.js` serves. It shows Eva's alerts as
 * system notifications while the app is closed (#369).
 *
 * A push from Eva is empty: it only wakes this worker. The worker then reads the newest alert from
 * Eva with the login cookie, so no alert text passes through the browser's push service.
 */
export const serviceWorkerScript = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function newestAlert() {
  try {
    const response = await fetch("/api/notifications/recent", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const answer = await response.json();
    return answer.alerts[0] ?? null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    newestAlert().then((alert) =>
      self.registration.showNotification("Eva", {
        // With no alert to read, such as after a logout, the notification still says to look.
        body: alert === null ? "Eva has news. Open Eva to see it." : alert.message,
        tag: alert === null ? "eva" : alert.key,
        icon: "/icon-192.png",
        data: { url: "/" },
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((each) => new URL(each.url).origin === self.location.origin);
      return open === undefined ? self.clients.openWindow(event.notification.data.url) : open.focus();
    }),
  );
});
`;
