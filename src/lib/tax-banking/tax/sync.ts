import "server-only";
/**
 * Daily tax update job (V6.9). Runs with the service role from /api/cron/tax-banking.
 *
 *   1. Ask the approved provider for the rates in every watched area (company addresses + recent job addresses) for
 *      today and the first day of the next three quarters (states change rates on quarter boundaries, so this catches
 *      announced future changes before they take effect).
 *   2. A rate that differs from the latest version on file becomes a tax_change_events row (source provider,
 *      verified). The database versions it and decides: verified numeric rate = scheduled/active automatically;
 *      anything else = needs_review. No code deploy needed for a rate change.
 *   3. Activate scheduled changes whose effective date arrived; fan alerts out to affected books (once each).
 *   4. On the first run of a quarter, write the quarterly digest.
 *   5. Check each official authority homepage still answers (marks reachable/unreachable; never "verified rates").
 * With no approved provider, the run is recorded as skipped and the UI shows the last verified update date.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TAX_AUTHORITIES } from "../authorities";
import { dec } from "../num";
import type { ProviderJurisdiction, TaxProvider } from "./types";

type Db = SupabaseClient;

export function upcomingCheckDates(today: Date): string[] {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const out = [d(today)];
  const q = Math.floor(today.getUTCMonth() / 3);
  for (let i = 1; i <= 3; i++) out.push(d(new Date(Date.UTC(today.getUTCFullYear(), (q + i) * 3, 1))));
  return out;
}

export interface WatchedArea { state: string; zip: string; city?: string | null; line1?: string | null }

/** Pure comparison: which provider rates differ from what is on file (exported for tests). */
export function detectChanges(area: WatchedArea, date: string, provider: ProviderJurisdiction[], onFile: Map<string, string | null>) {
  return provider.filter((j) => { const cur = onFile.get(j.code); return cur === undefined || cur === null || !dec(cur).eq(dec(j.rate)); })
    .map((j) => ({ state: area.state, jurisdictionCode: j.code, jurisdictionName: j.name, level: j.level, kind: "rate" as const,
      summary: `${j.name} rate ${onFile.get(j.code) ? "changes" : "recorded"}`, oldRate: onFile.get(j.code) ?? null, newRate: j.rate, effectiveDate: date }));
}

