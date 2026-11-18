"use client";
import { useState } from "react";
import { Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/financials/accounting/controls";
import { useTb } from "./client";

type PlaidHandler = { open: () => void; destroy: () => void };
declare global { interface Window { Plaid?: { create: (cfg: { token: string; onSuccess: (publicToken: string) => void; onExit: (err: { error_message?: string } | null) => void }) => PlaidHandler } } }
const PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** Load Plaid's own Link script (Plaid hosts the bank sign-in; Built2Bid never sees the login) and open it. */
async function openPlaid(linkToken: string): Promise<{ publicToken: string } | { exit: string | null }> {
  if (!window.Plaid) {
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = PLAID_SRC; el.async = true; el.onload = () => resolve(); el.onerror = () => reject(new Error("plaid_script"));
      document.head.appendChild(el);
    });
  }
  return new Promise((resolve) => {
    const h = window.Plaid!.create({
      token: linkToken,
      onSuccess: (publicToken) => { h.destroy(); resolve({ publicToken }); },
      onExit: (err) => { h.destroy(); resolve({ exit: err?.error_message ?? null }); },
    });
    h.open();
  });
}

const SCENARIOS = { ok: "One checking account", two_accounts: "Checking + savings", partial: "Only 30 days of history", institution_down: "Bank temporarily down", expired: "Login expired (needs reconnect)", no_balance: "Bank doesn't report a balance" } as const;

/**
 * Connect a bank. With no approved provider this is a "Coming soon" button. In practice mode the secure window is a
 * mock with test scenarios; a real provider opens its own window (Built2Bid never sees the bank login).
 */
export function ConnectBank({ mode, canConnect, laterHref }: { mode: "none" | "mock" | "plaid"; canConnect: boolean; laterHref?: string }) {
  const { busy, msg, run, setMsg } = useTb();
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<keyof typeof SCENARIOS>("two_accounts");
  if (!canConnect) return null;
  if (mode === "none") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled aria-describedby="bank-soon" data-testid="bank-connect-soon"><Landmark className="h-4 w-4" aria-hidden /> Connect Business Bank Account</Button>
        <span id="bank-soon" className="text-sm text-muted">Coming soon. Turns on after the owner approves a banking provider.</span>
        {laterHref && <a href={laterHref} className="text-sm font-semibold text-accent-ink underline">I&apos;ll do this later</a>}
      </div>
    );
  }
  if (mode === "plaid") {
    const connect = async () => {
      const start = await run<{ linkToken: string }>({ action: "bank_link_start" }, "Opening your bank's secure window…");
      if (!start) return;
      let res: Awaited<ReturnType<typeof openPlaid>>;
      try { res = await openPlaid(start.linkToken); } catch { setMsg({ tone: "danger", text: "The secure bank window couldn't load. Check your connection or ad blocker and try again." }); return; }
      if ("exit" in res) { setMsg(res.exit ? { tone: "danger", text: `${res.exit} Nothing was connected.` } : null); return; }
      const r = await run<{ sync: { status: string; inserted: number } }>({ action: "bank_link_finish", publicToken: res.publicToken }, "Connected.");
      if (r) setMsg({ tone: "ok", text: `Connected. ${r.sync.inserted} transactions imported.` });
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void connect()} data-testid="bank-connect"><Landmark className="h-4 w-4" aria-hidden /> Connect Business Bank Account</Button>
        {laterHref && <a href={laterHref} className="text-sm font-semibold text-accent-ink underline">I&apos;ll do this later</a>}
        <Status msg={msg} busy={busy} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOpen(true)} data-testid="bank-connect"><Landmark className="h-4 w-4" aria-hidden /> Connect Business Bank Account</Button>
        {laterHref && <a href={laterHref} className="text-sm font-semibold text-accent-ink underline">I&apos;ll do this later</a>}
        <Status msg={msg} busy={busy} />
      </div>
      {open && (
        <div role="dialog" aria-modal="false" aria-labelledby="mock-link-h" className="max-w-lg space-y-3 rounded-xl border-2 border-dashed border-brand bg-surface p-4" data-testid="bank-mock-link">
          <h3 id="mock-link-h" className="flex items-center gap-2 font-display text-base font-extrabold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden /> Practice bank connection</h3>
          <p className="text-sm text-ink-soft">This stands in for your bank&apos;s secure sign-in window. No real bank is contacted and no login is asked for. Pick what the practice bank should do:</p>
          <label className="label" htmlFor="mock-sc">Practice scenario
            <select id="mock-sc" className="field mt-1" value={scenario} onChange={(e) => setScenario(e.target.value as keyof typeof SCENARIOS)}>{Object.entries(SCENARIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={async () => {
              const s = await run({ action: "bank_link_start" }, "Connecting…");
              if (!s) return;
              const r = await run<{ sync: { status: string; inserted: number } }>({ action: "bank_link_finish", publicToken: `mock-public:${scenario}` }, "Connected.");
              if (r) { setOpen(false); setMsg({ tone: "ok", text: `Connected. ${r.sync.inserted} transactions imported${r.sync.status !== "active" ? ` (status: ${r.sync.status.replace(/_/g, " ")})` : ""}.` }); }
            }}>Allow read-only access</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectionActions({ id, status, canWrite, canManage }: { id: string; status: string; canWrite: boolean; canManage: boolean }) {
  const { busy, msg, run, setMsg } = useTb();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  if (status === "disconnected") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canWrite && ["active", "institution_down", "error"].includes(status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "bank_refresh", connectionId: id }, "Bank balance refreshed.")} data-testid="bank-refresh"><RefreshCw className="h-4 w-4" aria-hidden /> Refresh bank balance</Button>}
      {canManage && ["needs_reauth", "revoked", "error"].includes(status) && <Button size="sm" disabled={busy} onClick={async () => {
        const start = await run<{ provider: string; linkToken: string | null }>({ action: "bank_reconnect_start", connectionId: id }, "Opening your bank's secure window…");
        if (!start) return;
        if (start.linkToken) {
          let res: Awaited<ReturnType<typeof openPlaid>>;
          try { res = await openPlaid(start.linkToken); } catch { setMsg({ tone: "danger", text: "The secure bank window couldn't load. Try again." }); return; }
          if ("exit" in res) { setMsg(res.exit ? { tone: "danger", text: res.exit } : null); return; }
        }
        await run({ action: "bank_reconnect", connectionId: id }, "Reconnected.");
      }}>Reconnect</Button>}
      {canManage && !confirm && <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Disconnect</Button>}
      {canManage && confirm && (
        <span className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`dr-${id}`}>Reason (optional)</label>
          <input id={`dr-${id}`} className="field field-sm w-48" maxLength={300} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void run({ action: "bank_disconnect", connectionId: id, reason: reason || undefined }, "Disconnected. Past bank lines and reconciliations are kept.")}>Confirm disconnect</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </span>
      )}
      <Status msg={msg} busy={busy} />
    </div>
  );
}

export function SetPrimary({ accountId }: { accountId: string }) {
  const { busy, msg, run } = useTb();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "bank_set_primary", accountId }, "Primary account set.")}>Make primary</Button><Status msg={msg} busy={busy} /></span>;
}
