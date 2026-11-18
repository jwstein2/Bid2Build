/**
 * Enterprise scheduling editor seats as the seat manager sees them (V4 Phase 9): who holds each seat,
 * what kind of seat it is, whether the plan covers it, and when it last changed.
 */
export type SeatType = "included" | "paid" | "complimentary" | "uncovered";

export interface PmSeat {
  userId: string;
  rank: number;
  seatType: SeatType;
  covered: boolean;
  assignedAt: string;
  changedAt: string;
  changedBy: string | null;
}

export interface PmSeats {
  limit: number;
  source: string | null;
  paid: boolean;
  extraPaid: number;
  seats: PmSeat[];
  /** Company schedules each active member could edit with a seat (shown before removing one). */
  schedules: Record<string, number>;
}

export const SEAT_TYPE_LABEL: Record<SeatType, string> = {
  included: "Included with Team",
  paid: "Paid editor seat",
  complimentary: "Complimentary",
  uncovered: "Not covered by your plan",
};

/** What a seat costs, in plain words (no prices: those live on the billing page). */
export function seatBilling(s: PmSeat): string {
  if (s.seatType === "included") return "No extra charge";
  if (s.seatType === "paid") return "Billed monthly on your Team subscription";
  if (s.seatType === "complimentary") return "No charge (complimentary access)";
  return "View only until a seat is added";
}

export function parsePmSeats(raw: unknown): PmSeats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PmSeats>;
  return {
    limit: Number(r.limit) || 0,
    source: r.source ?? null,
    paid: Boolean(r.paid),
    extraPaid: Number(r.extraPaid) || 0,
    seats: Array.isArray(r.seats) ? r.seats : [],
    schedules: r.schedules && typeof r.schedules === "object" ? r.schedules : {},
  };
}
