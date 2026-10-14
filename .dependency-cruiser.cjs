/** Enforces the layers of docs/plan.md §4.2. */
module.exports = {
  forbidden: [
    {
      name: "shared-imports-nothing-of-ours",
      comment: "src/shared is the kernel: types, errors, seams. It never imports another layer.",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/(core|engines|frontends)/" },
    },
    {
      name: "core-imports-only-shared",
      comment: "The core never knows which engine or front end exists.",
      severity: "error",
      from: { path: "^src/core/" },
      to: { path: "^src/(engines|frontends)/" },
    },
    {
      name: "engines-import-only-shared",
      comment: "An engine adapter implements the engine port from src/shared and nothing else.",
      severity: "error",
      from: { path: "^src/engines/" },
      to: { path: "^src/(core|frontends)/" },
    },
    {
      name: "engines-stay-apart",
      comment: "One engine adapter never imports another.",
      severity: "error",
      from: { path: "^src/engines/([^/]+)/" },
      to: { path: "^src/engines/", pathNot: "^src/engines/$1/" },
    },
    {
      name: "frontends-never-import-engines",
      comment: "A front end never names an engine (v1 ADR 0003).",
      severity: "error",
      from: { path: "^src/frontends/" },
      to: { path: "^src/engines/" },
    },
    {
      name: "only-main-wires",
      comment: "Only src/main.ts imports across every layer.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/main\\.ts$" },
      to: { path: "^src/main\\.ts$" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
