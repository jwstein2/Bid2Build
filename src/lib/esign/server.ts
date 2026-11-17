import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { renderProposalPdf } from "@/lib/pdf/render";
import { renderSignedPdf, type SignedPdfOptions } from "@/lib/pdf/signed-pdf";
import { isContractorSigningEnabled } from "./contractor/config";
import { formatCurrency } from "@/lib/estimate/money";
import type { ProposalDocument } from "@/lib/proposal/types";
import { logError } from "@/lib/http/api";
import { sha256 } from "@/lib/export/finalize";
import { hashSigningToken, isSigningToken } from "./token";

/** Private storage path of the exact PDF a signing request shows (written once, never replaced). */
export const requestPdfPath = (userId: string, estimateId: string, requestId: string) => `${userId}/${estimateId}/signing/${requestId}.pdf`;
export const signedPdfPath = (userId: string, estimateId: string, signatureId: string) => `${userId}/${estimateId}/signed/${signatureId}.pdf`;

export interface PublicRequest {
  id: string;
  versionId: string;
  estimateId: string;
  userId: string;
  status: "pending" | "signed" | "revoked";
  expiresAt: string;
  createdAt: string;
  documentHash: string;
  contentHash: string;
  versionNumber: number;
  doc: ProposalDocument;
  logoPath: string | null;
  /** Derived: what the customer can do with this link right now. */
  phase: "open" | "signed" | "expired" | "revoked";
  signatureId: string | null;
}

/**
 * Look up a signing request by its secret token (service role: the customer has no account).
 * Returns only the customer-facing proposal of the frozen version, never the snapshot
 * (which holds internal costs and markups).
 */
export async function loadRequestByToken(admin: SupabaseClient, token: string): Promise<PublicRequest | null> {
  if (!isSigningToken(token)) return null;
  const { data: r } = await admin.from("signing_requests")
    .select("id, estimate_id, user_id, version_id, status, expires_at, created_at, document_hash, content_hash")
    .eq("token_hash", hashSigningToken(token)).maybeSingle();
  if (!r) return null;
  const [{ data: v }, { data: e }, { data: sig }] = await Promise.all([
    admin.from("estimate_versions").select("version_number, proposal, snapshot->business->>logoPath").eq("id", r.version_id).maybeSingle(),
    admin.from("estimates").select("status").eq("id", r.estimate_id).maybeSingle(),
    admin.from("signatures").select("id").eq("request_id", r.id).maybeSingle(),
  ]);
  if (!v || !e) return null;
  const expired = new Date(r.expires_at) <= new Date();
  const phase = r.status === "signed" ? "signed" : r.status === "revoked" || e.status === "archived" ? "revoked" : expired ? "expired" : "open";
  const row = v as unknown as { version_number: number; proposal: ProposalDocument; logoPath?: string | null };
  return {
    id: r.id, versionId: r.version_id, estimateId: r.estimate_id, userId: r.user_id, status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
    documentHash: r.document_hash, contentHash: r.content_hash, versionNumber: row.version_number, doc: row.proposal,
    logoPath: row.logoPath ?? null, phase, signatureId: sig?.id ?? null,
  };
}

export async function loadLogo(admin: SupabaseClient, logoPath: string | null): Promise<{ data: Buffer; format: "png" } | null> {
  if (!logoPath) return null;
  const { data: file } = await admin.storage.from("logos").download(logoPath);
  return file ? { data: Buffer.from(await file.arrayBuffer()), format: "png" } : null;
}

/** The PDF the customer reviews for a request: the stored copy, re-rendered only if the file is missing. */
export async function requestPdf(admin: SupabaseClient, req: PublicRequest): Promise<Buffer> {
  const { data: file } = await admin.storage.from("documents").download(requestPdfPath(req.userId, req.estimateId, req.id));
  if (file) return Buffer.from(await file.arrayBuffer());
  if (isContractorSigningEnabled()) {
    const { contractorPdfFor } = await import("./contractor/send");
    return contractorPdfFor(admin, req);
  }
  return renderProposalPdf(req.doc, await loadLogo(admin, req.logoPath));
}

/** Client IP and browser for the audit record (Netlify sets x-nf-client-connection-ip). */
export async function requestEvidence(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

/**
 * Render and store the signed copy. Never throws: acceptance is already committed, so a failure here
 * only marks the document as failed (retried on the next download) and never touches Signed status.
 */
export async function ensureSignedPdf(admin: SupabaseClient, signatureId: string): Promise<{ ok: true; path: string; filename: string } | { ok: false }> {
  try {
    const { data: s } = await admin.from("signatures").select("*").eq("id", signatureId).maybeSingle();
    if (!s) return { ok: false };
    const { data: v } = await admin.from("estimate_versions").select("proposal, snapshot->business->>logoPath").eq("id", s.version_id).maybeSingle();
    if (!v) return { ok: false };
    const doc = (v as unknown as { proposal: ProposalDocument }).proposal;
    const filename = signedFilename(doc, s.version_number);
    if (s.pdf_status === "ready" && s.pdf_path) return { ok: true, path: s.pdf_path, filename };
    const { data: req } = await admin.from("signing_requests").select("created_at").eq("id", s.request_id).maybeSingle();
    const image = s.method === "drawn" && s.signature_image ? Buffer.from(String(s.signature_image).split(",")[1] ?? "", "base64") : null;
    // V5.3: a contractor signature applied BEFORE the customer signed (contractor-first) is part of what
    // the customer signed, so it appears on their copy. A pending countersignature is stated plainly.
    let opts: SignedPdfOptions = {};
    if (isContractorSigningEnabled()) {
      const { executionFor, certificateFor } = await import("./contractor/server");
      const ex = await executionFor(admin, { request_id: s.request_id, version_id: s.version_id });
      if (ex.contractor && ex.contractor.applied_at <= s.signed_at) opts = { contractor: certificateFor(ex.contractor) };
      else if (ex.state === "awaiting_contractor") opts = { contractorPending: true };
    }
    const pdf = await renderSignedPdf(doc, await loadLogo(admin, (v as unknown as { logoPath?: string | null }).logoPath ?? null), {
      signatureId: s.id, requestId: s.request_id, signerName: s.signer_name, signerEmail: s.signer_email, method: s.method,
      signatureText: s.signature_text, signatureImage: image, signedAt: s.signed_at, consentedAt: s.consented_at,
      consentVersion: s.consent_version, consentText: s.consent_text, acceptanceText: s.acceptance_text, verification: s.verification,
      documentHash: s.document_hash, contentHash: s.content_hash, versionNumber: s.version_number, total: formatCurrency(String(s.total)),
      ipAddress: s.ip_address, userAgent: s.user_agent, linkCreatedAt: req?.created_at ?? s.signed_at,
    }, opts);
    const path = signedPdfPath(s.user_id, s.estimate_id, s.id);
    const up = await admin.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    await admin.rpc("record_signed_pdf", { p_signature_id: s.id, p_ok: true, p_path: path, p_hash: sha256(pdf), p_error: null });
    return { ok: true, path, filename };
  } catch (e) {
    logError("esign.signed_pdf", e, { signature: signatureId });
    await admin.rpc("record_signed_pdf", { p_signature_id: signatureId, p_ok: false, p_path: null, p_hash: null, p_error: String((e as Error).message ?? e).slice(0, 500) });
    return { ok: false };
  }
}

export function signedFilename(doc: ProposalDocument, version: number): string {
  const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "proposal";
  return `${slug(doc.brand.companyName)}_${slug(doc.meta.title)}_${slug(doc.meta.number)}_v${version}_SIGNED.pdf`;
}
