import { createRoot } from "react-dom/client";
import { api } from "./api.ts";
import { App } from "./App.tsx";
import { applyAppearance, readAppearance } from "./appearance.ts";
import { startCues } from "./cues.ts";
import { watchLeaving } from "./leave-guard.ts";
import { watchLayers } from "./back-layers.ts";
import { logInWithLink, loginLinkOf } from "./login-link.ts";
import { sameSettingsPage } from "./settings-routes.ts";

// Before the first render, so the page never flashes the other theme.
applyAppearance(readAppearance());
startCues();

const link = loginLinkOf(window.location.hash);
// Out of the address at once, so the history, a bookmark or a shared address never keeps the secret.
if (link !== null) window.history.replaceState(null, "", link.address);
// After the address is clean, so the place of the first entry stays. Before the first render,
// so its listener runs before the listeners of the views.
watchLeaving(window, (oldURL, newURL) => sameSettingsPage(new URL(oldURL).hash, new URL(newURL).hash));
watchLayers(window);
const loginNotice =
  link === null
    ? Promise.resolve(null)
    : logInWithLink(link.secret, {
        isLoggedIn: () =>
          api.status().then(
            () => true,
            () => false,
          ),
        redeem: api.redeemLoginLink,
      });
void loginNotice.then((notice) => {
  const root = document.getElementById("root");
  if (root !== null) createRoot(root).render(<App loginNotice={notice} />);
});

// The service worker shows Eva's alerts while the app is closed. A browser without one still runs the page.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
