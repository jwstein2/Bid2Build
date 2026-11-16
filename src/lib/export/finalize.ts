import "server-only";
import { createHash } from "node:crypto";
import { buildProposal } from "@/lib/proposal/build";
import { maybeActivate, recordEvent } from "@/lib/growth/events";
import { computeEstimate } from "@/lib/estimate/engine";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { renderProposalPdf, pdfFilename } from "@/lib/pdf/render";
import { loadBusiness, loadEstimate } from "@/lib/data/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { fail, logError } from "@/lib/http/api";
import { captureObservation } from "@/lib/market/server";
import type { CreditSource } from "@/lib/credits/status";
import { exportReadiness } from "@/lib/estimate/readiness";
import { fillLocationFromAddress } from "@/lib/geo/address";
import type { ProposalDocument } from "@/lib/proposal/types";
import type { Estimate } from "@/lib/estimate/types";
import { applyCompanyStyle } from "@/lib/operations/style-server";

export interface FinalizeResult {
  r: {
    version_id: string; version_number: number; new_version: boolean; charged: boolean; credit_source: CreditSource;
    starter_balance: number; monthly_balance: number; unlimited: boolean; next_cycle_at: string;
  };
  pdf: Buffer;
  /** SHA-256 of the exact PDF bytes. */
  pdfHash: string;
  /** Content hash of the frozen version snapshot. */
  hash: string;
  doc: ProposalDocument;
  estimate: Estimate;
  filename: string;
  storagePath: string;
  stored: boolean;
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/**
 * The one finalize path behind Download PDF, Send via My Email and Create Signing Link. Order matters:
 *  1. load data with the user's RLS-bound client (caller already authenticated + verified the user)
 *  2. readiness checks and PDF render (failures here never consume a credit)
 *  3. finalize_bid() atomically checks credits / idempotency, spends at most one credit per bid,
 *     and creates the version (an unchanged proposal maps to the existing version: never charged again)
 *  4. store the PDF privately
 * Returns a Response on refusal so routes can return it as-is.
 */
export async function finalizeProposal(userId: string, id: string, userCreatedAt?: string | null): Promise<FinalizeResult | Response> {
  const supabase = await createClient();
  const data = await loadEstimate(supabase, id);
  if (!data) return fail(404, "not_found", "Save your estimate before exporting.");
  const { business: ownBusiness } = await loadBusiness(supabase, userId, { signedLogo: false });
  const admin = createAdminClient();
  // V4.4: the company's proposal style (locks, template, branding) is applied here, on the server, for
  // every generated version. Presentation only: totals below come from the unchanged estimate.
  const styled = await applyCompanyStyle({ supabase, admin, estimateId: id, estimate: data.estimate, business: ownBusiness, config: data.proposalConfig });
  const { estimate, config: proposalConfig, business } = styled;

  const totals = computeEstimate(estimate);
  if (totals.issues.length) return fail(422, "invalid_estimate", "Fix the highlighted entries before exporting.", { issues: totals.issues.slice(0, 5) });
  if (!estimate.items.length) return fail(422, "empty_estimate", "Add at least one line item before exporting.");
  // The same readiness check the builder runs, so a proposal with missing required details
  // never reaches finalize_bid and never consumes a bid credit.
  const missing = exportReadiness(estimate, business, totals);
  if (missing.length) return fail(422, "not_ready", missing[0].message, { missing: missing.map(({ code, step, fieldId, message }) => ({ code, step, fieldId, message })) });

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
    logError("pdf.render", e, { user: userId });
    await admin.from("pdf_errors").insert({ user_id: userId, estimate_id: id, error: String((e as Error).message).slice(0, 500) });
    return fail(500, "pdf_failed", "We could not create the PDF. No bid credit was used. Please try again.");
  }

  const { data: rec, error } = await admin.rpc("finalize_bid", {
    p_user_id: userId,
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
    logError("export.record", error, { user: userId });
    return fail(500, "export_failed", "Export failed. Please try again.");
  }
  const r = (Array.isArray(rec) ? rec[0] : rec) as FinalizeResult["r"];

  const storagePath = `${userId}/${id}/v${r.version_number}-${hash.slice(0, 12)}.pdf`;
  const up = await admin.storage.from("documents").upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    logError("export.upload", up.error, { user: userId });
    await admin.from("pdf_errors").insert({ user_id: userId, estimate_id: id, error: `upload: ${up.error.message}`.slice(0, 500) });
  } else {
    await admin.from("generated_documents").upsert({ version_id: r.version_id, user_id: userId, storage_path: storagePath, bytes: pdf.length }, { onConflict: "version_id" });
  }

  // Market intelligence: one de-identified observation per finalized version, only with opt-in consent.
  // Bids saved before address parsing existed may only have a typed address: derive the location for it.
  const located = { ...estimate, location: fillLocationFromAddress(estimate.location, estimate.customer.projectAddress) };
  await captureObservation(admin, userId, r.version_id, located, totals);
  if (r.new_version) {
    // One event per finalized version (a re-download of the same version is not a new export).
    await recordEvent(admin, { userId, event: "export_succeeded", eventId: `export_succeeded:${r.version_id}`, trade: estimate.trades[0] ?? null, estimateId: id });
    await maybeActivate(admin, { id: userId, createdAt: userCreatedAt }, estimate.trades[0] ?? null);
  }

  return { r, pdf, pdfHash: sha256(pdf), hash, doc, estimate, filename: pdfFilename(doc, r.version_number), storagePath, stored: !up.error };
}
