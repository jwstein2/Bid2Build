import { describe, expect, it } from "vitest";
import { ageLabel, cleanFilters, csvToRows, filterQuery, lifecycle, listField, recycleCsv, untilLabel } from "@/lib/sales/leads-admin";
import { inviteEmailsOn, inviteText, sendInviteEmail } from "@/lib/sales/invite-email";

describe("V8.6 lead admin helpers", () => {
  it("keeps only known, well-formed filters", () => {
    expect(cleanFilters({ q: " roof ", state: "mn", stage: "demo", owner: "none", follow: "soon", dup: "seen_again", evil: "x", trade: "DROP TABLE" }))
      .toEqual({ q: "roof", state: "MN", stage: "demo", owner: "none", dup: "seen_again" });
    expect(filterQuery({ state: "MN" }, { confirm: "1" })).toBe("tab=leads&state=MN&confirm=1");
  });

  it("reads CSV files by header in any order, with quoted commas and trade lists", () => {
    const rows = csvToRows('Phone,Business Name,Email,Trades,ZIP\n612-555-0100,"Lee, Dana & Sons",d@lee.com,roofing;Siding,55901\n,,,,\n');
    expect(rows).toEqual([{ phone: "612-555-0100", company_name: "Lee, Dana & Sons", email: "d@lee.com", trades: ["roofing", "siding"], zip: "55901" }]);
    expect(csvToRows("Summit Roofing, Dana, dana@x.com")).toEqual([]); // no header: the caller falls back to paste order
  });

  it("names a rep's lifecycle from access plus the layers on top", () => {
    const base = { status: "active", linked: true, allocation_paused: false, reactivated_at: null };
    expect(lifecycle(base, false)).toBe("active");
    expect(lifecycle({ ...base, allocation_paused: true }, false)).toBe("paused");
    expect(lifecycle(base, true)).toBe("offboarding");
    expect(lifecycle({ ...base, status: "removed" }, false)).toBe("offboarded");
    expect(lifecycle({ ...base, status: "invited", linked: false }, false)).toBe("invited");
    expect(lifecycle({ ...base, reactivated_at: "2026-11-19" }, false)).toBe("reactivated");
    expect(lifecycle({ ...base, status: "suspended" }, false)).toBe("suspended");
  });

  it("parses territory and trade lists and ages", () => {
    expect(listField("mn, WI; xx1, Iowa", "state")).toEqual(["MN", "WI"]);
    expect(listField("Roofing, siding,roofing", "trade")).toEqual(["roofing", "siding"]);
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(ageLabel("2026-11-19T11:30:00Z", now)).toBe("under an hour");
    expect(ageLabel("2026-11-16T12:00:00Z", now)).toBe("3 days");
  });

  it("only emails invitations when switched on, with an idempotency key per invite", async () => {
    const env = { SALES_INVITE_EMAILS: "on", FOUNDER_EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test" };
    expect(inviteEmailsOn({ ...env, SALES_INVITE_EMAILS: undefined })).toBe(false);
    expect(inviteEmailsOn(env)).toBe(true);
    const off = await sendInviteEmail({ inviteId: "i1", to: "a@b.com", subject: "s", body: "b" }, { RESEND_API_KEY: "re_test" });
    expect(off.ok).toBe(false);
    let seen: RequestInit | undefined;
    const fake = (async (_u: string, init?: RequestInit) => { seen = init; return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }); }) as typeof fetch;
    const t = inviteText("Ana", "https://built2bid.org/sales/invite/abc", "December 3");
    expect(t.body).toContain("https://built2bid.org/sales/invite/abc");
    // The HTML version links the invite as a button.
    expect(t.html).toContain('<a href="https://built2bid.org/sales/invite/abc" target="_blank"');
    expect(t.html).toContain("Join the sales team");
    expect(inviteText("<b>", "https://x.test/?a=1&b=2", "Dec").html).toContain("&lt;b&gt;");
    const ok = await sendInviteEmail({ inviteId: "i1", to: "a@b.com", ...t }, env, fake);
    expect(ok).toEqual({ ok: true, id: "msg_1" });
    expect((seen?.headers as Record<string, string>)["idempotency-key"]).toBe("sales-invite/i1");
    expect(JSON.parse(String(seen?.body)).html).toContain("Join the sales team");
  });

  it("words recycling deadlines and exports formula-safe CSV", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(untilLabel("2026-11-20T12:00:00Z", now)).toBe("in 24 hours");
    expect(untilLabel("2026-11-26T12:00:00Z", now)).toBe("in 7 days");
    expect(untilLabel("2026-11-19T09:00:00Z", now)).toBe("3 hours overdue");
    const csv = recycleCsv([{ at: "2026-11-19", company_name: "=HYPERLINK(1)", reason: "first_contact", outcome: "reassigned", cycle: 1, from: "Ana", to: "Ben", note: "a, b" }]);
    expect(csv.split("\n")[1]).toBe(`2026-11-19,'=HYPERLINK(1),No first contact in time,Reassigned,1,Ana,Ben,"a, b"`);
  });
});
