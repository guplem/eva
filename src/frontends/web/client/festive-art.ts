/**
 * The festive eyes of each special day, as SVG markup in a 24 by 24 box. The markup is constant,
 * so the visor and the tab icon draw the same eyes. `currentColor` is the eye colour. The classes
 * `cut` (a fill) and `cut-line` (a stroke) take the dark of the visor, and `tint` takes the glow.
 * Some art keeps its own colours, such as a red rose or a rainbow: they are the drawing, not a theme colour.
 */
import type { SpecialDayId } from "./special-days.ts";

/** A scene plays inside the visor, and only on the large visors. */
export type FestiveScene = "snow" | "confetti" | "leaves" | "stars" | "meteors" | "bee" | "smoke";

export interface FestiveArt {
  /** The hue and the chroma of the eyes, as the EVE tokens take them. */
  readonly hue: number;
  readonly chroma: number;
  readonly eyes: readonly [string, string];
  /** The name of the motion class in `visor.css`. */
  readonly motion: string;
  /** A hat, a mask or ears, drawn around the visor on the large visors. */
  readonly decoration?: string;
  readonly scene?: FestiveScene;
}

const fill = 'fill="currentColor"';

function glyph(text: string, font: string): string {
  return `<text x="12" y="20" text-anchor="middle" font-size="22" font-weight="800" font-family="${font}" ${fill}>${text}</text>`;
}

