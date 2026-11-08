// Lint do monorepo. Regra do GDD v0.3 §13.3: Math.random é proibido na simulação (use o PRNG com semente).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "packages/shared/generated/**", "prototype/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["packages/sim/src/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Proibido na simulação: use nextRandom() de rng.ts (GDD v0.3 §13.3)." }],
      "no-restricted-globals": ["error", { name: "Date", message: "A simulação não lê o relógio real." }, { name: "performance", message: "A simulação não lê o relógio real." }],
    },
  },
);
