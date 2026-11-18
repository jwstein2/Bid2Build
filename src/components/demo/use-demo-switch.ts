"use client";
import { useCallback, useState } from "react";
import type { DemoSessionKind } from "@/lib/demo/session";

type Phase = "idle" | "preparing" | "switching" | "error";
const MAX_POLLS = 40;

async function post(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, data };
}

/**
 * Full page load after switching, so nothing from the previous environment stays in memory (router
 * cache, open dialogs, loaded lists). Per-tab UI state in sessionStorage is cleared too.
 */
function hardNavigate(to: string) {
  try { window.sessionStorage.clear(); } catch { /* storage blocked */ }
  window.location.assign(to);
}

/** Enter / exit / reset Demo or Practice Mode, with progress while the sample company is prepared. */
export function useDemoSwitch() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const waitReady = useCallback(async (kind: DemoSessionKind) => {
    for (let i = 0; i < MAX_POLLS; i++) {
      const r = await post("/api/demo/enter", { kind });
      const err = r.data.error as { message?: string } | undefined;
      if (!r.ok) throw new Error(err?.message ?? "Demo Mode couldn't start.");
      if (r.data.status === "ready") { setPhase("switching"); hardNavigate(String(r.data.redirect ?? "/dashboard")); return; }
      setProgress(Number(r.data.progress ?? 0));
    }
    throw new Error("Preparing the sample company is taking longer than expected. Try again in a minute.");
  }, []);

  const enter = useCallback(async (kind: DemoSessionKind) => {
    setError(null); setPhase("preparing"); setProgress(0);
    try { await waitReady(kind); } catch (e) { setPhase("error"); setError((e as Error).message); }
  }, [waitReady]);

  const exit = useCallback(async () => {
    setError(null); setPhase("switching");
    try {
      const r = await post("/api/demo/exit");
      if (!r.ok) throw new Error((r.data.error as { message?: string } | undefined)?.message ?? "Couldn't switch back.");
      hardNavigate(String(r.data.redirect ?? "/dashboard"));
    } catch (e) { setPhase("error"); setError((e as Error).message); }
  }, []);

  const reset = useCallback(async (kind: DemoSessionKind) => {
    setError(null); setPhase("preparing"); setProgress(0);
    try {
      const r = await post("/api/demo/reset", { confirm: "RESET" });
      if (!r.ok) throw new Error((r.data.error as { message?: string } | undefined)?.message ?? "Reset didn't finish.");
      await waitReady(kind);
    } catch (e) { setPhase("error"); setError((e as Error).message); }
  }, [waitReady]);

  return { phase, progress, error, enter, exit, reset };
}
