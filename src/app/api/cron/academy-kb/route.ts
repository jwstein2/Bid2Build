import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { compare, fingerprintText, planFor } from "@/lib/academy/kb/monitor";
import { CODEBOOK, codebookDrift, partKey, partUrl } from "@/lib/academy/kb/codebook";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA = "Built2Bid-Academy-SourceMonitor/1.0 (+https://built2bid.org/academy)";

/**
 * Academy knowledge engine monitoring (netlify/functions/academy-kb-cron.mts). Authorization: Bearer $EMAIL_OUTBOX_SECRET.
 *   ?phase=check       fingerprint up to 8 official sources not checked in 28 days; a change or a dead link opens a
 *                      review-queue item for an admin. No AI, no content edits.
 *   ?phase=semiannual  queue the six-month review of every source (deduplicated per half-year)
 *   ?phase=coverage    monthly 50-state + DC coverage audit (real test searches per state); results show in
 *                      Manage Academy → Codes → Coverage. Read-only apart from the run record. Also compares each
 *                      codebook part's latest eCFR amendment date with the snapshot and opens a review item when newer.
 * Does nothing until the knowledge-engine migration is applied (the RPCs are missing and the job answers "off").
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const db = createAdminClient();
  const phase = new URL(req.url).searchParams.get("phase");
  try {
    if (phase === "semiannual") {
      const { data, error } = await db.rpc("academy_kb_queue_semiannual");
      if (error) return json({ ok: true, off: true });
      return json({ ok: true, queued: data });
    }
    if (phase === "coverage") {
      const { data, error } = await db.rpc("academy_kb_run_coverage_audit", { p_trigger: "scheduled" });
      if (error) return json({ ok: true, off: true });
      const drift = await codebookCheck(db);
      return json({ ok: true, run: data, codebook: drift });
    }
    const { data: due, error } = await db.rpc("academy_kb_due_checks", { p_limit: 8 });
    if (error) return json({ ok: true, off: true });
    const out: { id: string; result: string }[] = [];
    for (const s of (due ?? []) as { id: string; check_url: string; content_hash: string | null }[]) {
      const plan = planFor(s.check_url);
      if (!plan) continue;
      let status = 0, body = "";
      try {
        const r = await fetch(plan.fetchUrl, { headers: { "user-agent": UA, accept: plan.kind === "ecfr" ? "application/json" : "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
        status = r.status;
        body = (await r.text()).slice(0, 2_000_000);
      } catch { status = 0; }
      const text = status >= 200 && status < 400 ? fingerprintText(plan, body) : null;
      const hash = text ? createHash("sha256").update(text).digest("hex") : null;
      const c = compare(plan, status, hash, s.content_hash);
      if (c.result === "baseline" || c.result === "reachable") {
        // First fingerprint (or a plain reachability check): remember it, but never count it as a verification.
        await db.from("academy_kb_sources").update({ content_hash: c.hash ?? s.content_hash, last_checked_at: new Date().toISOString() }).eq("id", s.id);
      } else {
        const { error: e } = await db.rpc("academy_kb_verify", {
          p_target_type: "source", p_target_id: s.id, p_method: c.method, p_result: c.result, p_source_url: s.check_url,
          p_content_hash: c.hash, p_http_status: status || null, p_change_kind: c.result === "changed" ? "unknown" : null,
          p_notes: c.result === "changed" ? "The official publication changed since the last check. Compare it with the stored sections and classify the change." : null,
        });
        if (e) logError("academy.kb.cron.verify", e);
      }
      out.push({ id: s.id, result: c.result });
    }
    return json({ ok: true, checked: out.length, results: out });
  } catch (e) {
    logError("academy.kb.cron", e);
    return fail(500, "server_error", "Source monitoring failed.");
  }
}

/** Latest amendment date per codebook part (eCFR versioner); a newer date than the snapshot opens one review item. */
async function codebookCheck(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const live: Record<string, string | null> = {};
  for (const p of CODEBOOK.parts) {
    try {
      const r = await fetch(`https://www.ecfr.gov/api/versioner/v1/versions/title-${p.title}.json?part=${p.part}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (!r.ok) continue;
      const v = (await r.json()) as { content_versions?: { amendment_date?: string }[] };
      live[partKey(p)] = (v.content_versions ?? []).map((x) => x.amendment_date ?? "").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
    } catch { /* unreachable this month; checked again next run */ }
  }
  const drift = codebookDrift(live);
  for (const d of drift) {
    const { error } = await db.from("academy_kb_review_queue").insert({
      kind: "source_change", priority: 3, target_type: "codebook", target_id: d.key, dedupe_key: `codebook:${d.key}:${d.live}`,
      title: `${d.part.title} CFR Part ${d.part.part} was amended ${d.live}`,
      detail: `The official eCFR shows an amendment newer than the codebook snapshot (${d.part.last_amended ?? "none"}). Review the change at ${partUrl(d.part)}, update any affected sections through the usual verification, then re-run scripts/academy/kb/gen_ecfr_structure.py.`,
    });
    if (error && error.code !== "23505") logError("academy.kb.cron.codebook", error);
  }
  return drift.length;
}

