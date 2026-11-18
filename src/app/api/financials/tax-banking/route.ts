import { z } from "zod";
import { json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import { FinError, finAccess } from "@/lib/financials/server";
import { BankError, disconnect, finishLink, reconnect, reconnectLink, refresh, startLink } from "@/lib/tax-banking/bank/service";
import { STATE_CODES } from "@/lib/tax-banking/authorities";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { site } from "@/lib/site";
import { TWO_STEP_BANK_MESSAGE, TWO_STEP_REQUIRED } from "@/lib/auth/mfa";
import { bankProviderMode } from "@/lib/tax-banking/isolation";

export const runtime = "nodejs";

/**
 * V6.9 writes: tax setup, tax alerts, exemption certificates, read-only bank connections and the cash plan.
 * The book comes from the server; every RPC re-checks the capability (tb_can / fin_require) and the add-on. Bank
 * tokens are handled only inside src/lib/tax-banking/bank/service.ts and never returned. Nothing here moves money,
 * emails anyone, or switches on a paid provider.
 */
const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const state = z.string().length(2).toUpperCase().refine((s) => STATE_CODES.includes(s), "state");

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tax_profile_save"), p: z.object({
    primaryState: state.nullable().optional(), serviceStates: z.array(state).max(51).optional(),
    address: z.object({ line1: text(200).optional(), city: text(100).optional(), state: text(2).optional(), zip: z.string().regex(/^\d{5}(-\d{4})?$/).or(z.literal("")).optional() }).optional(),
    registrations: z.array(z.object({ state, registered: z.boolean(), note: text(120).optional() })).max(51).optional(),
    businessType: z.enum(["general_contractor", "subcontractor", "specialty_trade", "remodeler", "service", "other"]).nullable().optional(),
    workMix: z.enum(["residential", "commercial", "both"]).nullable().optional(), defaultContract: z.enum(["lump_sum", "time_and_materials", "cost_plus", "mixed"]).nullable().optional(),
    autoApplyRates: z.boolean().optional(), notifyImmediate: z.boolean().optional(), notifyQuarterly: z.boolean().optional(), notifyEmail: z.boolean().optional(),
  }) }),
  z.object({ action: z.literal("tax_exemption_save"), p: z.object({ id: id.optional(), status: z.literal("revoked").optional(), customerId: id.optional(), state: state.optional(),
    reason: z.enum(["resale", "government", "nonprofit", "religious", "agricultural", "manufacturing", "direct_pay", "other"]).optional(), certificateRef: z.string().regex(/^[A-Za-z0-9 .#…-]{0,40}$/).optional(),
    documentId: id.optional(), expiresOn: day.optional() }) }),
  z.object({ action: z.literal("tax_exemption_request"), customerId: id, states: z.array(state).min(1).max(51) }),
  z.object({ action: z.literal("tax_alert_act"), alertId: id, status: z.enum(["reviewed", "dismissed"]) }),
  z.object({ action: z.literal("bank_link_start") }),
  z.object({ action: z.literal("bank_link_finish"), publicToken: z.string().min(8).max(300) }),
  z.object({ action: z.literal("bank_refresh"), connectionId: id }),
  z.object({ action: z.literal("bank_reconnect_start"), connectionId: id }),
  z.object({ action: z.literal("bank_reconnect"), connectionId: id }),
  z.object({ action: z.literal("bank_set_primary"), accountId: id }),
  z.object({ action: z.literal("bank_disconnect"), connectionId: id, reason: text(300).optional() }),
  z.object({ action: z.literal("cash_event_save"), p: z.object({ id: id.optional(), status: z.enum(["active", "cancelled", "done"]).optional(),
    kind: z.enum(["payroll", "recurring_expense", "expected_deposit", "supplier_payment", "sub_payment", "transfer", "other_inflow", "other_outflow"]).optional(),
    label: text(200).optional(), amount: amount.optional(), expectedOn: day.optional(), recurrence: z.enum(["none", "weekly", "biweekly", "monthly"]).optional(), recurUntil: day.optional(),
    certainty: z.enum(["scheduled", "expected"]).optional(), accountId: id.optional(), toAccountId: id.optional(), invoiceId: id.optional(),
    settlement: z.enum(["initiated", "processing", "estimated_available", "settled", "failed", "returned"]).optional(), note: text(500).optional() }) }),
]);

export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-tax-banking", limit: 120 });
  if ("error" in g) return g.error;
  const { db, bookId, user } = g;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "invalid", message: "Check the details and try again." } }, { status: 400 });
  const a = parsed.data;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new FinError(error.message, error.message, error.details ?? undefined);
    return data;
  };
  try {
    const sandbox = Boolean((await finAccess(db, bookId))?.sandbox);
    // Connecting or reconnecting a real bank needs a two-step (aal2) session. The token was verified by finGuard.
    if (!sandbox && ["bank_link_start", "bank_link_finish", "bank_reconnect_start", "bank_reconnect"].includes(a.action) && bankProviderMode(process.env) !== "none") {
      const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level?.currentLevel !== "aal2") return Response.json({ error: { code: TWO_STEP_REQUIRED, message: TWO_STEP_BANK_MESSAGE } }, { status: 403 });
    }
    switch (a.action) {
      case "tax_profile_save": await rpc("fin_tax_profile_save", { p_book_id: bookId, p: a.p }); return json({ ok: true });
      case "tax_exemption_save": return json({ id: await rpc("fin_tax_exemption_save", { p_book_id: bookId, p: a.p }) });
      case "tax_exemption_request": {
        // A secret link the customer opens to fill in and sign their exemption certificate. Only its hash is stored.
        const token = newSigningToken();
        await rpc("fin_tax_exemption_request_create", { p_book_id: bookId, p: { customerId: a.customerId, states: a.states, tokenHash: hashSigningToken(token) } });
        return json({ url: `${site.url}/exempt/${token}` });
      }
      case "tax_alert_act": await rpc("fin_tax_alert_act", { p_alert_id: a.alertId, p_status: a.status }); return json({ ok: true });
      case "bank_link_start": return json(await startLink(db, bookId, user.id, sandbox));
      case "bank_link_finish": return json(await finishLink(db, bookId, sandbox, a.publicToken));
      case "bank_refresh": return json(await refresh(db, a.connectionId, sandbox));
      case "bank_reconnect_start": return json(await reconnectLink(db, a.connectionId, user.id, sandbox));
      case "bank_reconnect": return json(await reconnect(db, a.connectionId, sandbox));
      case "bank_set_primary": await rpc("fin_bank_set_primary", { p_account_id: a.accountId }); return json({ ok: true });
      case "bank_disconnect": await disconnect(db, a.connectionId, a.reason ?? null, sandbox); return json({ ok: true });
      case "cash_event_save": return json({ id: await rpc("fin_cash_event_save", { p_book_id: bookId, p: a.p }) });
    }
  } catch (e) {
    if (e instanceof BankError) return finFail(new FinError(e.code, e.code), `tax-banking.${a.action}`);
    return finFail(e, `tax-banking.${a.action}`);
  }
}
