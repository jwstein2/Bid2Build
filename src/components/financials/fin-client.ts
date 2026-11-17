"use client";
import { formatCurrency } from "@/lib/estimate/money";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; detail?: unknown };

/** POST one Financials action (see src/app/api/financials/actions). The server re-checks everything. */
export async function finAction<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<ActionResult<T>> {
  try {
    const res = await fetch("/api/financials/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: body.error ?? "server_error", message: body.message ?? "Something went wrong. Nothing was changed.", detail: body.detail };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "network", message: "You're offline or the connection dropped. Nothing was changed." };
  }
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const usd = (v: unknown) => formatCurrency(String(v ?? "0") || "0");
export const today = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (d: unknown) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
