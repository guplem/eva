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
