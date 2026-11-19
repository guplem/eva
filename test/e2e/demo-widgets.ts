/**
 * Two small static widgets of the demo, so the home page shows a day panel with more than one size
 * (#972). The real Calendar and Cases widgets live in their own repositories, and the demo never
 * reaches GitHub. Each one is a page with made-up data and no script.
 */

/** The shared look: the colours of eva/theme.css, with a fallback for each. */
const style = `html, body { margin: 0; height: 100%; }
body { background: var(--panel, #fff); color: var(--ink, #1f2430); font: 13px system-ui, sans-serif; }
.widget { box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; height: 100vh; padding: 14px 16px; overflow: hidden; }
h1 { margin: 0; padding-right: 40px; font-size: 15px; }
.muted { color: var(--muted, #5d6475); }
.week { flex: 1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; min-height: 0; }
.day { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.day h2 { margin: 0 0 4px; font-size: 12px; }
.today h2 { color: var(--accent-ink, #1565c0); }
.event { padding: 6px 8px; border-left: 3px solid var(--accent, #1e88e5); border-radius: 6px; background: var(--soft, #e8f0fb); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.event small { display: block; color: var(--muted, #5d6475); }
.cases { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.case { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; background: var(--chip, #eef1f6); }
.case strong { display: flex; justify-content: space-between; gap: 8px; }
.bad { color: var(--bad, #c62828); }
.warn { color: var(--warn, #b26a00); }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="eva/theme.css" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="widget">${body}</main>
  </body>
</html>
`;
}

function manifest(name: string, size: string): string {
  return `${JSON.stringify({ contract: 2, name, entry: "index.html", size, inputs: [], hosts: [] }, null, 2)}\n`;
}

const days: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  [
    "Mon",
    [
      ["Team standup", "09:00"],
      ["Design review", "11:00"],
      ["Deep work", "15:00"],
    ],
  ],
  [
    "Tue",
    [
      ["Dentist", "12:00"],
      ["Sprint planning", "14:00"],
    ],
  ],
  [
    "Wed",
    [
      ["Code review", "09:30"],
      ["Yoga", "18:00"],
    ],
  ],
  [
    "Thu",
    [
      ["Farmers market", "10:00"],
      ["Padel", "17:00"],
    ],
  ],
  [
    "Fri",
    [
      ["Brunch", "11:00"],
      ["Movie night", "19:00"],
    ],
  ],
];

const calendarBody = `
      <h1>Calendar</h1>
      <div class="week">${days
        .map(
          ([day, events], index) => `
        <section class="day${index === 0 ? " today" : ""}"><h2>${day}</h2>${events
          .map(([title, time]) => `<div class="event">${title}<small>${time}</small></div>`)
          .join("")}</section>`,
        )
        .join("")}
      </div>`;

const casesBody = `
      <h1>Cases <span class="muted">3 open</span></h1>
      <ul class="cases">
        <li class="case"><strong>Fix the bathroom leak <span class="bad">Overdue</span></strong><span class="muted">Confirm the date with the plumber</span></li>
        <li class="case"><strong>Renew car insurance <span class="warn">Tomorrow</span></strong><span class="muted">Compare the two quotes</span></li>
        <li class="case"><strong>Tax return <span class="muted">In 5 days</span></strong><span class="muted">Send the receipts</span></li>
      </ul>`;

/** The files of each demo widget, by its repository name. */
export const demoWidgets: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "calendar-widget": {
    "eva-widget.json": manifest("Calendar", "xlarge"),
    "index.html": page("Calendar", calendarBody),
    "style.css": style,
  },
  "cases-widget": {
    "eva-widget.json": manifest("Cases", "tall"),
    "index.html": page("Cases", casesBody),
    "style.css": style,
  },
};
