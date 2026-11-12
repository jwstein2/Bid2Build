import { buildProposal } from "@/lib/proposal/build";
import { computeEstimate } from "@/lib/estimate/engine";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { renderProposalPdf, pdfFilename } from "@/lib/pdf/render";
import { loadBusiness, loadEstimate } from "@/lib/data/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import type { CreditSource } from "@/lib/credits/status";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Finalize + export. Order matters:
 *  1. authenticate (verified server-side) and load data with the user's RLS-bound client
 *  2. build the canonical proposal and render the PDF (failures here never consume a credit)
 *  3. finalize_bid() atomically checks credits / idempotency, spends at most one credit per bid,
 *     and creates the version (all-or-nothing in one database transaction)
 *  4. store the PDF privately and return a short-lived signed URL
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/estimates/[id]/export">) {
  const { id } = await ctx.params;
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("export", 20, 60_000))) return fail(429, "rate_limited", "Too many exports at once. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Create a free account to download your PDF.");
  if (!user.emailVerified) return fail(403, "email_not_verified", "Please verify your email address first.");

  const supabase = await createClient();
  const data = await loadEstimate(supabase, id);
  if (!data) return fail(404, "not_found", "Save your estimate before exporting.");
  const { business } = await loadBusiness(supabase, user.id, { signedLogo: false });
  const { estimate, proposalConfig } = data;

  const totals = computeEstimate(estimate);
  if (totals.issues.length) return fail(422, "invalid_estimate", "Fix the highlighted entries before exporting.", { issues: totals.issues.slice(0, 5) });
  if (!estimate.items.length) return fail(422, "empty_estimate", "Add at least one line item before exporting.");

  const admin = createAdminClient();
  let logo: { data: Buffer; format: "png" } | null = null;
  if (business.logoPath) {
    const { data: file } = await admin.storage.from("logos").download(business.logoPath);
    if (file) logo = { data: Buffer.from(await file.arrayBuffer()), format: "png" };
  }

  const doc = buildProposal(estimate, business, proposalConfig);
  const snapshot = versionSnapshot(estimate, business, proposalConfig);
  const hash = contentHash(snapshot);

  let pdf: Buffer;
  try {
    pdf = await renderProposalPdf(doc, logo);
  } catch (e) {
    logError("pdf.render", e, { user: user.id });
    await admin.from("pdf_errors").insert({ user_id: user.id, estimate_id: id, error: String((e as Error).message).slice(0, 500) });
    return fail(500, "pdf_failed", "We could not create the PDF. No bid credit was used. Please try again.");
  }

  const { data: rec, error } = await admin.rpc("finalize_bid", {
    p_user_id: user.id,
    p_estimate_id: id,
    p_content_hash: hash,
    p_snapshot: snapshot,
    p_proposal: doc,
    p_total_cost: totals.totalCost.toFixed(2),
    p_subtotal: totals.subtotal.toFixed(2),
    p_tax: totals.tax.toFixed(2),
    p_total: totals.total.toFixed(2),
  });
  if (error) {
    if (error.message.includes("credits_exhausted")) return fail(402, "credits_exhausted", "You've used your free bid credits. Your bid is saved.");
    if (error.message.includes("email_not_verified")) return fail(403, "email_not_verified", "Please verify your email address first.");
    if (error.message.includes("estimate_not_found")) return fail(404, "not_found", "Estimate not found.");
    logError("export.record", error, { user: user.id });
    return fail(500, "export_failed", "Export failed. Please try again.");
  }
  const r = (Array.isArray(rec) ? rec[0] : rec) as {
    version_id: string; version_number: number; new_version: boolean; charged: boolean; credit_source: CreditSource;
    starter_balance: number; monthly_balance: number; unlimited: boolean; next_cycle_at: string;
  };

  const path = `${user.id}/${id}/v${r.version_number}-${hash.slice(0, 12)}.pdf`;
  const up = await admin.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    logError("export.upload", up.error, { user: user.id });
    await admin.from("pdf_errors").insert({ user_id: user.id, estimate_id: id, error: `upload: ${up.error.message}`.slice(0, 500) });
  } else {
    await admin.from("generated_documents").upsert({ version_id: r.version_id, user_id: user.id, storage_path: path, bytes: pdf.length }, { onConflict: "version_id" });
  }

  const filename = pdfFilename(doc, r.version_number);
  let url: string | null = null;
  if (!up.error) {
    const { data: signed } = await admin.storage.from("documents").createSignedUrl(path, 300, { download: filename });
    url = signed?.signedUrl ?? null;
  }
  if (r.new_version) await admin.from("analytics_events").insert({ user_id: user.id, event: "export_succeeded", trade: estimate.trades[0] ?? null });

  return json({
    url,
    // Fallback: if storage failed, deliver the bytes directly so the user still gets their PDF.
    pdfBase64: url ? undefined : pdf.toString("base64"),
    filename,
    versionId: r.version_id,
    versionNumber: r.version_number,
    charged: r.charged,
    creditSource: r.credit_source,
    credits: { starter: r.starter_balance, monthly: r.monthly_balance, unlimited: r.unlimited, nextCycleAt: r.next_cycle_at },
  });
}
