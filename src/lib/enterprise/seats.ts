/**
 * Pure seat-change rules (no I/O) shared by the seat API and its tests.
 *
 * When does a seat become billable? Only when an administrator explicitly buys it on the Billing &
 * Licenses page after seeing the exact price and proration. Inviting someone never buys a seat: an
 * invitation can only use a seat the company already pays for (pending invitations hold that seat so
 * it can't be promised twice), and invitations stop at the licensed count.
 */
import { ENTERPRISE_INCLUDED_USERS, ENTERPRISE_MAX_USERS, enterpriseMonthlyCents } from "./pricing";

export type SeatItem = { id: string; price: { id: string }; quantity?: number | null };
export type SubscriptionItemUpdate = { id?: string; price?: string; quantity?: number; deleted?: boolean };

/** Licensed users on a subscription = 3 + quantity of the seat item. */
export function licensedUsers(items: SeatItem[], seatPriceId: string): number {
  const seat = items.find((i) => i.price.id === seatPriceId);
  return ENTERPRISE_INCLUDED_USERS + Math.max(0, seat?.quantity ?? 0);
}

export type SeatCheck = { ok: true } | { ok: false; code: "invalid" | "below_in_use" | "unchanged"; message: string };

/** Is moving to `targetUsers` licensed users allowed, given seats currently in use (members + pending invites)? */
export function checkSeatTarget(targetUsers: number, currentUsers: number, seatsInUse: number): SeatCheck {
  if (!Number.isInteger(targetUsers) || targetUsers < ENTERPRISE_INCLUDED_USERS || targetUsers > ENTERPRISE_MAX_USERS) {
    return { ok: false, code: "invalid", message: `Choose between ${ENTERPRISE_INCLUDED_USERS} and ${ENTERPRISE_MAX_USERS} licensed users.` };
  }
  if (targetUsers === currentUsers) return { ok: false, code: "unchanged", message: "That's your current number of licensed users." };
  if (targetUsers < seatsInUse) {
    return { ok: false, code: "below_in_use", message: `${seatsInUse} seats are in use (active users and pending invitations). Deactivate users or revoke invitations before going below ${seatsInUse}.` };
  }
  return { ok: true };
}

/** Subscription item changes that set the seat item to `targetUsers - 3` (adding or removing the item as needed). */
export function seatItemUpdates(items: SeatItem[], seatPriceId: string, targetUsers: number): SubscriptionItemUpdate[] {
  const qty = Math.max(0, targetUsers - ENTERPRISE_INCLUDED_USERS);
  const seat = items.find((i) => i.price.id === seatPriceId);
  if (seat) return [qty > 0 ? { id: seat.id, quantity: qty } : { id: seat.id, deleted: true }];
  return qty > 0 ? [{ price: seatPriceId, quantity: qty }] : [];
}

export function monthlyChange(currentUsers: number, targetUsers: number) {
  const before = enterpriseMonthlyCents(currentUsers);
  const after = enterpriseMonthlyCents(targetUsers);
  return { beforeCents: before, afterCents: after, deltaCents: after - before };
}
