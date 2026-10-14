import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "coverage/", "reports/", ".stryker-tmp/", "*.config.js", ".dependency-cruiser.cjs"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "no-console": "error",
      eqeqeq: "error",
    },
  },
  {
    files: ["test/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
);