export async function runTaxSync(db: Db, provider: TaxProvider | null, opts: { now?: Date; fetchImpl?: typeof fetch; checkAuthorities?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const { data: run } = await db.from("tax_sync_runs").insert({ provider: provider?.name ?? "none", kind: "rates", status: "running" }).select("id").single();
  const runId = (run as { id: string } | null)?.id ?? null;
  const out = { runId, status: "ok" as "ok" | "failed" | "skipped", found: 0, applied: 0, review: 0, apiCalls: 0, activated: 0, alerts: 0, digests: 0, error: null as string | null };
  try {
    if (!provider) {
      out.status = "skipped"; out.error = "Tax rates are switched off (TAX_PROVIDER=none). Rates come from what each company enters.";
    } else if (provider.name === "builtin") {
      // The built-in engine's rates arrive through the hourly official-file import (importer.ts), not by polling.
      out.status = "skipped"; out.error = "Rates arrive through the hourly official-file import.";
    } else {
      const areas = await watchedAreas(db);
      for (const area of areas) {
        for (const date of upcomingCheckDates(now)) {
          let rates: ProviderJurisdiction[];
          try { rates = await provider.ratesFor({ state: area.state, zip: area.zip, city: area.city, line1: area.line1 }, date); out.apiCalls++; }
          catch (e) { throw new Error(`provider: ${(e as Error).message}`.slice(0, 300)); }
          const onFile = new Map<string, string | null>();
          for (const j of rates) {
            const { data } = await db.rpc("tax_rate_on", { p_state: area.state, p_code: j.code, p_date: date });
            onFile.set(j.code, data === null || data === undefined ? null : String(data));
          }
          for (const c of detectChanges(area, date, rates, onFile)) {
            const { data, error } = await db.rpc("tax_change_record", { p: { ...c, source: "provider", provider: provider.name, verified: true, sourcesAgree: true, syncRunId: runId,
              sourceUrl: TAX_AUTHORITIES.find((a) => a.state === area.state)?.website } });
            if (error) throw new Error(error.message);
            const r = data as { id: string; status: string; duplicate: boolean };
            if (r.duplicate) continue;
            out.found++;
            if (r.status === "needs_review") out.review++; else out.applied++;
            // A first-ever recording of a jurisdiction is a baseline, not a change worth alerting on.
            if (c.oldRate !== null) { const { data: n } = await db.rpc("tax_fanout_alerts", { p_change_id: r.id }); out.alerts += Number(n ?? 0); }
          }
        }
      }
    }
    const { data: act } = await db.rpc("tax_activate_due", { p_today: now.toISOString().slice(0, 10) });
    out.activated = Number(act ?? 0);
    // Review-needed changes recorded by hand (official-source monitoring) also reach the affected books.
    const { data: pending } = await db.from("tax_change_events").select("id").is("fanned_out_at", null).neq("status", "rejected").limit(200);
    for (const p of (pending ?? []) as { id: string }[]) { const { data: n } = await db.rpc("tax_fanout_alerts", { p_change_id: p.id }); out.alerts += Number(n ?? 0); }
    if (now.getUTCDate() <= 7 && now.getUTCMonth() % 3 === 0) {
      const prevQuarter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
      const { data: n } = await db.rpc("tax_quarterly_digest", { p_quarter: prevQuarter });
      out.digests = Number(n ?? 0);
    }
  } catch (e) {
    out.status = "failed"; out.error = (e as Error).message.slice(0, 500);
  }
  if (runId) await db.from("tax_sync_runs").update({ status: out.status, finished_at: new Date().toISOString(), error: out.error, changes_found: out.found,
    changes_applied: out.applied, changes_review: out.review, api_calls: out.apiCalls }).eq("id", runId);
  if (opts.checkAuthorities) await checkAuthorities(db, opts.fetchImpl ?? fetch, now);
  return out;
}

async function watchedAreas(db: Db): Promise<WatchedArea[]> {
  const seen = new Map<string, WatchedArea>();
  const { data: profiles } = await db.from("fin_tax_profiles").select("address").not("address", "is", null).limit(5000);
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  const { data: calcs } = await db.from("tax_calculations").select("address").gte("calculated_at", since).not("address", "is", null).limit(5000);
  for (const r of [...(profiles ?? []), ...(calcs ?? [])] as { address: { state?: string; zip?: string; city?: string; line1?: string } | null }[]) {
    const a = r.address; const zip = (a?.zip ?? "").slice(0, 5);
    if (!a?.state || !/^\d{5}$/.test(zip)) continue;
    const key = `${a.state.toUpperCase()}:${zip}`;
    if (!seen.has(key)) seen.set(key, { state: a.state.toUpperCase(), zip, city: a.city ?? null, line1: a.line1 ?? null });
  }
  return [...seen.values()].slice(0, 500);
}

async function checkAuthorities(db: Db, f: typeof fetch, now: Date) {
  const next = new Date(now.getTime() + 7 * 864e5).toISOString();
  for (const a of TAX_AUTHORITIES) {
    let ok = false;
    try { const r = await f(a.website, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) }); ok = r.status < 400; } catch { ok = false; }
    await db.from("tax_authorities").update({ source_status: ok ? "reachable" : "unreachable", last_checked_at: now.toISOString(), next_check_at: next,
      ...(ok ? { last_verified_at: now.toISOString() } : {}) }).eq("state", a.state);
  }
  await db.from("tax_sync_runs").insert({ provider: "official", kind: "authorities", status: "ok", finished_at: new Date().toISOString() });
}
