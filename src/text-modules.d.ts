/** Bun imports a Markdown file `with { type: "text" }` as its text. */
declare module "*.md" {
  const text: string;
  export default text;
}

/** The vault template's `.gitignore`, imported the same way. */
declare module "*.gitignore" {
  const text: string;
  export default text;
}

/** An icon of the web UI, imported `with { type: "file" }`: Bun gives its path, also inside the executable. */
declare module "*.png" {
  const path: string;
  export default path;
}

declare module "*.svg" {
  const path: string;
  export default path;
}

/** The Windows tray script, imported `with { type: "text" }`. */
declare module "*.ps1" {
  const text: string;
  export default text;
}
