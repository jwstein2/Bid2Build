import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_RESEND_STEPS_S, codeRequestedText, resendCooldownS } from "@/lib/auth/config";
import { MARKETING_CONSENT_VERSION, recordMarketingConsent } from "@/lib/email/consent";
import { MARKETING_CONSENT_TEXT } from "@/lib/email/consent-copy";
import { emailStream, recipientDomain } from "@/lib/email/streams";

describe("resend back-off", () => {
  it("starts at 60 s and backs off, capped at the last step", () => {
    expect(resendCooldownS(1)).toBe(60);
    expect(resendCooldownS(2)).toBe(120);
    expect(resendCooldownS(3)).toBe(300);
    expect(resendCooldownS(4)).toBe(600);
    expect(resendCooldownS(20)).toBe(600);
    expect(resendCooldownS(0)).toBe(60);
    expect(EMAIL_RESEND_STEPS_S[0]).toBeGreaterThanOrEqual(60);
  });
});

describe("confirmation wording", () => {
  it("never claims the email was delivered", () => {
    const t = codeRequestedText("a@b.co", 6);
    expect(t).toContain("6-digit");
    expect(t).toContain("a@b.co");
    expect(t).not.toMatch(/\b(we sent|delivered|has arrived|in your inbox)\b/i);
  });
  it("sign-in dialog and checkout don't say 'We sent a … code'", () => {
    for (const f of ["src/components/auth/auth-dialog.tsx", "src/components/billing/checkout-flow.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/We sent a (new )?(\$\{[^}]+\}-digit )?code/);
    }
  });
});

describe("OTP templates", () => {
  for (const f of ["supabase/templates/magic-link.html", "supabase/templates/confirm-signup.html"]) {
    const html = readFileSync(f, "utf8");
    it(`${f} stays lightweight and transactional`, () => {
      expect(html).toContain("Your Built2Bid verification code");
      expect(html).toContain("{{ .Email }}");
      expect(html).not.toMatch(/https?:\/\//); // no links, fonts or pixels to fetch
      expect(html).not.toMatch(/unsubscribe|offer|discount|upgrade|newsletter/i);
      expect(Buffer.byteLength(html)).toBeLessThan(4000);
    });
    it(`${f} keeps the code apart from the brand name in previews and plain text`, () => {
      const body = html.replace(/<!--[\s\S]*?-->\s*/g, "");
      // The first thing in the body is the hidden preview line, so a notification never starts with "Built2Bid".
      expect(body.startsWith('<div style="display:none')).toBe(true);
      expect(body).toContain(">Use your 6-digit code to sign in securely to Built2Bid.</div>");
      expect(body).not.toMatch(/display:none[^>]*>[^<]*\{\{ \.Token \}\}/); // code stays out of the preview
      // The code sits alone in its own block, right after the label block.
      expect(body).toMatch(/verification code:<\/h1>\s*<p[^>]*>\{\{ \.Token \}\}<\/p>/);
      // The wordmark is a block of its own (not a bare inline span next to other text).
      expect(body).toMatch(/<p[^>]*>Built<span[^>]*>2<\/span>Bid<\/p>/);
    });
  }
  it("plain-text copy matches the HTML wording", () => {
    const txt = readFileSync("supabase/templates/verification-code.txt", "utf8");
    expect(txt).toContain("{{ .Token }}");
    expect(txt).toContain("Built2Bid will never ask you to share this code");
    // Real newlines and a blank line on each side of the code.
    expect(txt).toMatch(/Your Built2Bid verification code:\n\n\{\{ \.Token \}\}\n\n/);
  });
});

describe("email streams", () => {
  it("classifies by sender address", () => {
    expect(emailStream("Built2Bid Security <login@built2bid.org>")).toBe("auth");
    expect(emailStream("login@auth.built2bid.org")).toBe("auth");
    expect(emailStream('"James at Built2Bid" <james@built2bid.org>')).toBe("transactional");
    expect(emailStream("Acme via Built2Bid <updates@built2bid.org>")).toBe("project");
    expect(emailStream("Built2Bid <hello@built2bid.org>")).toBe("trial");
    expect(emailStream("someone@example.com")).toBe("other");
  });
  it("keeps only the recipient domain", () => {
    expect(recipientDomain(["Pat <Pat@Gmail.com>"])).toBe("gmail.com");
    expect(recipientDomain("x@outlook.com")).toBe("outlook.com");
    expect(recipientDomain([])).toBeNull();
  });
});

type Call = { table: string; op: string; payload: unknown };
function fakeDb(errors: Record<string, { code: string; message: string } | null> = {}) {
  const calls: Call[] = [];
  let n = 0;
  const db = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const i = n++;
          calls.push({ table, op: "update", payload });
          return { eq: async () => ({ error: errors[`update${i}`] ?? null }) };
        },
        async insert(payload: unknown) { calls.push({ table, op: "insert", payload }); return { error: errors.insert ?? null }; },
      };
    },
  };
  return { db: db as never, calls };
}

describe("marketing consent record", () => {
  it("stores source, version and server time on opt-in, plus an audit row", async () => {
    const { db, calls } = fakeDb();
    await recordMarketingConsent(db, "u1", { optIn: true, source: "signup_dialog", at: new Date("2026-11-17T00:00:00Z") });
    expect(calls[0].payload).toMatchObject({ marketing_opt_in: true, marketing_consent_source: "signup_dialog", marketing_consent_version: MARKETING_CONSENT_VERSION, marketing_opt_in_at: "2026-11-17T00:00:00.000Z" });
    expect(calls[1]).toMatchObject({ table: "marketing_consent_events", payload: { opted_in: true, notice_text: MARKETING_CONSENT_TEXT } });
  });
  it("opt-out clears consent and stamps the withdrawal", async () => {
    const { db, calls } = fakeDb();
    await recordMarketingConsent(db, "u1", { optIn: false, source: "unsubscribe_link" });
    expect(calls[0].payload).toMatchObject({ marketing_opt_in: false, marketing_opt_in_at: null });
    expect((calls[0].payload as Record<string, unknown>).marketing_opt_out_at).toBeTruthy();
  });
  it("falls back to the original columns before the SQL runs", async () => {
    const { db, calls } = fakeDb({ update0: { code: "PGRST204", message: "no column" }, insert: { code: "PGRST205", message: "no table" } });
    await recordMarketingConsent(db, "u1", { optIn: true, source: "account_settings" });
    expect(calls[1].payload).toEqual(expect.objectContaining({ marketing_opt_in: true }));
    expect(Object.keys(calls[1].payload as object)).toEqual(["marketing_opt_in", "marketing_opt_in_at"]);
  });
});

describe("consent stays separate from sign-in", () => {
  it("the checkbox is unchecked by default and sending a code never depends on it", () => {
    const src = readFileSync("src/components/auth/auth-dialog.tsx", "utf8");
    expect(src).toContain("useState(false);\n  // Codes requested");
    const send = src.slice(src.indexOf("async function sendEmail"), src.indexOf("async function verifyEmail"));
    expect(send).not.toMatch(/if \(!marketing\)|marketing \?.*signInWithOtp/);
  });
});
