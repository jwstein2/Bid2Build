import { D, round2, type Dec } from "@/lib/estimate/money";

/** Lenient decimal: bad input = 0 (inputs here are already validated money strings or DB numerics). */
export const dec = (s: string | number | null | undefined): Dec => { try { return new D(s ?? 0); } catch { return new D(0); } };
export const money2 = (d: Dec) => round2(d).toFixed(2);
