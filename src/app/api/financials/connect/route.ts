import { z } from "zod";
import { fail, json, logError } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { finAccess } from "@/lib/financials/server";
import { site } from "@/lib/site";
import { testCheckoutBlocked, TEST_CHECKOUT_MESSAGE } from "@/lib/billing/test-mode";
import { serverEnv } from "@/lib/env";
import { accountState, ACCOUNT_STATE_LABEL, connectMode, surchargeAllowed } from "@/lib/financials/connect";
import { createPayLink, getPaymentAccount, refreshAccount, revokePayLinks, startOnboarding } from "@/lib/financials/connect-server";

export const runtime = "nodejs";

/** Contractor side of online invoice payments: account status, Stripe onboarding, settings and pay links. */
export async function GET() {
  const g = await finGuard({ write: false, limitKey: "fin-connect-read", limit: 120 });
  if ("error" in g) return g.error;
  const mode = connectMode();
  const account = mode === "off" ? null : await getPaymentAccount(g.bookId).catch(() => null);
  const state = accountState(account ? { ...account, requirements: { currently_due: account.requirements_due, disabled_reason: account.disabled_reason } } : null);
  return json({ mode, state, label: ACCOUNT_STATE_LABEL[state], account: account && {
    chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, cardEnabled: account.card_enabled, achEnabled: account.ach_enabled,
    cardFeePayer: account.card_fee_payer, requirementsDue: account.requirements_due.length, livemode: account.livemode,
  }, surchargeAllowed: surchargeAllowed() });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("onboard") }),
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("settings"), cardEnabled: z.boolean().optional(), achEnabled: z.boolean().optional(), cardFeePayer: z.enum(["contractor", "customer"]).optional() }),
  z.object({ action: z.literal("link"), invoiceId: z.string().uuid() }),
  z.object({ action: z.literal("revoke-link"), invoiceId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-connect", limit: 60 });
  if ("error" in g) return g.error;
  const { db, bookId, user } = g;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Something in that request wasn't right.");
  const mode = connectMode();
  if (mode === "off") return fail(409, "coming_soon", "Online payments are coming soon.");
  if (testCheckoutBlocked(serverEnv().stripeSecretKey, user.email)) return fail(403, "test_mode", TEST_CHECKOUT_MESSAGE);
  const access = await finAccess(db, bookId);
  if (!access) return fail(403, "forbidden", "You don't have access to these books.");
  if (access.sandbox) return fail(409, "practice_mode", "Practice books can't take real payments. Switch back to your real books to set up online payments.");
  const has = async (key: string) => (await db.rpc("fin_has_permission", { p_book_id: bookId, p_key: key, p_write: true })).data === true;

  try {
    switch (p.data.action) {
      case "onboard": {
        if (!(await has("manage_financial_config"))) return fail(403, "forbidden", "Only the owner can set up online payments.");
        const back = `${site.url}/financials/payments`;
        const url = await startOnboarding({ bookId, userId: user.id, email: user.email, businessName: access.name, returnUrl: `${back}?stripe=return`, refreshUrl: `${back}?stripe=refresh` });
        return json({ url });
      }
      case "refresh": {
        const a = await refreshAccount(bookId);
        return json({ ok: true, chargesEnabled: Boolean(a?.charges_enabled) });
      }
      case "settings": {
        if (!(await has("manage_financial_config"))) return fail(403, "forbidden", "Only the owner can change payment settings.");
        if (p.data.cardFeePayer === "customer" && !surchargeAllowed()) {
          return fail(409, "surcharge_unavailable", "Passing the card fee to customers turns on after the legal review of card surcharge rules. Customers can always pay by bank (ACH) at a much lower fee.");
        }
        const { data, error } = await db.rpc("fin_payment_account_settings", { p_book_id: bookId, p: p.data });
        if (error) {
          if (error.message.includes("fin_payment_accounts_method")) return fail(409, "no_methods", "Keep at least one way to pay turned on.");
          return fail(409, error.message.split(/\s/)[0] || "failed", "We couldn't save that.");
        }
        return json(data);
      }
      case "link": {
        if (!(await has("create_invoices"))) return fail(403, "forbidden", "You don't have permission to send invoices.");
        const a = await getPaymentAccount(bookId);
        if (!a?.charges_enabled) return fail(409, "not_ready", "Finish setting up online payments first.");
        const { data: inv } = await db.from("fin_invoices").select("id, status").eq("id", p.data.invoiceId).eq("book_id", bookId).maybeSingle();
        if (!inv) return fail(404, "not_found", "We couldn't find that invoice.");
        if ((inv as { status: string }).status !== "issued") return fail(409, "invoice_not_open", "Only issued invoices can be paid online.");
        const token = await createPayLink(bookId, p.data.invoiceId, user.id);
        return json({ url: `${site.url}/pay/${token}` });
      }
      case "revoke-link": {
        if (!(await has("create_invoices"))) return fail(403, "forbidden", "You don't have permission to change invoices.");
        const { data: inv } = await db.from("fin_invoices").select("id").eq("id", p.data.invoiceId).eq("book_id", bookId).maybeSingle();
        if (!inv) return fail(404, "not_found", "We couldn't find that invoice.");
        await revokePayLinks(p.data.invoiceId, user.id);
        return json({ ok: true });
      }
    }
  } catch (e) {
    logError("fin.connect", e, { action: p.data.action });
    return fail(502, "stripe_error", "Stripe didn't respond as expected. Please try again in a minute.");
  }
}
