/** Placeholder workspace names ("My company") must never reach signature wording. */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isPlaceholderCompanyName, signingTenant } from "@/lib/esign/contractor/server";

function fakeAdmin(company: { name: string; owner_user_id: string }, profileName: string | null) {
  const row = (table: string) => table === "company_members" ? { company_id: "c1", role: "owner" } : table === "companies" ? company : { company_name: profileName };
  const q = (table: string) => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: row(table) }) }; return b; };
  return { from: q, rpc: async () => ({ data: true }) } as never;
}

describe("signing company name", () => {
  it("flags the default workspace names", () => {
    expect(isPlaceholderCompanyName("My company")).toBe(true);
    expect(isPlaceholderCompanyName(" My Company ")).toBe(true);
    expect(isPlaceholderCompanyName("Jorenby Roofing")).toBe(false);
    expect(isPlaceholderCompanyName(null)).toBe(false);
  });
  it("uses the owner's business name instead of the placeholder", async () => {
    const t = await signingTenant(fakeAdmin({ name: "My company", owner_user_id: "u1" }, "Jorenby Roofing"), "u1");
    expect(t.companyName).toBe("Jorenby Roofing");
  });
  it("leaves the name unset when no real name exists", async () => {
    const t = await signingTenant(fakeAdmin({ name: "My Company", owner_user_id: "u1" }, ""), "u1");
    expect(t.companyName).toBeNull();
  });
  it("keeps a real company name", async () => {
    const t = await signingTenant(fakeAdmin({ name: "Acme Builders", owner_user_id: "u1" }, "Other"), "u2");
    expect(t.companyName).toBe("Acme Builders");
  });
});
