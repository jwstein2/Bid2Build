import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The browser Sentry SDK (~79 KB gz) must stay out of first-load JS: client entry points may only
// reach it through the dynamic import in src/lib/monitoring/sentry-client.ts.
const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", p), "utf8");
const staticImport = /^\s*import[^;]*from\s+["']@sentry\/nextjs["']/m;

describe("lazy Sentry", () => {
  it.each(["src/instrumentation.ts", "src/instrumentation-client.ts", "src/app/error.tsx", "src/app/global-error.tsx", "src/lib/monitoring/sentry-client.ts"])(
    "%s has no static @sentry/nextjs import",
    (file) => expect(read(file)).not.toMatch(staticImport),
  );

  it("sentry-client loads the SDK with a dynamic import and buffers early errors", () => {
    const src = read("src/lib/monitoring/sentry-client.ts");
    expect(src).toMatch(/import\(\s*["']@sentry\/nextjs["']\s*\)/);
    expect(src).toMatch(/unhandledrejection/);
  });
});
