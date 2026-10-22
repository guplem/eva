/**
 * The service worker of the web app, as the text that `/sw.js` serves. It shows Eva's alerts as
 * system notifications while the app is closed (#369).
 *
 * A push from Eva is empty: it only wakes this worker. The worker then reads the newest alerts from
 * Eva with the login cookie, so no alert text passes through the browser's push service. Each
 * alert has a number, and the worker keeps the last number that it showed. So two alerts that come
 * close together show twice, and a push that comes after them shows nothing twice.
 */
export const serviceWorkerScript = `
const stateCache = "eva-notifications";
const lastShownUrl = "/last-shown-alert";
/** A phone that was off for a day gets at most this many notifications at once. */
const maxAtOnce = 3;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function recentAlerts() {
  try {
    const response = await fetch("/api/notifications/recent", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return [];
    return (await response.json()).alerts;
  } catch {
    return [];
  }
}

async function lastShown() {
  const cache = await caches.open(stateCache);
  const response = await cache.match(lastShownUrl);
  return response === undefined ? 0 : Number(await response.text());
}

async function remember(seq) {
  const cache = await caches.open(stateCache);
  await cache.put(lastShownUrl, new Response(String(seq)));
}

/** The page that fixes the problem of an alert, as the problem notices of the app pick it. */
function pageOf(key) {
  if (key.startsWith("schedule:") || key.startsWith("schedule_card:")) return "/#/schedules";
  if (key === "template_alignment") return "/#/settings/vault/template-alignment";
  return key === "push_test" ? "/" : "/#/settings";
}

const titles = { error: "Eva: problem", warn: "Eva: problem", resolved: "Eva: solved", news: "Eva" };

function show(alert) {
  return self.registration.showNotification(titles[alert.level] ?? "Eva", {
    body: alert.message,
    tag: alert.key,
    // A problem that comes back while its old notice is still there sounds again.
    renotify: alert.level === "warn" || alert.level === "error",
    icon: "/icon-192.png",
    data: { url: pageOf(alert.key) },
  });
}

async function showNew() {
  const alerts = await recentAlerts();
  // After a logout or a restart of Eva, the list is empty, but a push must still show something.
  if (alerts.length === 0) {
    return self.registration.showNotification("Eva", { body: "Eva has news. Open Eva to see it.", tag: "eva", data: { url: "/" } });
  }
  const last = await lastShown();
  // A lower number means that Eva restarted, so every alert in the list is new to this device.
  const fresh = alerts.filter((alert) => alert.seq > last || alerts[0].seq < last).slice(0, maxAtOnce);
  await remember(alerts[0].seq);
  // A push with no new alert still shows one, as browsers require: the newest replaces its own notice.
  await Promise.all((fresh.length === 0 ? [alerts[0]] : fresh.reverse()).map(show));
}

self.addEventListener("push", (event) => event.waitUntil(showNew()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((each) => new URL(each.url).origin === self.location.origin);
      if (open === undefined) return self.clients.openWindow(url);
      await open.navigate(url);
      return open.focus();
    }),
  );
});
`;
