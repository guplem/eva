/**
 * The folders of a new vault, with what each one is for, in words for the person. Setup shows them
 * before it creates the vault. The web page imports this file, so it must stay free of Node modules.
 * The vault's `AGENTS.md` is the map for agents; a test keeps the two lists aligned.
 */
export interface VaultFolder {
  readonly path: string;
  readonly purpose: string;
}

export const vaultFolders: readonly VaultFolder[] = [
  { path: "Principles", purpose: "Your values, mantras and philosophy." },
  { path: "Methods", purpose: "Your own ways to do or decide things." },
  { path: "Toolbox", purpose: "Things to copy and use: commands, scripts, prompts and cheat sheets." },
  { path: "Library", purpose: "Explanations that you want to keep." },
  { path: "Life", purpose: "Your personal areas, such as home or health, and the basic facts about you." },
  { path: "Projects", purpose: "One folder for each project, with its notes and its code." },
  { path: ".eva", purpose: "Your rules and skills for Eva. Not notes: keep this folder." },
];

export const vaultFoldersHint =
  "To remove a folder or add one later, ask Eva. She also updates the map of the vault in AGENTS.md.";
