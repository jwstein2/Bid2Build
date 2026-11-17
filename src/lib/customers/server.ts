import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPmEnabled } from "@/lib/env";
import { isEsignEnabled } from "@/lib/esign/config";
import { isStage } from "@/lib/pipeline/board";
import { signingByEstimate, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { loadCommAccess } from "@/lib/comms/server";
import type { CommAccess } from "@/lib/comms/types";
import { summarize, type CustomerSummary, type HubBid, type HubComm, type HubCustomerRow, type HubProject } from "./hub";

type Row = Record<string, unknown>;
const chunk = <T,>(xs: T[], n = 300) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function mapCustomer(r: Row): HubCustomerRow {
  return {
    id: String(r.id), userId: String(r.user_id), companyId: (r.company_id as string) ?? null,
    name: String(r.name ?? ""), email: (r.email as string) || null, phone: (r.phone as string) || null, address: (r.project_address as string) || null, notes: (r.notes as string) || null,
    customerType: r.customer_type === "business" ? "business" : "person", companyName: (r.company_name as string) || null,
    source: r.source === "bid" || r.source === "backfill" ? r.source : "manual",
    createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? r.created_at ?? ""),
  };
}

const EST_COLS = "id, user_id, customer_id, title, estimate_number, trades, status, pipeline_stage, created_at, updated_at, stage_changed_at, won_at, lost_reason";

export interface HubData {
  summaries: CustomerSummary[];
  customers: HubCustomerRow[];
  access: CommAccess | null;
  pm: boolean;
  /** Bids with a customer name that are not linked to a record yet (the database update has not run). */
  unlinkedBids: number;
}

/**
 * Every customer the viewer may read (RLS decides: own records, company records they can see, and
 * customers of bids they can see), with their linked bids, projects and communication facts.
 */
