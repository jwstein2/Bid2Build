import { describe, expect, it } from "vitest";
import { checkEmails, checkMailDomain, emailDomain, type MailDns } from "@/lib/sales/email-check";

const err = (code: string) => Object.assign(new Error(code), { code });

/** Fake DNS: mx[domain] (or an error code), a[host] / aaaa[host] (or an error code). */
function fakeDns(mx: Record<string, { exchange: string; priority: number }[] | string>, a: Record<string, string[] | string>, aaaa: Record<string, string[] | string> = {}): MailDns {
  const look = <T,>(t: Record<string, T | string>, k: string): Promise<T> => {
    const v = t[k];
    if (v === undefined) return Promise.reject(err("ENOTFOUND"));
    return typeof v === "string" ? Promise.reject(err(v)) : Promise.resolve(v);
  };
  return { resolveMx: (d) => look(mx, d), resolve4: (h) => look(a, h), resolve6: (h) => look(aaaa, h) };
}

describe("checkMailDomain", () => {
  it("flags an MX that points at a host that doesn't exist (the decksbyryan.com bounce)", async () => {
    const dns = fakeDns({ "decksbyryan.com": [{ exchange: "mx.decksbyryan.com.cust.b.hostedemail.com", priority: 1 }] }, {});
    const r = await checkMailDomain("decksbyryan.com", dns);
    expect(r.status).toBe("undeliverable");
    expect(r.reason).toMatch(/doesn't exist/);
  });

  it("accepts a domain whose MX host resolves (IPv4 or IPv6 only)", async () => {
    expect((await checkMailDomain("good.com", fakeDns({ "good.com": [{ exchange: "mx.good.com", priority: 10 }] }, { "mx.good.com": ["1.2.3.4"] }))).status).toBe("ok");
    expect((await checkMailDomain("v6.com", fakeDns({ "v6.com": [{ exchange: "mx.v6.com", priority: 10 }] }, { "mx.v6.com": "ENODATA" }, { "mx.v6.com": ["::1"] }))).status).toBe("ok");
  });

  it("is ok when a backup MX works even if the first is dead", async () => {
    const dns = fakeDns({ "x.com": [{ exchange: "dead.x.com", priority: 1 }, { exchange: "live.x.com", priority: 5 }] }, { "live.x.com": ["5.6.7.8"] });
    expect((await checkMailDomain("x.com", dns)).status).toBe("ok");
  });

  it("flags no MX, a null MX, and a domain that doesn't exist", async () => {
    expect((await checkMailDomain("nomx.com", fakeDns({ "nomx.com": "ENODATA" }, {}))).status).toBe("undeliverable");
    expect((await checkMailDomain("null.com", fakeDns({ "null.com": [{ exchange: "", priority: 0 }] }, {}))).status).toBe("undeliverable");
    expect((await checkMailDomain("gone.com", fakeDns({}, {}))).status).toBe("undeliverable");
  });

  it("says unknown (not bad) when DNS itself fails", async () => {
    expect((await checkMailDomain("t.com", fakeDns({ "t.com": "ESERVFAIL" }, {}))).status).toBe("unknown");
    const dns = fakeDns({ "t2.com": [{ exchange: "mx.t2.com", priority: 1 }] }, { "mx.t2.com": "ETIMEOUT" }, { "mx.t2.com": "ETIMEOUT" });
    expect((await checkMailDomain("t2.com", dns)).status).toBe("unknown");
  });
});

describe("checkEmails", () => {
  it("checks each domain once and maps results back to every address", async () => {
    let calls = 0;
    const base = fakeDns({ "good.com": [{ exchange: "mx.good.com", priority: 1 }] }, { "mx.good.com": ["1.1.1.1"] });
    const dns: MailDns = { ...base, resolveMx: (d) => { calls++; return base.resolveMx(d); } };
    const r = await checkEmails(["A@good.com", "b@good.com", "c@gone.com", "not-an-email"], dns);
    expect(r.get("a@good.com")?.status).toBe("ok");
    expect(r.get("b@good.com")?.status).toBe("ok");
    expect(r.get("c@gone.com")?.status).toBe("undeliverable");
    expect(r.get("not-an-email")?.status).toBe("undeliverable");
    expect(calls).toBe(2);
  });

  it("parses domains", () => {
    expect(emailDomain("x@Sub.Example.COM.")).toBe("sub.example.com");
    expect(emailDomain("nope")).toBeNull();
  });
});
