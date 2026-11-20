/** Bank-account problems (Stripe failure/return reasons) that mean the destination itself must be replaced. */
export const destinationProblem = (reason: string | null | undefined) =>
  reason && /closed|does_not_exist|invalid_account|canceled_by_customer|holder_(name|details)_incorrect|restricted/.test(reason) ? "account_closed" : reason ?? null;
