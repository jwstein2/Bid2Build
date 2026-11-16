import { defineConfig } from "vitest/config";
import path from "node:path";

// Runs scripts/growth/*.gen.ts(x) (sample proposals, lifecycle email previews): npx vitest run -c scripts/growth/vitest.samples.mts
const root = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": path.join(root, "src"), "server-only": path.join(root, "tests/stubs/server-only.ts") } },
  test: { include: ["scripts/growth/*.gen.tsx", "scripts/growth/*.gen.ts"], environment: "node", testTimeout: 120000 },
});