export async function loadCustomerHub(supabase: SupabaseClient, userId: string, opts: { customerId?: string } = {}): Promise<HubData> {
  let cq = supabase.from("customers").select("*").order("name").limit(2000);
  if (opts.customerId) cq = cq.eq("id", opts.customerId);
  const [{ data: custRows }, access] = await Promise.all([cq, loadCommAccess(supabase)]);
  const customers = ((custRows ?? []) as Row[]).map(mapCustomer);
  const ids = customers.map((c) => c.id);

  const estRows: Row[] = [];
  for (const part of chunk(ids)) {
    const { data } = await supabase.from("estimates").select(EST_COLS).in("customer_id", part).order("updated_at", { ascending: false }).limit(5000);
    estRows.push(...((data ?? []) as Row[]));
  }
  const estIds = estRows.map((e) => String(e.id));
  const esign = isEsignEnabled();
  const pmOn = isPmEnabled();
  const versions: Row[] = [], reqs: Row[] = [], sigs: Row[] = [], scheds: Row[] = [];
  for (const part of chunk(estIds)) {
    const [v, r, s, p] = await Promise.all([
      supabase.from("estimate_versions").select("id, estimate_id, version_number, total, subtotal, total_cost").in("estimate_id", part).order("version_number", { ascending: false }),
      esign ? supabase.from("signing_requests").select("id, estimate_id, version_id, status, expires_at, created_at, revoke_reason, signed_at").in("estimate_id", part) : Promise.resolve({ data: [] }),
      esign ? supabase.from("signatures").select("id, estimate_id, version_id, version_number, total, signed_at, signer_name, pdf_status").in("estimate_id", part) : Promise.resolve({ data: [] }),
      pmOn ? supabase.from("project_schedules").select("id, estimate_id, name, status, start_date, updated_at").in("estimate_id", part) : Promise.resolve({ data: [] }),
    ]);
    versions.push(...((v.data ?? []) as Row[])); reqs.push(...((r.data ?? []) as Row[])); sigs.push(...((s.data ?? []) as Row[])); scheds.push(...((p.data ?? []) as Row[]));
  }
  const latest = new Map<string, Row>();
  for (const v of versions) if (!latest.has(String(v.estimate_id))) latest.set(String(v.estimate_id), v);
  const signing = signingByEstimate(reqs as unknown as RequestRow[], sigs as unknown as SignatureRow[]);

  const bidsBy = new Map<string, HubBid[]>();
  for (const e of estRows) {
    const id = String(e.id), own = e.user_id === userId, v = latest.get(id);
    const bid: HubBid = {
      id, customerId: String(e.customer_id), own, href: own ? `/estimates/${id}` : `/company/bids/${id}`,
      title: String(e.title || "Untitled bid"), customer: "", number: String(e.estimate_number ?? ""), trades: (e.trades as string[]) ?? [],
      status: (e.status as HubBid["status"]) ?? "draft", stage: isStage(e.pipeline_stage) ? e.pipeline_stage : "draft",
      createdAt: String(e.created_at ?? e.updated_at), updatedAt: String(e.updated_at), stageChangedAt: (e.stage_changed_at as string) ?? null,
      wonAt: (e.won_at as string) ?? null, lostReason: (e.lost_reason as string) ?? null,
      latestVersion: v ? { id: String(v.id), number: Number(v.version_number), total: Number(v.total), subtotal: v.subtotal == null ? null : Number(v.subtotal), cost: v.total_cost == null ? null : Number(v.total_cost) } : null,
      signing: esign ? signing.get(id) ?? { state: "none", signed: null, latest: null } : null,
    };
    bidsBy.set(bid.customerId, [...(bidsBy.get(bid.customerId) ?? []), bid]);
  }
  const estCustomer = new Map(estRows.map((e) => [String(e.id), String(e.customer_id)]));
  const projBy = new Map<string, HubProject[]>();
  for (const s of scheds) {
    const cid = estCustomer.get(String(s.estimate_id));
    if (!cid) continue;
    const p: HubProject = { id: String(s.id), estimateId: String(s.estimate_id), name: String(s.name), status: s.status as HubProject["status"], startDate: String(s.start_date), updatedAt: String(s.updated_at) };
    projBy.set(cid, [...(projBy.get(cid) ?? []), p]);
  }

  // Communication facts (Project Command Center + permission only; read under RLS).
  const pm = Boolean(access?.pm && access.accountId && access.perms.includes("view_communications"));
  const commBy = new Map<string, HubComm>();
  if (pm && ids.length) {
    const emailToCustomer = new Map<string, string>();
    for (const c of customers) if (c.email) emailToCustomer.set(c.email.trim().toLowerCase(), c.id);
    const [{ data: contacts }, { data: msgs }] = await Promise.all([
      supabase.from("comm_contacts").select("email, customer_id, status, last_reply_at").eq("account_id", access!.accountId!).limit(5000),
      supabase.from("comm_messages").select("customer_id, to_email, status, sent_at").eq("account_id", access!.accountId!).order("created_at", { ascending: false }).limit(5000),
    ]);
    const get = (cid: string) => commBy.get(cid) ?? (commBy.set(cid, { status: null, lastReplyAt: null, lastSentAt: null, awaitingReview: 0 }), commBy.get(cid)!);
    for (const c of (contacts ?? []) as Row[]) {
      const cid = (c.customer_id as string) || emailToCustomer.get(String(c.email));
      if (!cid) continue;
      const x = get(cid); x.status = (c.status as string) ?? null; x.lastReplyAt = (c.last_reply_at as string) ?? null;
    }
    for (const m of (msgs ?? []) as Row[]) {
      const cid = (m.customer_id as string) || emailToCustomer.get(String(m.to_email ?? "").toLowerCase());
      if (!cid) continue;
      const x = get(cid);
      if (m.sent_at && (!x.lastSentAt || String(m.sent_at) > x.lastSentAt)) x.lastSentAt = String(m.sent_at);
      if (m.status === "awaiting_review") x.awaitingReview += 1;
    }
  }

  const summaries = customers.map((c) => summarize(c, bidsBy.get(c.id) ?? [], projBy.get(c.id) ?? [], commBy.get(c.id) ?? null, { esign, scheduling: pmOn }));

  // Until the database update runs, named bids have no customer record. Count them so the page can say so
  // instead of claiming there are no customers.
  let unlinkedBids = 0;
  if (!opts.customerId) {
    const { count } = await supabase.from("estimates").select("id", { count: "exact", head: true }).is("customer_id", null).neq("customer_name", "");
    unlinkedBids = count ?? 0;
  }
  return { summaries, customers, access, pm, unlinkedBids };
}
