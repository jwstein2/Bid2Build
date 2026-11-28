import { describe, expect, it } from "vitest";
import { registryChecks } from "./common";
import { workerDbUrl } from "../../../growth-os/worker/db";

// The live check (worker reads growth_read as growth_worker) runs in tests/db/growth-os-connections.test.ts.
describe("connector: Built2Bid Supabase (Growth OS database)", () => {
  const c = registryChecks("supabase");
  it("is internal: no OAuth, no manual secret; CRM writes are privileged and per-approval", () => {
    expect(c.authKinds).toEqual(["internal"]);
    expect(c.operations.find((o) => o.key === "crm.apply")).toMatchObject({ privileged: true });
  });
  it("connects as growth_worker, never as postgres or the service role", () => {
    const u = new URL(workerDbUrl((k) => ({ SUPABASE_DB_URL: "postgresql://postgres.nkpnfpxrvukfqwgbbwrs:pw@pooler:6543/postgres", GROWTH_DB_PASSWORD: "p@ss" } as Record<string, string>)[k]));
    expect(u.username).toBe("growth_worker.nkpnfpxrvukfqwgbbwrs");
    expect(decodeURIComponent(u.password)).toBe("p@ss");
    expect(() => workerDbUrl(() => undefined)).toThrow(/GROWTH_DB_PASSWORD/);
  });
});
