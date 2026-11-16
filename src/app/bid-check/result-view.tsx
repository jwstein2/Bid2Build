"use client";

import { useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Lightbulb, RotateCcw, Sparkles, Target, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { track } from "@/lib/analytics/track";
import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency, formatPercent } from "@/lib/estimate/money";
import { uid } from "@/lib/estimate/factory";
import { saveLocalDraft, saveLocalStep } from "@/lib/drafts/local";
import { buildProposal } from "@/lib/proposal/build";
import { getTrade } from "@/lib/trades/catalog";
import { ProposalView } from "@/components/proposal/proposal-view";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { buildSample, sampleForBuilder, type Sample } from "@/lib/bid-check/sample";
import { samplePipelineBids } from "@/lib/bid-check/pipeline-sample";
import type { BidCheckResult } from "@/lib/bid-check/result";
import type { Answers } from "@/lib/bid-check/types";
import { TRIAL_DAYS } from "@/lib/trial/config";
import { sendEvent } from "./events";

interface Props {
  result: BidCheckResult;
  answers: Answers;
  sid: string;
  invitesOpen: boolean;
  signedIn: boolean;
  bonusCount: number;
  bonusDone: boolean;
  onBonus: () => void;
  onEdit: () => void;
  onRestart: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function ResultView({ result, answers, sid, invitesOpen, signedIn, bonusCount, bonusDone, onBonus, onEdit, onRestart, headingRef }: Props) {
  const router = useRouter();
  const sample = useMemo(() => buildSample(answers), [answers]);

  function openSample(step: "estimate" | "proposal") {
    if (!sample) return;
    const id = uid();
    saveLocalDraft(sampleForBuilder(sample, id));
    saveLocalStep(id, step);
    sendEvent(sid, "sample");
    router.push(`/builder?draft=${id}`);
  }

  function runAction() {
    const a = result.action;
    if (a.kind === "open_sample") openSample(a.step ?? "estimate");
    else if (a.kind === "dashboard") router.push("/dashboard");
    else { sendEvent(sid, "free_bid"); router.push(result.freeBidHref); }
  }

  const freeBid = (
    <a href={result.freeBidHref} onClick={() => sendEvent(sid, "free_bid")} data-testid="bc-free-bid"
      className={cn("inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-5 font-display font-semibold sm:w-auto",
        result.primary === "free_bid" ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line-strong bg-surface text-ink hover:border-brand/50")}>
      Start your free bid <ArrowRight className="h-4 w-4" aria-hidden />
    </a>
  );

  return (
    <section aria-labelledby="bc-result" className="mx-auto w-full max-w-3xl" data-testid="bc-result" data-result={result.key} data-primary={result.primary}>
      <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">Your bid check</p>
      <h1 id="bc-result" ref={headingRef} tabIndex={-1} className="mt-1 font-display text-3xl font-extrabold leading-tight text-ink outline-none sm:text-4xl" data-testid="bc-headline">{result.headline}</h1>
      {result.because.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Based on your answers">
          {result.because.map((b) => <li key={b} className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-ink-soft">{b}</li>)}
        </ul>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-bold text-ink"><Target className="h-5 w-5 text-accent-ink" aria-hidden />What I&apos;d tackle first</h2>
          <p className="mt-2 text-ink-soft" data-testid="bc-tackle">{result.tackleFirst}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-bold text-ink"><Lightbulb className="h-5 w-5 text-accent-ink" aria-hidden />Try this on your next estimate</h2>
          <p className="mt-2 text-ink-soft" data-testid="bc-try">{result.tryNext}</p>
        </div>
      </div>
      {result.teamTip && (
        <p className="mt-3 flex gap-2 rounded-xl bg-brand-tint p-4 text-sm text-ink" data-testid="bc-team"><Users className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />{result.teamTip}</p>
      )}

      <div className="mt-8">
        <h2 className="font-display text-xl font-extrabold text-ink">{result.exampleTitle}</h2>
        <div className="mt-3" data-testid="bc-example" data-kind={result.example}>
          <Example result={result} sample={sample} />
        </div>
        {result.followupNote && <p className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft" data-testid="bc-followup-note">{result.followupNote}</p>}
        <div className="mt-4">
          <button type="button" onClick={runAction} data-testid="bc-action"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-brand bg-surface px-5 font-display font-semibold text-brand hover:bg-brand-tint sm:w-auto">
            {result.action.label} <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          {result.action.kind === "dashboard" && !signedIn && <p className="mt-2 text-sm text-muted">Sign in or create a free account to see your own Pipeline.</p>}
        </div>
      </div>

      <div className="mt-8 grid gap-3">
        {result.primary === "free_bid" && (
          <div className="rounded-2xl border-2 border-accent bg-surface p-5" data-testid="bc-free-card">
            <h2 className="font-display text-xl font-extrabold text-ink">Your next bid is free</h2>
            <p className="mt-1 text-ink-soft">Build it with the {getTrade(result.templateSlug)?.name ?? "trade"} template, send a clean PDF, no card needed.</p>
            <div className="mt-4">{freeBid}</div>
          </div>
        )}
        <PassCard sid={sid} invitesOpen={invitesOpen} primary={result.primary === "pass"} trade={result.templateSlug} goal={result.goal} />
        {result.primary === "pass" && <div className="text-center sm:text-left"><span className="text-sm text-muted">Just want to try one bid? </span><a href={result.freeBidHref} onClick={() => sendEvent(sid, "free_bid")} className="text-sm font-semibold text-accent-ink underline" data-testid="bc-free-bid">Start a free bid</a></div>}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-5">
        {bonusDone ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft" data-testid="bc-bonus-done"><CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />Thanks! Your recommendation above includes your bonus answers.</p>
        ) : (
          <>
            <h2 className="flex items-center gap-2 font-bold text-ink"><Sparkles className="h-5 w-5 text-accent-ink" aria-hidden />Want a sharper recommendation?</h2>
            <p className="mt-1 text-sm text-ink-soft">Answer {bonusCount} quick bonus question{bonusCount === 1 ? "" : "s"} about your {result.trade.toLowerCase()} work and how you bid today.</p>
            <button type="button" onClick={onBonus} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-dark" data-testid="bc-bonus">Answer bonus questions <ArrowRight className="h-4 w-4" aria-hidden /></button>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={onEdit} className="font-semibold text-ink-soft underline" data-testid="bc-edit">Change my answers</button>
        <button type="button" onClick={onRestart} className="inline-flex items-center gap-1 font-semibold text-ink-soft underline"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Start over</button>
      </div>
    </section>
  );
}

function Example({ result, sample }: { result: BidCheckResult; sample: Sample | null }) {
  if (result.example === "pipeline") return <PipelineExample slug={result.templateSlug} />;
  if (!sample || result.example === "template") return <TemplateExample slug={result.templateSlug} />;
  if (result.example === "proposal") return <ProposalExample sample={sample} />;
  if (result.example === "profit") return <ProfitExample sample={sample} />;
  return <EstimateExample sample={sample} />;
}

const caption = "Example prices for illustration only, not pricing advice. Open it to change anything.";

function EstimateExample({ sample }: { sample: Sample }) {
  const t = computeEstimate(sample.estimate);
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-bold text-ink">{sample.estimate.title}</p>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-muted">Example</span>
        </div>
        {sample.estimate.groups.map((g) => {
          const focus = g.id === sample.focusGroupId;
          const lines = sample.estimate.items.filter((i) => i.groupId === g.id);
          return (
            <div key={g.id} className={cn("border-b border-line px-4 py-3 last:border-0", focus && "bg-accent-tint")} data-testid={focus ? "bc-focus-group" : undefined}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-ink">{g.name}{focus && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-navy">Broken out</span>}</p>
                <p className="tabular text-sm font-semibold text-ink-soft">{formatCurrency(t.groups[g.id].cost)} cost</p>
              </div>
              <ul className="mt-1.5 space-y-1 text-sm">
                {lines.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 text-ink-soft">
                    <span className="min-w-0">{i.name} <span className="text-muted">· {Number(i.quantity).toLocaleString()} {i.unit}{i.costType === "labor" ? " · labor" : i.costType === "material" ? " · material" : ""}</span></span>
                    <span className="tabular shrink-0">{formatCurrency(t.items[i.id].extendedCost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="flex justify-between bg-brand-tint px-4 py-3"><span className="font-bold text-ink">Customer price (25% markup)</span><span className="tabular font-extrabold text-ink">{formatCurrency(t.total)}</span></div>
      </div>
      <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

function ProfitExample({ sample }: { sample: Sample }) {
  const t = computeEstimate(sample.estimate);
  const mode = sample.estimate.pricing.mode === "margin" ? `Target margin ${sample.estimate.pricing.percent}%` : `Markup ${sample.estimate.pricing.percent}%`;
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-bold text-ink">{sample.estimate.title}</p>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-muted">Example · {mode}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2 font-semibold">Section</th><th className="px-2 py-2 text-right font-semibold">Cost</th><th className="px-2 py-2 text-right font-semibold">Price</th><th className="px-4 py-2 text-right font-semibold">Profit</th></tr></thead>
            <tbody>
              {sample.estimate.groups.map((g) => {
                const gt = t.groups[g.id];
                const focus = g.id === sample.focusGroupId;
                return (
                  <tr key={g.id} className={cn("border-t border-line", focus && "bg-accent-tint font-semibold")} data-testid={focus ? "bc-focus-group" : undefined}>
                    <td className="px-4 py-2 text-ink">{g.name}{focus && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-navy">Broken out</span>}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-soft">{formatCurrency(gt.cost)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-soft">{formatCurrency(gt.price)}</td>
                    <td className="tabular px-4 py-2 text-right text-ink">{formatCurrency(gt.grossProfit)}{gt.grossMargin ? <span className="ml-1 text-xs text-muted">({formatPercent(gt.grossMargin)})</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-sm sm:grid-cols-4" data-testid="bc-profit-summary">
          {[["Total cost", formatCurrency(t.totalCost)], ["Customer price", formatCurrency(t.subtotal)], ["Gross profit", formatCurrency(t.grossProfit)], ["Margin / markup", `${t.grossMargin ? formatPercent(t.grossMargin) : "—"} / ${t.effectiveMarkup ? formatPercent(t.effectiveMarkup) : "—"}`]].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="tabular font-bold text-ink">{v}</dd></div>
          ))}
        </dl>
      </div>
      <figcaption className="mt-2 text-xs text-muted">Profit and margin are only ever shown to you, never on the customer&apos;s proposal. {caption}</figcaption>
    </figure>
  );
}

function ProposalExample({ sample }: { sample: Sample }) {
  const doc = buildProposal(sample.estimate, sample.business, sample.config);
  return (
    <figure>
      <div className="relative max-h-[640px] overflow-hidden rounded-xl bg-[#e4eaf1] p-3 ring-1 ring-line sm:max-h-[900px] sm:p-4">
        <div className="pointer-events-none select-none [zoom:0.56] sm:[zoom:0.7]" inert>
          <ProposalView doc={doc} />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#e4eaf1] to-transparent" />
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        {sample.focusGroupName ? `${sample.focusGroupName} is itemized; the other sections show ${sample.estimate.groups.some((g) => g.visibility === "names_only") ? "item names with a section total" : "a total"}. You choose this per section. ` : ""}{caption}
      </figcaption>
    </figure>
  );
}

function PipelineExample({ slug }: { slug: string }) {
  const bids = useMemo(() => samplePipelineBids(slug), [slug]);
  return (
    <figure>
      <div className="relative max-h-[520px] overflow-hidden rounded-2xl border border-line bg-paper p-3">
        <div className="pointer-events-none select-none [zoom:0.8]" inert>
          <PipelineBoard bids={bids} esign />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper to-transparent" />
      </div>
      <figcaption className="mt-2 text-xs text-muted">The real Pipeline board with example bids. Yours fills in as you finish and send bids.</figcaption>
    </figure>
  );
}

function TemplateExample({ slug }: { slug: string }) {
  const t = getTrade(slug) ?? getTrade("other")!;
  return (
    <figure>
      <div className="grid gap-2 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
        {t.template.groups.map((g) => (
          <div key={g.name} className="rounded-lg bg-black/[0.03] p-3">
            <p className="text-sm font-bold text-ink">{g.name}</p>
            <p className="mt-1 text-xs text-ink-soft">{g.items.map((i) => i.name).join(" · ")}</p>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-xs text-muted">Sections and suggested items from the {t.name} template. Templates never add prices: you enter your own.</figcaption>
    </figure>
  );
}

function PassCard({ sid, invitesOpen, primary, trade, goal }: { sid: string; invitesOpen: boolean; primary: boolean; trade: string; goal: string }) {
  const [email, setEmail] = useState("");
  const [checkins, setCheckins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    const company = (new FormData(e.currentTarget).get("company") as string) || undefined;
    const r = await fetch("/api/bid-check/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, checkins, sid, company }) }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
    setBusy(false);
    if (r?.ok && body?.ok) {
      setDone(true);
      track("bid_check_invite", { trade, goal });
    } else setErr(body?.error?.message ?? "Something went wrong. Please try again.");
  }

  return (
    <div className={cn("rounded-2xl bg-surface p-5", primary ? "border-2 border-accent" : "border border-line")} data-testid="bc-pass">
      <h2 className="font-display text-xl font-extrabold text-ink">{primary ? `Email me my ${TRIAL_DAYS}-day Unlimited pass` : `Bidding more soon? Get ${TRIAL_DAYS} days of Unlimited`}</h2>
      {done ? (
        <div className="mt-3" role="status" data-testid="bc-pass-sent">
          <p className="font-semibold text-ink">Check your email.</p>
          <p className="mt-1 text-ink-soft">If that address can use the pass, your invite is on its way. Open it, tap &quot;Activate my {TRIAL_DAYS} days&quot; and sign in with the same email. Your {TRIAL_DAYS} days start when you activate. Nothing there in a few minutes? Check Spam or Promotions.</p>
        </div>
      ) : !invitesOpen ? (
        <p className="mt-2 text-ink-soft" data-testid="bc-pass-paused">Free passes are paused for the moment. Your free bid works right now, and you can come back for the pass later.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            <li>Unlimited bids, Saved Items &amp; Pricing, and Proposal Templates</li>
            <li>No card, nothing charged. Your {TRIAL_DAYS} days start when you activate.</li>
            <li>Already on a paid plan? Nothing changes, and your saved bids stay put.</li>
          </ul>
          <form onSubmit={submit} className="mt-4 grid gap-3">
            <label htmlFor="bc-email" className="text-sm font-semibold text-ink">Email</label>
            <input id="bc-email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="field -mt-2 min-h-12 rounded-lg border-2 border-line bg-surface px-3 text-base text-ink" placeholder="you@yourcompany.com" data-testid="bc-email" />
            <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
            <label className="flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={checkins} onChange={(e) => setCheckins(e.target.checked)} className="mt-1 h-4 w-4" data-testid="bc-checkins" />
              <span>Also send me two short check-ins during my week (a quick walkthrough on day 2 and a reminder before it ends). Optional.</span>
            </label>
            {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
            <button type="submit" disabled={busy} data-testid="bc-pass-submit"
              className={cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 font-display font-semibold disabled:opacity-60 sm:w-auto sm:justify-self-start",
                primary ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line-strong bg-surface text-ink hover:border-brand/50")}>
              {busy ? "Sending…" : `Email me my ${TRIAL_DAYS}-day pass`}
            </button>
            <p className="text-xs text-muted">One pass per person. We use your email only to send the invite (and the check-ins if you ticked the box). <a href="/privacy" className="underline">Privacy</a></p>
          </form>
        </>
      )}
    </div>
  );
}
