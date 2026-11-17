import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const capture = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: capture }));
const opts = { enabled: true };
vi.mock("@/lib/monitoring/sentry-options", () => ({ sentryOptions: opts }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("handled errors reach Sentry", () => {
  beforeEach(() => { capture.mockClear(); vi.resetModules(); opts.enabled = true; });

  it("sends scope, code and id-only meta with emails masked", async () => {
    const { reportHandledError } = await import("@/lib/monitoring/report-server");
    reportHandledError("stripe.webhook", 'duplicate key (email)=(pat@example.com)', "23505", { event: "evt_1" });
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    const [msg, ctx] = capture.mock.calls[0];
    expect(msg).toBe("stripe.webhook: 23505");
    expect(ctx.tags).toMatchObject({ scope: "stripe.webhook", area: "stripe", code: "23505" });
    expect(ctx.extra.message).not.toContain("pat@example.com");
    expect(ctx.extra.event).toBe("evt_1");
  });

  it("caps each scope per minute so a loop can't burn the free plan", async () => {
    const { reportHandledError } = await import("@/lib/monitoring/report-server");
    for (let i = 0; i < 25; i++) reportHandledError("email.send", "boom", undefined, {});
    reportHandledError("stripe.checkout", "boom", undefined, {});
    await flush();
    expect(capture.mock.calls.filter((c) => c[0].startsWith("email.send")).length).toBe(10);
    expect(capture.mock.calls.filter((c) => c[0].startsWith("stripe.checkout")).length).toBe(1);
  });

  it("does nothing without a DSN", async () => {
    opts.enabled = false;
    const { reportHandledError } = await import("@/lib/monitoring/report-server");
    reportHandledError("stripe.webhook", "x", undefined, {});
    await flush();
    expect(capture).not.toHaveBeenCalled();
  });

  it("logError forwards to Sentry", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/lib/http/api.ts"), "utf8");
    expect(src).toMatch(/reportHandledError\(scope/);
  });
});

describe("scheduled functions surface failures", () => {
  const dir = path.resolve(import.meta.dirname, "../netlify/functions");
  it.each(fs.readdirSync(dir).filter((f) => f.endsWith(".mts")))("%s uses runCron (no silent 200 on failure)", (f) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    expect(src).toMatch(/runCron\(/);
    expect(src).not.toMatch(/status: 200 \}\);\s*\}\s*$/m);
  });

  it.each(fs.readdirSync(dir).filter((f) => f.endsWith(".mts")))("%s has no cross-file import (Netlify bundles each function alone)", (f) => {
    expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toMatch(/^import .* from "\.\.?\//m);
  });

  it("comms cron answers 502 and logs when the route fails, and pings the heartbeat on success", async () => {
    const fn = "../netlify/functions/comms-cron.mts"; // a variable path: tsc rejects .mts specifiers, vitest loads it fine
    const { default: commsCron } = (await import(/* @vite-ignore */ fn)) as { default: () => Promise<Response> };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    Object.assign(process.env, { EMAIL_OUTBOX_SECRET: "s", URL: "https://built2bid.org", COMM_EMAIL_MODE: "test", CRON_HEARTBEAT_COMMS: "https://hb.example/comms" });
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) => { calls.push(String(u)); return new Response("nope", { status: String(u).includes("/api/") ? 500 : 200 }); }));
    const bad = await commsCron();
    expect(bad.status).toBe(502);
    expect(err).toHaveBeenCalled();
    expect(calls).not.toContain("https://hb.example/comms");
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }));
    const good = await commsCron();
    expect(good.status).toBe(200);
    expect(calls).toContain("https://hb.example/comms");
    vi.unstubAllGlobals(); err.mockRestore();
    for (const k of ["EMAIL_OUTBOX_SECRET", "URL", "COMM_EMAIL_MODE", "CRON_HEARTBEAT_COMMS"]) delete process.env[k];
  });
});

describe("notification bell polling", () => {
  it("stops after a 401 and skips hidden tabs", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/operations/notification-bell.tsx"), "utf8");
    expect(src).toMatch(/status === 401\) signedOut\.current = true/);
    expect(src).toMatch(/signedOut\.current \|\| document\.hidden\) return/);
  });
});
