import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guards for the speed fixes in docs/performance/SPEED_V2_2026-11-17.md.
const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", p), "utf8");

describe("signed-in page speed guards", () => {
  it("signed-in and admin pages have a loading boundary (instant skeleton on click)", () => {
    for (const f of ["src/app/(app)/loading.tsx", "src/app/admin/loading.tsx"]) expect(read(f)).toMatch(/PageLoading/);
  });

  it("the Auth lookup is cached per request", () => {
    const src = read("src/lib/supabase/server.ts");
    expect(src).toMatch(/export const getAuthUser = cache\(/);
    expect(src).toMatch(/await getAuthUser\(\)/);
  });

  it("the app layout runs lead/referral bookkeeping after the response", () => {
    const src = read("src/app/(app)/layout.tsx");
    expect(src).toMatch(/after\(async \(\) => \{[\s\S]*syncSignedInUser/);
  });

  it("the dashboard issues its reads in one parallel batch and never calls auth.getUser directly", () => {
    const src = read("src/app/(app)/dashboard/page.tsx");
    expect(src).not.toMatch(/supabase\.auth\.getUser\(/);
    expect(src.match(/await Promise\.all\(/g)?.length ?? 0).toBeLessThanOrEqual(2); // main batch + checklist batch
    expect(src).not.toMatch(/await supabase\.rpc\(/);
  });
});
