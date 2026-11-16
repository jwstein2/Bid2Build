import type Stripe from "stripe";

/**
 * Stripe Tax. The live account has Stripe Tax active (head office + registrations are managed in the
 * Stripe Dashboard), so every new Checkout session asks Stripe to work out sales tax from the
 * customer's billing address. Stripe only charges tax in places the account has registered, so this
 * is a no-op until a registration covers the customer. Set STRIPE_AUTOMATIC_TAX=off to switch it off
 * (for example in a sandbox where Stripe Tax isn't set up, where Checkout would otherwise refuse).
 */
export const automaticTaxEnabled = () => process.env.STRIPE_AUTOMATIC_TAX !== "off";

/** Checkout params that turn on Stripe Tax and collect the billing address it needs. */
export function checkoutTaxParams(): Partial<Stripe.Checkout.SessionCreateParams> {
  if (!automaticTaxEnabled()) return {};
  return {
    automatic_tax: { enabled: true },
    // Full address gives Stripe the exact local rate; it's saved on the existing Customer so later
    // renewals, seat changes and add-ons are taxed from the same address.
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
  };
}

/**
 * Invoice previews (seat, editor and add-on changes) must mirror the subscription's own tax setting
 * so the "due now" amount shown in the app matches what Stripe actually charges.
 */
export function previewTaxParams(sub: { automatic_tax?: { enabled?: boolean } | null }): Pick<Stripe.InvoiceCreatePreviewParams, "automatic_tax"> {
  return sub.automatic_tax?.enabled ? { automatic_tax: { enabled: true } } : {};
}