const eye = {
  heart: `<path ${fill} d="M12 21s-7.5-4.6-9.7-9.3C.6 8 2.8 4 6.6 4c2.3 0 3.9 1.4 5.4 3.2C13.5 5.4 15.1 4 17.4 4c3.8 0 6 4 4.3 7.7C19.5 16.4 12 21 12 21z"/>`,
  star: `<path ${fill} d="M12 1.5l2.6 7.1h7.4l-6 4.6 2.3 7.3L12 16l-6.3 4.5L8 13.2 2 8.6h7.4z"/>`,
  burst: `<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.5 3.5M15.6 15.6l3.5 3.5M4.9 19.1l3.5-3.5M15.6 8.4l3.5-3.5"/></g><circle cx="12" cy="12" r="2.2" ${fill}/>`,
  flake: `<g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M12 1v22M2.5 6.5l19 11M2.5 17.5l19-11"/><path d="M9 3l3 3 3-3M9 21l3-3 3 3M3 10l4-1-1-4M21 14l-4 1 1 4M3 14l4 1-1 4M21 10l-4-1 1-4"/></g>`,
  flame: `<path ${fill} d="M12 1c1.2 4.2 6.5 6.6 6.5 13a6.5 6.5 0 0 1-13 0c0-3.2 1.7-4.7 2.4-7.3 1.8 1.2 2.7 3 2.7 5.3 1.7-2.8.7-6.5 1.4-11z"/>`,
  pumpkinLeft: `<path ${fill} d="M2 20L9 5l13 13z"/>`,
  pumpkinRight: `<path ${fill} d="M22 20L15 5 2 18z"/>`,
  egg: `<path ${fill} d="M12 1.5c4.4 0 8 7.4 8 13a8 8 0 0 1-16 0c0-5.6 3.6-13 8-13z"/><path class="cut-line" d="M4.6 12.5l3-2 3 2 3-2 3 2 3-2" fill="none" stroke-width="1.6" opacity=".75"/>`,
  flower: `<g ${fill}>${[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => `<ellipse cx="12" cy="5.5" rx="2.6" ry="5" transform="rotate(${String(angle)} 12 12)"/>`).join("")}</g><circle class="cut" cx="12" cy="12" r="3" opacity=".6"/>`,
  joy: `<path ${fill} d="M2 17C4 7 20 7 22 17c-3-4.5-17-4.5-20 0z"/>`,
  rainbow: ["#ff5a5a", "#ffa94d", "#ffe066", "#69db7c", "#4dabf7", "#b197fc"]
    .map((colour, step) => {
      const radius = 10 - step * 1.4;
      return `<path d="M${String(2 + step * 1.4)} 19a${String(radius)} ${String(radius)} 0 0 1 ${String(20 - step * 2.8)} 0" stroke="${colour}" stroke-width="1.6" fill="none"/>`;
    })
    .join(""),
  pi: glyph("π", "Georgia,serif"),
  two: glyph("2", "system-ui,sans-serif"),
  nine: glyph("9", "system-ui,sans-serif"),
  sun: `<circle cx="12" cy="12" r="5.5" ${fill}/><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>`,
  moon: `<path ${fill} d="M15 2a10 10 0 1 0 7 15A8 8 0 0 1 15 2z"/>`,
  fullMoon: `<circle cx="12" cy="12" r="10.5" ${fill}/><g class="cut" opacity=".22"><circle cx="8" cy="9" r="2.6"/><circle cx="15" cy="14" r="3.2"/><circle cx="9" cy="16" r="1.5"/><circle cx="16" cy="7" r="1.2"/></g>`,
  sprout: `<path d="M12 22V11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path ${fill} d="M12 12C12 6 8 3 2 3c0 6 4 9 10 9zM12 14c0-5 3-8 10-8 0 6-4 8-10 8z"/>`,
  leaf: `<path ${fill} d="M12 1l2 5 4-2-1 5 5 1-4 3 2 3-5-1-1 4h-4l-1-4-5 1 2-3-4-3 5-1-1-5 4 2z"/><path d="M12 23v-8" stroke="currentColor" stroke-width="1.8"/>`,
  globe: `<circle cx="12" cy="12" r="10.5" ${fill}/><path class="cut" opacity=".55" d="M5 6c3 0 4 2 3 4s1 3 0 5-3 1-4-2-1-6 1-7zm9-3c3 1 3 3 1 4s-1 3 2 3 3 3 1 6-4 3-4 0-3-3-2-6 0-6 2-7z"/>`,
  venus: `<g stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"><circle cx="12" cy="9" r="6.5"/><path d="M12 15.5V23M8.5 19.5h7"/></g>`,
  cat: `<ellipse cx="12" cy="12" rx="10.5" ry="8" ${fill}/><ellipse class="cut" cx="12" cy="12" rx="1.6" ry="7"/>`,
  puppy: `<circle cx="12" cy="12" r="9" ${fill}/><circle class="cut" cx="12" cy="13" r="5.5" opacity=".55"/><circle cx="9" cy="9" r="2.6" fill="#fff"/><circle cx="14.5" cy="15" r="1.1" fill="#fff" opacity=".8"/>`,
  tagOpen: `<path d="M17 3L6 12l11 9" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  tagClose: `<path d="M5 3l11 9-11 9" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect class="caret" x="20" y="16" width="6" height="3" ${fill}/>`,
  rose: `<path d="M12 13v10" stroke="#4caf50" stroke-width="2"/><path fill="#4caf50" d="M12 19c-4 0-6-2-6-4 3 0 5 1 6 4z"/><path fill="#ff4d5e" d="M5 4c2 1.5 3.6 1 4.6-1.8 1 2 3.8 2 4.8 0C15.4 5 17 5.5 19 4c.5 6-2.4 10-7 10S4.5 10 5 4z"/><path d="M9.6 2.2C10 6 12 8 14.4 2.2" stroke="#b3122a" stroke-width="1.2" fill="none"/>`,
  book: `<path ${fill} d="M12 6C9 4 5 4 1 5v14c4-1 8-1 11 1 3-2 7-2 11-1V5c-4-1-8-1-11 1z"/><path class="cut-line" d="M12 6v14" stroke-width="1.2"/><path class="page tint" d="M12 6c2-1.6 5-2 8-1.4V18c-3-.6-6 0-8 1.4z" opacity=".85"/>`,
  horseshoe: `<path d="M5.5 4v6a6.5 6.5 0 0 0 13 0V4" stroke="currentColor" stroke-width="4.4" fill="none" stroke-linecap="round" transform="rotate(180 12 12)"/><g class="cut"><circle cx="6.5" cy="15" r=".9"/><circle cx="17.5" cy="15" r=".9"/><circle cx="7.6" cy="9" r=".9"/><circle cx="16.4" cy="9" r=".9"/></g>`,
  honeycomb: `<path ${fill} d="M12 1.5l9 5.2v10.6l-9 5.2-9-5.2V6.7z"/><path class="cut" d="M12 6.5l4.8 2.8v5.4L12 17.5l-4.8-2.8V9.3z" opacity=".3"/>`,
  cup: `<path ${fill} d="M3 10h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6z"/><path d="M17 12h2a2.5 2.5 0 0 1 0 5h-2" stroke="currentColor" stroke-width="2" fill="none"/><path class="steam" d="M7 7c-1-1.5 1-2.5 0-4M12 7c-1-1.5 1-2.5 0-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  ring: `<circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="3.2" fill="none"/><path ${fill} d="M12 0l3 3-3 3-3-3z"/>`,
  leafOf420: `<g ${fill}>${(
    [
      [-80, 6],
      [-52, 9.5],
      [-26, 13],
      [0, 15.5],
      [26, 13],
      [52, 9.5],
      [80, 6],
    ] as const
  )
    .map(
      ([angle, length]) =>
        `<ellipse cx="12" cy="${String(19 - length / 2)}" rx="${String(length / 6.5)}" ry="${String(length / 2)}" transform="rotate(${String(angle)} 12 19)"/>`,
    )
    .join("")}</g><path d="M12 19v4" stroke="currentColor" stroke-width="1.6"/>`,
} as const;

