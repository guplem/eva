import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "test-results/", "playwright-report/", ".pskill/", ".agents/", ".claude/"] },
  js.configs.recommended,
  {
    files: ["main.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.js", "tests/**/*.js", "*.config.js"],
    // Playwright runs the callbacks of page.evaluate in the browser.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: { eqeqeq: "error", "no-var": "error", "prefer-const": "error" },
  },
];
