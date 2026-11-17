/**
 * "New bid for this customer": the customer is remembered in this tab for 30 minutes while the
 * contractor picks a trade, then the next new bid starts with it filled in and linked.
 */
export interface NewBidCustomer { id: string; name: string; email: string | null; phone: string | null; address: string | null }

const KEY = "b2b:new-bid-customer";
const TTL = 30 * 60_000;

export function rememberNewBidCustomer(c: NewBidCustomer) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now() })); } catch { /* storage blocked: the bid just starts empty */ }
}

/** Read and forget the remembered customer (null when none, expired or unreadable). */
export function takeNewBidCustomer(now = Date.now()): NewBidCustomer | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as NewBidCustomer & { at?: number };
    if (!v?.id || !v.name || typeof v.at !== "number" || now - v.at > TTL) return null;
    return { id: v.id, name: v.name, email: v.email ?? null, phone: v.phone ?? null, address: v.address ?? null };
  } catch { return null; }
}
