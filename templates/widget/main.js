// The widget talks to its host only through fetch to relative paths. Inside Eva, Eva answers them
// with the person's data. On GitHub Pages, the mock files of this repository answer. See the
// contract: https://github.com/guplem/eva/blob/main/docs/widgets.md

const sizes = ["small", "medium", "large", "full"];
const habitFile = /^[a-z0-9-]+\.json$/;
const demoNote = "This is a demo: the change shows on this screen only.";
const locationTimeoutMs = 5000;

const root = document.querySelector(".widget");
const titleElement = root.querySelector(".widget-title");
const summaryElement = root.querySelector('[data-role="summary"]');
const listElement = root.querySelector('[data-role="habits"]');
const locationElement = root.querySelector('[data-role="location"]');
const noteElement = root.querySelector('[data-role="note"]');

/** @type {{ file: string, habit: Record<string, unknown> }[]} */
let entries = [];

/** The JSON at a path, or undefined when the path does not answer. */
async function readJson(path) {
  try {
    const response = await fetch(path);
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Today in the visitor's time zone, as YYYY-MM-DD. */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

function checksOf(habit) {
  return Array.isArray(habit.checks) ? habit.checks : [];
}

function isDoneToday(habit) {
  const date = today();
  return checksOf(habit).some((check) => check?.date === date);
}

async function loadHabits() {
  const names = await readJson("data/habits/index.json");
  if (!Array.isArray(names)) return [];
  const files = names.filter((name) => typeof name === "string" && habitFile.test(name) && name !== "index.json");
  const habits = await Promise.all(
    files.map(async (file) => ({ file, habit: await readJson(`data/habits/${encodeURIComponent(file)}`) })),
  );
  // Another widget or the person can write a file with fewer fields: show what can be shown.
  return habits.filter(({ habit }) => typeof habit === "object" && habit !== null && typeof habit.name === "string");
}

function render() {
  const done = entries.filter(({ habit }) => isDoneToday(habit)).length;
  summaryElement.textContent =
    entries.length === 0 ? "No habits yet." : `${String(done)} of ${String(entries.length)} done today`;
  listElement.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li");
      item.className = "habit";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "habit-check";
      button.setAttribute("aria-pressed", String(isDoneToday(entry.habit)));
      button.textContent = entry.habit.name;
      button.addEventListener("click", () => void toggle(entry));
      item.append(button);
      return item;
    }),
  );
}

/** Adds or removes today's check, and writes the whole file back with every field it had. */
async function toggle(entry) {
  const date = today();
  const checks = checksOf(entry.habit);
  const updated = {
    ...entry.habit,
    checks: isDoneToday(entry.habit) ? checks.filter((check) => check?.date !== date) : [...checks, { date }],
  };
  entry.habit = updated;
  render();
  try {
    const response = await fetch(`data/habits/${encodeURIComponent(entry.file)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: `${JSON.stringify(updated, null, 2)}\n`,
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch {
    // Outside Eva, a write fails: the change stays on the screen only.
    noteElement.textContent = demoNote;
    noteElement.hidden = false;
  }
}

/** The browser's location, or null when the visitor does not allow it. */
function browserLocation() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { timeout: locationTimeoutMs, maximumAge: 600000 },
    );
  });
}

/** Eva's location first, then the browser's, then the mock one, as the contract says. */
async function findLocation() {
  try {
    const response = await fetch("eva/location.json");
    if (response.ok) return { source: "eva", point: await response.json() };
  } catch {
    // No host answers: try the browser.
  }
  const point = await browserLocation();
  if (point !== null) return { source: "browser", point };
  return { source: "example", point: (await readJson("example/location.json")) ?? null };
}

async function showLocation() {
  const { source, point } = await findLocation();
  if (point === null || typeof point.latitude !== "number" || typeof point.longitude !== "number") {
    locationElement.textContent = "No location yet.";
    return;
  }
  const place = `Near ${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)}`;
  locationElement.textContent = source === "example" ? `${place} (example location)` : place;
}

async function start() {
  const size = new URLSearchParams(window.location.search).get("size");
  // Opened alone in a browser, the widget shows its full-screen view.
  root.dataset.size = sizes.includes(size) ? size : "full";
  const config = (await readJson("config.json")) ?? {};
  if (typeof config.title === "string" && config.title.trim() !== "") titleElement.textContent = config.title;
  entries = await loadHabits();
  render();
  await showLocation();
  // Tests wait for this flag: every part of the widget has its content now.
  root.dataset.ready = "true";
}

void start();
