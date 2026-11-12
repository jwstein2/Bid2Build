"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";

export function AccountActions({ marketing }: { marketing: boolean }) {
  const [optIn, setOptIn] = useState(marketing);
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function toggle(v: boolean) {
    setOptIn(v);
    await fetch("/api/account/marketing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optIn: v }) });
  }
  async function del() {
    const r = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm }) });
    if (r.ok) window.location.assign("/?deleted=1");
    else setMsg((await r.json().catch(() => null))?.error?.message ?? "Could not delete account.");
  }
  return (
    <>
      <Card className="p-5">
        <h2 className="font-bold">Email preferences</h2>
        <p className="text-sm text-ink-soft">Account and transactional emails (sign-in links, receipts) are always sent. Marketing emails are optional.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={optIn} onChange={(e) => toggle(e.target.checked)} className="accent-[var(--color-brand)]" /> Send me product tips and offers</label>
      </Card>
      <Card className="p-5">
        <h2 className="font-bold">Your data</h2>
        <p className="text-sm text-ink-soft">Download everything we store about your account: profile, company, customers, estimates, versions, and usage.</p>
        <a href="/api/account/export" className="mt-3 inline-block rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-paper">Download my data (JSON)</a>
      </Card>
      <Card className="border-danger/30 p-5">
        <h2 className="font-bold text-danger">Delete account</h2>
        <p className="text-sm text-ink-soft">Permanently deletes your account, estimates, customers, branding, and generated PDFs. Active subscriptions are canceled. This cannot be undone.</p>
        <label htmlFor="del-confirm" className="label mt-3">Type DELETE to confirm</label>
        <div className="flex gap-2">
          <input id="del-confirm" className="field max-w-[200px]" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button variant="danger" disabled={confirm !== "DELETE"} onClick={del}>Delete my account</Button>
        </div>
        {msg && <Notice tone="danger" className="mt-3">{msg}</Notice>}
      </Card>
    </>
  );
}