/** A decoration is one SVG placed in em around the visor, so it scales with the visor. */
function around(viewBox: string, place: string, body: string): string {
  return `<svg viewBox="${viewBox}" style="${place}">${body}</svg>`;
}

const decoration = {
  santaHat: around(
    "0 0 40 30",
    "width:.62em;left:.42em;top:-.36em;transform:rotate(18deg)",
    '<path d="M3 24C8 8 20 1 33 6c4 2 4 9 3 13-3-6-9-8-12-5L32 24z" fill="#d63a3a"/><rect x="1" y="21" width="33" height="7" rx="3.5" fill="#fff"/><circle cx="36" cy="20" r="4" fill="#fff"/>',
  ),
  crown: around(
    "0 0 40 24",
    "width:.5em;left:.25em;top:-.3em",
    '<path d="M3 22L1 5l10 8 9-12 9 12 10-8-2 17z" fill="#f2c14e" stroke="#c9952a" stroke-width="1.2"/><circle cx="20" cy="15" r="2.5" fill="#d63a3a"/>',
  ),
  partyHat: around(
    "0 0 30 34",
    "width:.36em;left:.5em;top:-.36em;transform:rotate(16deg)",
    '<path d="M15 2L27 32H3z" fill="#7c5cff"/><path d="M9 17l12 4M6 25l17 5" stroke="#ffe066" stroke-width="3"/><circle cx="15" cy="3" r="3.2" fill="#ff6b9a"/>',
  ),
  mask: around(
    "0 0 80 34",
    "width:.82em;left:.09em;top:.27em",
    '<path d="M2 12C10 0 30 4 40 12 50 4 70 0 78 12c-2 14-16 22-28 14-4-3-6-6-10-6s-6 3-10 6C18 34 4 26 2 12z" fill="#e8456b" opacity=".92"/><path d="M78 12c4-6 2-12-4-14" stroke="#ffd43b" stroke-width="3" fill="none"/><ellipse class="cut" cx="22" cy="15" rx="10" ry="6"/><ellipse class="cut" cx="58" cy="15" rx="10" ry="6"/>',
  ),
  bat: around(
    "0 0 40 16",
    "width:.3em;left:.68em;top:-.16em",
    '<path d="M20 6c-2-3-4-3-5 0-3-4-9-5-15-2 4 1 6 4 6 8 3-2 6-2 8 1 2-2 4-3 6-1 2-2 4-1 6 1 2-3 5-3 8-1 0-4 2-7 6-8-6-3-12-2-15 2-1-3-3-3-5 0z" fill="#3a3346"/>',
  ),
  catEars: around(
    "0 0 60 16",
    "width:.9em;left:.05em;top:-.12em",
    '<path class="cut shell-line" d="M4 16L8 0l12 12zM56 16L52 0 40 12z" stroke-width="2"/>',
  ),
  dogEars: around(
    "0 0 80 40",
    "width:1.2em;left:-.1em;top:-.02em",
    '<path d="M14 4C4 4 0 16 2 30c1 6 8 6 10 0l6-20z" fill="#8a6a4a"/><path d="M66 4c10 0 14 12 12 26-1 6-8 6-10 0L62 10z" fill="#8a6a4a"/>',
  ),
} as const;

