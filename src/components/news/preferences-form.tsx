"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_LABEL } from "@/lib/news/categories";
import type { NewsPrefs } from "@/lib/news/prefs";
import { CATEGORIES, AUTHORITIES, type Authority, type Category } from "@/lib/news/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

const AUTH_LABEL: Record<Authority, string> = { official: "Official (government)", industry: "Industry (associations & trade press)", local_news: "Local news", community: "Community discussions" };
const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function PreferencesForm({ initial, defaultTrades, trades, canManageCompany }: { initial: NewsPrefs; defaultTrades: string[]; trades: { slug: string; name: string }[]; canManageCompany: boolean }) {
  const router = useRouter();
  const [p, setP] = useState({ ...initial, followedTrades: initial.followedTrades.length ? initial.followedTrades : defaultTrades });
  const [counties, setCounties] = useState(initial.serviceCounties.join(", "));
  const [publishers, setPublishers] = useState(initial.hiddenPublishers.join("\n"));
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewsPrefs>(k: K, v: NewsPrefs[K]) => setP((x) => ({ ...x, [k]: v }));

  const body = () => ({
    followedTrades: p.followedTrades, radiusMiles: p.radiusMiles, geoEmphasis: p.geoEmphasis, topics: p.topics, mutedTopics: p.mutedTopics.filter((m) => !p.topics.includes(m)),
    sourceTypes: p.sourceTypes, hiddenPublishers: publishers.split("\n").map((s) => s.trim()).filter(Boolean), serviceCounties: counties.split(",").map((s) => s.trim()).filter(Boolean),
    notifyOfficialRules: p.notifyOfficialRules, notifyLocalDisasters: p.notifyLocalDisasters, notifyMaterialPrices: p.notifyMaterialPrices, emailDigest: p.emailDigest,
  });
  const save = async (url: string, payload: unknown, ok: string) => {
    setBusy(true); setStatus(null);
    const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    setStatus(r.ok ? { tone: "ok", text: ok } : { tone: "danger", text: j.error?.message ?? "Couldn't save. Try again." });
    setBusy(false);
    if (r.ok) router.refresh();
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save("/api/news/preferences", body(), "Preferences saved. Your feed and briefing use them now."); }}>
      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display font-extrabold text-navy">Trades you follow</legend>
        <p className="text-sm text-muted">Your first trade counts as your primary trade. Choose a few; following everything makes the feed less useful.</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2 md:grid-cols-3">
          {trades.map((t) => (
            <label key={t.slug} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={p.followedTrades.includes(t.slug)} onChange={() => set("followedTrades", toggle(p.followedTrades, t.slug).slice(0, 12))} />
              {t.name}{p.followedTrades[0] === t.slug && <span className="text-xs text-accent-ink">(primary)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display font-extrabold text-navy">Location</legend>
        <p className="text-sm text-muted">We use your business address. No GPS. Add the counties you work in to get county-level local news (for example disaster declarations).</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Service area
            <select value={p.radiusMiles} onChange={(e) => set("radiusMiles", Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 font-normal">
              <option value={25}>About 25 miles (my county)</option><option value={50}>About 50 miles</option><option value={100}>About 100 miles</option><option value={250}>About 250 miles (my region)</option>
            </select>
          </label>
          <label className="text-sm font-semibold">Geographic emphasis
            <select value={p.geoEmphasis} onChange={(e) => set("geoEmphasis", e.target.value as NewsPrefs["geoEmphasis"])} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 font-normal">
              <option value="balanced">Balanced</option><option value="local">More local</option><option value="state">More state</option><option value="national">More national</option>
            </select>
          </label>
          <label className="text-sm font-semibold sm:col-span-2">Counties you work in (comma separated)
            <input value={counties} onChange={(e) => setCounties(e.target.value)} placeholder="Hennepin, Ramsey, Dakota" className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-normal" />
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display font-extrabold text-navy">Topics</legend>
        <p className="text-sm text-muted">Follow topics to see them first. Mute topics you never want.</p>
        <div className="mt-2 divide-y divide-line">
          {CATEGORIES.map((c: Category) => (
            <div key={c} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <span>{CATEGORY_LABEL[c]}</span>
              <span className="flex gap-3">
                <label className="flex items-center gap-1"><input type="checkbox" checked={p.topics.includes(c)} onChange={() => { set("topics", toggle(p.topics, c)); set("mutedTopics", p.mutedTopics.filter((m) => m !== c)); }} />Follow</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={p.mutedTopics.includes(c)} onChange={() => { set("mutedTopics", toggle(p.mutedTopics, c)); set("topics", p.topics.filter((m) => m !== c)); }} />Mute</label>
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display font-extrabold text-navy">Sources</legend>
        <p className="text-sm text-muted">Leave all unchecked to include every source type.</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {AUTHORITIES.map((a) => (
            <label key={a} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={p.sourceTypes.includes(a)} onChange={() => set("sourceTypes", toggle(p.sourceTypes, a))} />{AUTH_LABEL[a]}</label>
          ))}
        </div>
        <label className="mt-3 block text-sm font-semibold">Hidden publishers (one per line)
          <textarea value={publishers} onChange={(e) => setPublishers(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-normal" placeholder="Construction Dive" />
        </label>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display font-extrabold text-navy">Alerts (opt-in)</legend>
        <p className="text-sm text-muted">Everything is off unless you turn it on. Important items are marked in your feed. Email digests aren&apos;t being sent yet; turning this on just records your choice.</p>
        <div className="mt-2 space-y-1 text-sm">
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={p.notifyOfficialRules} onChange={(e) => set("notifyOfficialRules", e.target.checked)} />Final official rules for my trades</label>
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={p.notifyLocalDisasters} onChange={(e) => set("notifyLocalDisasters", e.target.checked)} />Disaster declarations in my counties</label>
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={p.notifyMaterialPrices} onChange={(e) => set("notifyMaterialPrices", e.target.checked)} />Material price news for my trades</label>
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={p.emailDigest} onChange={(e) => set("emailDigest", e.target.checked)} />Weekly email digest (when available)</label>
        </div>
      </fieldset>

      {status && <Notice tone={status.tone}>{status.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>Save preferences</Button>
        {initial.saved && <Button type="button" variant="ghost" disabled={busy} onClick={() => save("/api/news/preferences", { reset: true }, "Back to your company profile defaults.")}>Reset to defaults</Button>}
        {canManageCompany && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { const b = body(); void save("/api/news/company-defaults", { followedTrades: b.followedTrades, topics: b.topics, mutedTopics: b.mutedTopics, geoEmphasis: b.geoEmphasis, radiusMiles: b.radiusMiles, serviceCounties: b.serviceCounties }, "Saved as your company's default. Teammates who haven't set their own preferences use it."); }}>
            Use as company default
          </Button>
        )}
      </div>
    </form>
  );
}
