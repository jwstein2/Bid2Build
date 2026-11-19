"use client";
import { useEffect, useRef, useState } from "react";
import { disputeMilestone, openMilestone } from "@/app/sales/(portal)/milestone-actions";

export interface MilestoneAward {
  id: string; milestone: number; pct: number; reached_at: string; unlocks_at: string;
  status: "locked" | "ready" | "opened" | "approved" | "paid" | "void" | "disputed" | "ineligible"; amount_cents: number | null; revenue_cents: number | null;
  flat?: boolean; badge?: string | null; rule_set?: "v2_window" | "v3_active_mrr"; mrr_cents?: number | null; qualifying_customers?: number | null;
  snapshot_hash?: string | null; void_reason?: string | null;
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Original Built2Bid gift box: navy box, orange ribbon and bow, wordmark on the front. */
function BoxArt({ opening }: { opening: boolean }) {
  return (
    <svg viewBox="0 0 160 150" className={`h-40 w-40 ${opening ? "gift-open" : ""}`} aria-hidden="true">
      <rect x="22" y="62" width="116" height="80" rx="6" fill="var(--color-navy)" />
      <rect x="72" y="62" width="16" height="80" fill="var(--color-accent)" />
      <rect x="38" y="98" width="84" height="20" rx="4" fill="#fff" />
      <text x="80" y="112.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--color-navy)" style={{ letterSpacing: ".5px" }}>BUILT2BID</text>
      <g className="gift-lid">
        <rect x="14" y="44" width="132" height="22" rx="5" fill="var(--color-navy)" stroke="rgba(255,255,255,.18)" />
        <rect x="72" y="44" width="16" height="22" fill="var(--color-accent)" />
        <path d="M80 44 C60 18 38 30 52 42 C58 47 72 46 80 44 Z" fill="var(--color-accent)" />
        <path d="M80 44 C100 18 122 30 108 42 C102 47 88 46 80 44 Z" fill="var(--color-accent)" />
        <circle cx="80" cy="43" r="6" fill="var(--color-accent-dark)" />
      </g>
    </svg>
  );
}

function Box({ award, onOpened }: { award: MilestoneAward; onOpened: (a: MilestoneAward) => void }) {
  const [phase, setPhase] = useState<"idle" | "shaking" | "open">(award.amount_cents != null ? "open" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(award.amount_cents);
  const click = async () => {
    if (phase !== "idle") return;
    setError(null);
    setPhase("shaking");
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [res] = await Promise.all([openMilestone(award.id), new Promise((r) => setTimeout(r, reduce ? 0 : 900))]);
    if (!res.ok) { setPhase("idle"); setError(res.message); return; }
    setAmount(res.amount_cents);
    setPhase("open");
    onOpened({ ...award, status: "opened", amount_cents: res.amount_cents, revenue_cents: res.revenue_cents });
  };
  const shown = amount ?? award.amount_cents;
  const isOpen = (phase === "open" || award.amount_cents != null) && shown != null;
  return (
    <div className="flex flex-col items-center text-center">
      {isOpen ? (
        <div className="relative">
          <BoxArt opening />
          <div className="gift-amount absolute inset-x-0 top-6 text-center" aria-live="polite">
            <p className="text-3xl font-extrabold text-accent-ink drop-shadow">{usd(shown)}</p>
          </div>
        </div>
      ) : (
        <button type="button" onClick={click} disabled={phase !== "idle"} className={`rounded-xl p-1 ${phase === "shaking" ? "gift-shaking" : "gift-idle"}`}
          aria-label={`Open your ${award.milestone}-account bonus box`}>
          <BoxArt opening={false} />
        </button>
      )}
      <p className="mt-2 font-bold">{isOpen ? `${award.milestone} accounts bonus${award.badge ? ` · ${award.badge} badge` : ""}` : "Click the box"}</p>
      {isOpen && <p className="text-sm text-ink-soft">Added to your next statement once the owner approves it.</p>}
      {isOpen && award.rule_set === "v3_active_mrr" && !award.flat && award.mrr_cents != null && (
        <p className="text-xs text-muted">{award.pct}% of {usd(award.mrr_cents)} qualifying active MRR on {new Date(award.reached_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}</p>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** "Something looks wrong" on an award: the owner reviews it; the award itself is never edited. */
function DisputeForm({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "open" | "sending" | "sent">("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") return <p className="mt-1 text-xs text-ok">Sent to the owner for review.</p>;
  if (state === "idle") return <button type="button" onClick={() => setState("open")} className="mt-1 text-xs font-semibold text-brand underline">Question this bonus</button>;
  return (
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (e) => {
      e.preventDefault(); setState("sending"); setError(null);
      const r = await disputeMilestone(id, note);
      if (r.ok) setState("sent"); else { setState("open"); setError(r.message); }
    }}>
      <label className="sr-only" htmlFor={`dispute-${id}`}>What looks wrong?</label>
      <input id={`dispute-${id}`} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={1000} placeholder="What looks wrong?" className="min-h-11 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
      <button type="submit" disabled={state === "sending"} className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold">Send</button>
      {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    </form>
  );
}

/**
 * Milestone boxes. A ready box pops up on the dashboard ("Click the box"); opening reveals the bonus.
 */
export function MilestoneBoxes({ awards: initial, accounts, next }: { awards: MilestoneAward[]; accounts: number; next: { at: number; prev: number; label: string } }) {
  const [awards, setAwards] = useState(initial);
  // Boxes that were ready when the page loaded stay on screen after opening so the reveal is visible.
  const [featuredIds] = useState(() => initial.filter((a) => a.status === "ready").map((a) => a.id));
  const ready = awards.filter((a) => featuredIds.includes(a.id));
  const [popup, setPopup] = useState(featuredIds.length > 0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (popup && d && !d.open) d.showModal?.();
    if (!popup && d?.open) d.close();
  }, [popup]);
  const update = (a: MilestoneAward) => setAwards((list) => list.map((x) => (x.id === a.id ? a : x)));
  const toNext = Math.max(0, next.at - accounts);
  const span = Math.max(1, next.at - next.prev);
  const progress = Math.min(100, Math.round(((accounts - next.prev) / span) * 100));
  const label = (a: MilestoneAward) =>
    a.status === "locked" ? `Unlocks ${new Date(a.unlocks_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })} (30-day refund hold)`
      : a.status === "ready" ? "Ready to open" : a.status === "paid" ? `${usd(a.amount_cents ?? 0)} paid` : a.status === "approved" ? `${usd(a.amount_cents ?? 0)} on your next statement`
      : a.status === "void" ? "Canceled by the owner" : a.status === "ineligible" ? "Not eligible (program unavailable for your work location)"
      : a.status === "disputed" ? "Under review (you disputed it)" : `${usd(a.amount_cents ?? 0)} waiting for owner approval`;
  const explain = (a: MilestoneAward) =>
    a.amount_cents == null ? null : a.flat ? "Flat amount" : a.rule_set === "v3_active_mrr" && a.mrr_cents != null ? `${a.pct}% × ${usd(a.mrr_cents)} active MRR = ${usd(a.amount_cents)}` : a.revenue_cents != null ? `${a.pct}% of ${usd(a.revenue_cents)} active revenue` : null;
  return (
    <section aria-labelledby="milestones-h" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="milestones-h" className="text-lg font-bold">Milestone bonuses</h2>
      <p className="mt-1 text-sm text-ink-soft">Each milestone opens a Built2Bid gift box with a one-time cash bonus, once per milestone. <a href="/sales/how-you-get-paid" className="font-semibold text-brand underline">How it works</a></p>
      <p className="mt-3 text-sm"><strong>Next reward:</strong> {accounts} of {next.at} customers · {toNext} to go · {next.label}</p>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={next.prev} aria-valuemax={next.at} aria-valuenow={accounts} aria-label="Progress to your next reward">
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      {ready.length > 0 && <div className="mt-5 flex flex-wrap justify-center gap-6">{ready.map((a) => <Box key={a.id} award={a} onOpened={update} />)}</div>}
      {awards.length > 0 && (
        <ul className="mt-4 divide-y divide-line text-sm">
          {awards.map((a) => (
            <li key={a.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{a.milestone} customers · {a.flat ? `${a.badge ?? "Badge"} box` : `${a.pct}%`}</span><span className="text-ink-soft">{label(a)}</span></div>
              {explain(a) && <p className="text-xs text-muted">{explain(a)}{a.snapshot_hash ? ` · record ${a.snapshot_hash.slice(0, 10)}` : ""}</p>}
              {a.amount_cents != null && !["disputed", "void", "paid"].includes(a.status) && <DisputeForm id={a.id} />}
            </li>
          ))}
        </ul>
      )}
      <dialog ref={dialog} onClose={() => setPopup(false)} aria-labelledby="gift-pop-h" className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60">
        <h2 id="gift-pop-h" className="text-center text-xl font-extrabold">You hit a milestone!</h2>
        <div className="mt-4 flex flex-wrap justify-center gap-6">{ready.map((a) => <Box key={a.id} award={a} onOpened={update} />)}</div>
        <div className="mt-5 text-center"><button type="button" onClick={() => setPopup(false)} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink">Close</button></div>
      </dialog>
    </section>
  );
}