export const festiveArt: Record<SpecialDayId, FestiveArt> = {
  birthday: {
    hue: 280,
    chroma: 0.14,
    eyes: [eye.joy, eye.joy],
    motion: "f-bounce",
    decoration: decoration.partyHat,
    scene: "confetti",
  },
  anniversary: { hue: 330, chroma: 0.14, eyes: [eye.ring, eye.ring], motion: "f-twinkle" },
  newYear: { hue: 85, chroma: 0.15, eyes: [eye.burst, eye.burst], motion: "f-pop" },
  kings: { hue: 80, chroma: 0.14, eyes: [eye.star, eye.star], motion: "f-twinkle", decoration: decoration.crown },
  valentine: { hue: 5, chroma: 0.17, eyes: [eye.heart, eye.heart], motion: "f-beat" },
  carnival: { hue: 330, chroma: 0.16, eyes: [eye.joy, eye.joy], motion: "f-bounce", decoration: decoration.mask },
  easter: { hue: 160, chroma: 0.1, eyes: [eye.egg, eye.egg], motion: "f-wobble" },
  santJordi: { hue: 20, chroma: 0.16, eyes: [eye.rose, eye.book], motion: "f-jordi" },
  santJoan: { hue: 55, chroma: 0.18, eyes: [eye.flame, eye.flame], motion: "f-flicker" },
  pride: { hue: 300, chroma: 0.1, eyes: [eye.rainbow, eye.rainbow], motion: "f-bounce" },
  halloween: {
    hue: 55,
    chroma: 0.19,
    eyes: [eye.pumpkinLeft, eye.pumpkinRight],
    motion: "f-candle",
    decoration: decoration.bat,
  },
  allSaints: { hue: 65, chroma: 0.17, eyes: [eye.flower, eye.flower], motion: "f-bloom" },
  christmas: {
    hue: 215,
    chroma: 0.09,
    eyes: [eye.flake, eye.flake],
    motion: "f-spin",
    decoration: decoration.santaHat,
    scene: "snow",
  },
  springEquinox: { hue: 140, chroma: 0.15, eyes: [eye.sprout, eye.sprout], motion: "f-wobble" },
  summerSolstice: { hue: 90, chroma: 0.17, eyes: [eye.sun, eye.sun], motion: "f-sun" },
  autumnEquinox: { hue: 45, chroma: 0.16, eyes: [eye.leaf, eye.leaf], motion: "f-sway", scene: "leaves" },
  winterSolstice: { hue: 265, chroma: 0.1, eyes: [eye.moon, eye.moon], motion: "f-look", scene: "stars" },
  perseids: { hue: 260, chroma: 0.12, eyes: [eye.star, eye.star], motion: "f-look", scene: "meteors" },
  womensDay: { hue: 305, chroma: 0.16, eyes: [eye.venus, eye.venus], motion: "f-bounce" },
  piDay: { hue: 245, chroma: 0.12, eyes: [eye.pi, eye.pi], motion: "f-bounce" },
  fourTwenty: { hue: 140, chroma: 0.16, eyes: [eye.leafOf420, eye.leafOf420], motion: "f-chill", scene: "smoke" },
  earthDay: { hue: 175, chroma: 0.13, eyes: [eye.globe, eye.globe], motion: "f-spin" },
  beeDay: { hue: 85, chroma: 0.16, eyes: [eye.honeycomb, eye.honeycomb], motion: "f-bounce", scene: "bee" },
  catDay: { hue: 110, chroma: 0.15, eyes: [eye.cat, eye.cat], motion: "f-slit", decoration: decoration.catEars },
  dogDay: { hue: 50, chroma: 0.12, eyes: [eye.puppy, eye.puppy], motion: "f-tilt", decoration: decoration.dogEars },
  programmersDay: { hue: 150, chroma: 0.15, eyes: [eye.tagOpen, eye.tagClose], motion: "f-code" },
  coffeeDay: { hue: 55, chroma: 0.08, eyes: [eye.cup, eye.cup], motion: "f-steam" },
  leapDay: { hue: 195, chroma: 0.13, eyes: [eye.two, eye.nine], motion: "f-jump" },
  fridayThe13th: { hue: 130, chroma: 0.13, eyes: [eye.horseshoe, eye.horseshoe], motion: "f-tremble" },
  fullMoon: { hue: 250, chroma: 0.05, eyes: [eye.fullMoon, eye.fullMoon], motion: "f-moon", scene: "stars" },
};

