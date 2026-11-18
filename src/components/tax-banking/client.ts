"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "@/components/financials/fin-client";

/** POST one V6.9 action (src/app/api/financials/tax-banking). The server re-checks every permission. */
export async function tbAction<T = Record<string, unknown>>(payload: Record<string, unknown>, url = "/api/financials/tax-banking"): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    const e = body && typeof body.error === "object" && body.error ? body.error : body;
    if (!res.ok) return { ok: false, code: (typeof e.code === "string" && e.code) || "server_error", message: e.message ?? "Something went wrong. Nothing was changed.", detail: e.detail };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "network", message: "You're offline or the connection dropped. Nothing was changed." };
  }
}

export function useTb() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const run = async <T = Record<string, unknown>>(payload: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await tbAction<T>(payload);
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: r.message }); return null; }
    setMsg({ tone: "ok", text: ok });
    router.refresh();
    return r.data;
  };
  return { busy, msg, run, setMsg };
}
