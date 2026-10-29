import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "src/generated/**", "node_modules/**", ".data/**", "test-results/**", "playwright-report/**"]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The domain engine is pure: no persistence, framework, or I/O imports.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/*", "@/app/*", "@/components/*", "@/worker/*", "@/generated/*", "next", "next/*", "react", "node:*", "fs", "path"], message: "src/domain must stay pure TypeScript." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/reporting/**/*.ts", "src/reporting/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/server/*", "@/app/*", "@/generated/*", "next", "next/*"], message: "Reporting templates render only snapshot data." }] }],
    },
  },
]);