function spots(count: number, each: (step: number) => string): string {
  return Array.from({ length: count }, (_, step) => each(step)).join("");
}

const confettiColours = ["#ff6b9a", "#ffe066", "#69db7c", "#4dabf7", "#b197fc"];
const leafColours = ["#e8590c", "#f08c00", "#c92a2a"];

function falling(count: number, colours: readonly string[]): string {
  return spots(
    count,
    (step) =>
      `<span class="f-confetti" style="left:${String(6 + (step * 88) / count)}%;background:${colours[step % colours.length] ?? ""};animation-duration:${String(2 + (step % 4) * 0.5)}s;animation-delay:-${String(step * 0.41)}s"></span>`,
  );
}

/** The markup of a scene: spans that the classes in `visor.css` move. */
export function sceneMarkup(scene: FestiveScene): string {
  switch (scene) {
    case "snow":
      return spots(
        9,
        (step) =>
          `<span class="f-flake" style="left:${String(8 + step * 9.3)}%;animation-duration:${String(2.2 + (step % 3) * 0.7)}s;animation-delay:-${String(step * 0.53)}s"></span>`,
      );
    case "confetti":
      return falling(10, confettiColours);
    case "leaves":
      return falling(7, leafColours);
    case "stars":
      return [
        [12, 18],
        [30, 8],
        [70, 12],
        [85, 26],
        [50, 6],
      ]
        .map(
          ([left, top], step) =>
            `<span class="f-star" style="left:${String(left)}%;top:${String(top)}%;animation-duration:${String(2 + step * 0.4)}s"></span>`,
        )
        .join("");
    case "meteors":
      return spots(
        3,
        (step) =>
          `<span class="f-meteor" style="left:${String(55 + step * 15)}%;top:${String(8 + step * 10)}%;animation-delay:-${String(step * 0.9)}s"></span>`,
      );
    case "bee":
      return '<svg class="f-bee" viewBox="0 0 14 10"><ellipse cx="7" cy="6" rx="5" ry="3.6" fill="#ffd43b"/><path d="M5 2.6v6.8M8.4 2.6v6.8" stroke="#222" stroke-width="1.4"/><ellipse cx="6" cy="2" rx="2.4" ry="1.6" fill="#fff" opacity=".8"/></svg>';
    case "smoke":
      return spots(
        3,
        (step) =>
          `<span class="f-puff" style="left:${String(30 + step * 18)}%;animation-delay:-${String(step * 1.2)}s"></span>`,
      );
  }
}

/** The tab icon of a special day: the visor of `icons/icon.svg`, with its colours, and the festive eyes. */
export function festiveIconSvg(id: SpecialDayId): string {
  const art = festiveArt[id];
  const eyeColour = `oklch(0.87 ${String(Math.min(art.chroma, 0.13))} ${String(art.hue)})`;
  const glowColour = `oklch(0.74 ${String(art.chroma)} ${String(art.hue)})`;
  const place = (x: number, markup: string): string =>
    `<svg x="${String(x - 15)}" y="30" width="30" height="30" viewBox="0 0 24 24" overflow="visible">${markup}</svg>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `<style>.cut{fill:#000102}.cut-line{stroke:#000102}.tint{fill:${glowColour}}</style>`,
    '<defs><radialGradient id="visor" cx="50%" cy="22%" r="72%"><stop offset="0" stop-color="#1c252d"/><stop offset="1" stop-color="#000102"/></radialGradient>',
    `<filter id="glow" x="-50%" y="-80%" width="200%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="${glowColour}"/></filter></defs>`,
    '<g transform="translate(2 6.8) scale(0.96)">',
    '<path d="M50 0A50 49.5 0 0 1 100 49.5A46 40.5 0 0 1 54 90H46A46 40.5 0 0 1 0 49.5A50 49.5 0 0 1 50 0z" fill="url(#visor)"/>',
    `<g style="color:${eyeColour}" filter="url(#glow)">${place(29, art.eyes[0])}${place(71, art.eyes[1])}</g>`,
    "</g></svg>",
  ].join("");
}
