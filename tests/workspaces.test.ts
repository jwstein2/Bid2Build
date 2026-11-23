import { describe, expect, it } from "vitest";
import { landingPath, NO_WORKSPACES, parseSwitchTo, salesHubPath, switchLinks, switchTarget, type Workspaces } from "@/lib/workspaces";
import { DEFAULT_LANDING, needsFullLoad, safeNext } from "@/lib/http/redirect";
import { inviteTokenFromPath, safeSalesNext, salesLoginRedirect } from "@/lib/sales/next";

const w = (p: Partial<Workspaces>): Workspaces => ({ ...NO_WORKSPACES, ...p });
const customer = w({ contractor: true });
const rep = w({ sales_my: true });
const salesAdmin = w({ sales_admin: true });
const dual = w({ sales_my: true, sales_admin: true });
const everything = w({ sales_my: true, sales_admin: true, contractor: true });
const TOKEN = "a".repeat(43);

describe("landing after sign-in (V8.9)", () => {
  it("sends a sales-only rep to My Sales Hub, never the contractor dashboard", () => {
    expect(landingPath(rep)).toBe("/sales");
    expect(landingPath(salesAdmin)).toBe("/sales/admin");
  });
  it("keeps customers on the contractor dashboard (11. no sales invite)", () => {
    expect(landingPath(customer)).toBe("/dashboard");
    expect(landingPath(NO_WORKSPACES)).toBe("/dashboard");
  });
  it("finishes a pending invite first, whoever the person is", () => {
    for (const x of [customer, rep, NO_WORKSPACES]) expect(landingPath(x, { pendingInvite: true })).toBe("/sales/join");
  });
  it("sends a selling rep who also has a contractor account to the Sales Hub", () => {
    const repAndContractor = w({ sales_my: true, contractor: true });
    expect(landingPath(repAndContractor)).toBe("/sales");
    expect(landingPath({ ...repAndContractor, last_workspace: "contractor" })).toBe("/sales");
    expect(landingPath(everything)).toBe("/sales");
    // Only an explicit choice in account settings keeps them on the contractor dashboard.
    expect(landingPath({ ...repAndContractor, landing: "contractor" })).toBe("/dashboard");
  });
  it("uses the preference, then the last workspace, for an owner or admin with both", () => {
    const adminAndContractor = w({ sales_admin: true, contractor: true });
    expect(landingPath(adminAndContractor)).toBe("/dashboard");
    expect(landingPath({ ...adminAndContractor, last_workspace: "sales" })).toBe("/sales/admin");
    expect(landingPath({ ...everything, last_workspace: "sales" })).toBe("/sales");
    expect(landingPath({ ...everything, last_workspace: "sales", sales_view: "admin" })).toBe("/sales/admin");
    expect(landingPath({ ...everything, landing: "contractor", last_workspace: "sales" })).toBe("/dashboard");
    expect(landingPath({ ...everything, landing: "sales" })).toBe("/sales");
  });
  it("falls back when a preferred workspace was revoked", () => {
    expect(landingPath({ ...customer, landing: "sales", last_workspace: "sales" })).toBe("/dashboard");
    expect(landingPath({ ...rep, landing: "contractor" })).toBe("/sales");
  });
  it("defaults every sign-in with no destination to the landing route", () => {
    expect(safeNext(null)).toBe(DEFAULT_LANDING);
    expect(safeNext("//evil.com")).toBe(DEFAULT_LANDING);
    expect(safeNext("/projects/1")).toBe("/projects/1");
    expect(needsFullLoad(DEFAULT_LANDING)).toBe(true);
    expect(needsFullLoad(`/sales/join?t=${TOKEN}`)).toBe(true);
    expect(needsFullLoad("/switch?to=sales")).toBe(true);
    expect(needsFullLoad("/sales?welcome=1")).toBe(false);
  });
});

describe("sales invite identity through sign-in", () => {
  it("recognises only well-formed invite links", () => {
    expect(inviteTokenFromPath(`/sales/invite/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromPath(`/sales/invite/${TOKEN}/`)).toBe(TOKEN);
    expect(inviteTokenFromPath("/sales/invite/short")).toBeNull();
    expect(inviteTokenFromPath(`/sales/invites/${TOKEN}`)).toBeNull();
  });
  it("brings a signed-out /sales/join visit back with its token after sign-in", () => {
    const back = salesLoginRedirect("/sales/join", `?t=${TOKEN}`);
    expect(back).toBe(`/sales/login?next=${encodeURIComponent(`/sales/join?t=${TOKEN}`)}`);
    expect(safeSalesNext(`/sales/join?t=${TOKEN}`)).toBe(`/sales/join?t=${TOKEN}`);
    // The public invite page itself is never a return path.
    expect(safeSalesNext(`/sales/invite/${TOKEN}`)).toBe("/sales");
  });
});

describe("workspace switching (V8.10)", () => {
  it("shows Switch to Sales Hub only to sales reps and admins", () => {
    expect(switchLinks(customer, "contractor")).toEqual([]);
    expect(switchLinks(rep, "contractor").map((l) => l.label)).toEqual(["Switch to Sales Hub"]);
    expect(switchLinks(salesAdmin, "contractor")).toHaveLength(1);
  });
  it("shows Switch to Contractor Dashboard only to people who use it", () => {
    expect(switchLinks(rep, "sales")).toEqual([]);
    expect(switchLinks(everything, "sales").map((l) => l.label)).toEqual(["Switch to Contractor Dashboard"]);
  });
  it("opens the right hub and remembers it", () => {
    expect(switchTarget(rep, "sales")).toEqual({ path: "/sales", remember: { last: "sales", view: "my" } });
    expect(switchTarget(salesAdmin, "sales")).toEqual({ path: "/sales/admin", remember: { last: "sales", view: "admin" } });
    expect(switchTarget({ ...dual, sales_view: "admin" }, "sales").path).toBe("/sales/admin");
    expect(switchTarget(dual, "sales-admin").path).toBe("/sales/admin");
    expect(switchTarget(dual, "sales-my").path).toBe("/sales");
    expect(switchTarget(everything, "contractor")).toEqual({ path: "/dashboard", remember: { last: "contractor" } });
  });
  it("never opens a hub the person lost (role revoked after the menu was drawn)", () => {
    expect(switchTarget(customer, "sales")).toEqual({ path: "/dashboard", remember: {} });
    expect(switchTarget(rep, "sales-admin").path).toBe("/sales");
    expect(switchTarget(salesAdmin, "sales-my").path).toBe("/sales/admin");
    expect(salesHubPath(customer)).toBeNull();
  });
  it("parses only known switch targets", () => {
    expect(parseSwitchTo("sales-admin")).toBe("sales-admin");
    expect(parseSwitchTo("admin")).toBeNull();
    expect(parseSwitchTo(null)).toBeNull();
  });
  it("sends contractors to Home when it is the contractor start page", () => {
    expect(landingPath(customer, { contractorHome: "/home" })).toBe("/home");
    expect(landingPath(NO_WORKSPACES, { contractorHome: "/home" })).toBe("/home");
    expect(landingPath(w({ sales_admin: true, contractor: true }), { contractorHome: "/home" })).toBe("/home");
    expect(landingPath(rep, { contractorHome: "/home" })).toBe("/sales");
    expect(landingPath(customer, { pendingInvite: true, contractorHome: "/home" })).toBe("/sales/join");
    expect(switchTarget(everything, "contractor", null, "/home").path).toBe("/home");
  });
});
