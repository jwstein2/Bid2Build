import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dev-only CommonJS screenshot script.
    "scripts/ux-screenshots.cjs",
    // Growth OS Edge Function entry point (Deno: npm: imports, Deno globals). Its logic lives in core.ts, which is linted.
    "growth-os/worker/index.ts",
    // Verbatim copy of the production social scheduler (Deno); versioned, not built here.
    "growth-os/legacy/**",
  ]),
]);

export default eslintConfig;
