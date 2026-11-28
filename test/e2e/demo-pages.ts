/**
 * The pages that the demo answers show (#1129). The chart follows the page rules of Eva's prompt,
 * so it proves that the rules give a clean page at about 300 px wide and in full screen. The probe
 * tries each way out to the network and writes what the browser refused.
 */

/** A bar chart of one week of steps: one SVG that fills the frame, and a value on hover or tap. */
export const demoChartPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="eva/theme.css">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html { height: 100%; background: var(--bg, #f4f7fb); }
  body { height: 100%; max-width: 960px; margin: 0 auto; }
  body {
    display: flex;
    flex-direction: column;
    padding: 14px 16px 10px;
    background: var(--bg, #f4f7fb);
    color: var(--ink, #1d2430);
    font: 14px/1.35 system-ui, sans-serif;
    overflow: hidden;
  }
  header { padding-right: 52px; }
  h1 { margin: 0; font-size: 15px; font-weight: 650; }
  #value { margin: 2px 0 0; color: var(--muted, #5f6b7a); font-size: 13px; min-height: 18px; }
  #value strong { color: var(--ink, #1d2430); font-variant-numeric: tabular-nums; }
  svg { flex: 1; width: 100%; min-height: 0; margin-top: 8px; overflow: visible; }
  .grid { stroke: var(--line, #dde3ea); stroke-width: 1; }
  .axis { fill: var(--muted, #5f6b7a); font-size: 11px; }
  .bar { fill: var(--accent, #2f6fde); opacity: 0.75; transition: opacity 150ms; }
  .bar.on { opacity: 1; }
  .hit { fill: transparent; cursor: pointer; }
  .goal { stroke: var(--ok, #1f8a5b); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .goal-label { fill: var(--ok, #1f8a5b); font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>Steps this week</h1>
  <p id="value"></p>
</header>
<svg id="chart" role="img" aria-label="Bar chart of the steps of each day this week"></svg>
<script>
  const days = [
    ["Mon", 6420], ["Tue", 8105], ["Wed", 5230], ["Thu", 9412],
    ["Fri", 7380], ["Sat", 11240], ["Sun", 4310],
  ];
  const goal = 8000;
  const total = days.reduce((sum, day) => sum + day[1], 0);
  const value = document.getElementById("value");
  const chart = document.getElementById("chart");
  const ns = "http://www.w3.org/2000/svg";
  const format = (number) => number.toLocaleString("en-US");
  const resting = () => { value.innerHTML = "<strong>" + format(total) + "</strong> steps in total"; };
  function node(name, attributes) {
    const element = document.createElementNS(ns, name);
    for (const key in attributes) element.setAttribute(key, attributes[key]);
    return element;
  }
  function draw() {
    const box = chart.getBoundingClientRect();
    const width = Math.max(box.width, 200);
    const height = Math.max(box.height, 120);
    chart.setAttribute("viewBox", "0 0 " + width + " " + height);
    chart.replaceChildren();
    const left = 30, bottom = 20, top = 6;
    const plot = height - bottom - top;
    const max = 12000;
    const y = (steps) => top + plot - (steps / max) * plot;
    for (const tick of [0, 4000, 8000, 12000]) {
      chart.append(node("line", { class: "grid", x1: left, x2: width, y1: y(tick), y2: y(tick) }));
      const label = node("text", { class: "axis", x: left - 6, y: y(tick) + 4, "text-anchor": "end" });
      label.textContent = tick === 0 ? "0" : tick / 1000 + "k";
      chart.append(label);
    }
    const slot = (width - left) / days.length;
    const barWidth = Math.min(48, slot * 0.56);
    days.forEach(([day, steps], index) => {
      const x = left + slot * index + (slot - barWidth) / 2;
      const top = y(steps);
      const bar = node("path", {
        class: "bar",
        d: "M" + x + "," + y(0) + "V" + (top + 4) + "q0,-4 4,-4h" + (barWidth - 8) + "q4,0 4,4V" + y(0) + "Z",
      });
      const label = node("text", { class: "axis", x: x + barWidth / 2, y: height - 4, "text-anchor": "middle" });
      label.textContent = day;
      const hit = node("rect", { class: "hit", x: left + slot * index, y: top - 10, width: slot, height: y(0) - top + 10 });
      const show = () => {
        for (const other of chart.querySelectorAll(".bar")) other.classList.remove("on");
        bar.classList.add("on");
        value.innerHTML = day + ": <strong>" + format(steps) + "</strong> steps";
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("click", show);
      hit.addEventListener("pointerleave", () => { bar.classList.remove("on"); resting(); });
      chart.append(bar, label, hit);
    });
    chart.append(node("line", { class: "goal", x1: left, x2: width, y1: y(goal), y2: y(goal) }));
    const goalLabel = node("text", { class: "goal-label", x: width, y: y(goal) - 5, "text-anchor": "end" });
    goalLabel.textContent = "Goal 8k";
    chart.append(goalLabel);
  }
  resting();
  draw();
  new ResizeObserver(draw).observe(chart);
  document.body.dataset.ready = "true";
</script>
</body>
</html>
`;

/** The outside address that the probe tries. The browser test counts each request that reaches it. */
export const outsideAddress = "https://outside.example";

/** A page that tries every way out to the network, and lists what the browser refused. */
export const networkProbePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="eva/theme.css">
<style>
  body { margin: 0; padding: 14px 16px; background: var(--bg, #fff); color: var(--ink, #000); font: 13px system-ui, sans-serif; }
  .remote { background-image: url("${outsideAddress}/background.png"); }
</style>
</head>
<body>
<p>Network probe</p>
<ul id="out"></ul>
<script>
  const out = document.getElementById("out");
  const note = (text) => {
    if ([...out.children].some((item) => item.textContent === text)) return;
    const item = document.createElement("li");
    item.textContent = text;
    out.append(item);
  };
  document.addEventListener("securitypolicyviolation", (event) => note("refused " + event.effectiveDirective));
  // Each try starts after the listener, so the list sees each refusal.
  const image = new Image();
  image.onload = () => note("image loaded");
  image.src = "${outsideAddress}/image.png";
  document.body.append(image);
  document.body.classList.add("remote");
  const remote = document.createElement("script");
  remote.src = "${outsideAddress}/script.js";
  remote.onload = () => note("script loaded");
  document.head.append(remote);
  fetch("${outsideAddress}/data.json").then(() => note("fetch reached"), () => note("fetch failed"));
  try { new Worker("${outsideAddress}/worker.js"); } catch { note("worker failed"); }
  const frame = document.createElement("iframe");
  frame.src = "${outsideAddress}/frame.html";
  document.body.append(frame);
  note(window.open("${outsideAddress}/popup.html") === null ? "popup blocked" : "popup opened");
  try { window.top.location.href = "${outsideAddress}/top.html"; } catch { note("top navigation blocked"); }
  const form = document.createElement("form");
  form.action = "${outsideAddress}/form";
  form.method = "post";
  document.body.append(form);
  try { form.submit(); } catch { note("form failed"); }
  try { localStorage.setItem("probe", "1"); note("storage worked"); } catch { note("storage blocked"); }
  setTimeout(() => { document.body.dataset.done = "true"; }, 1500);
</script>
</body>
</html>
`;
