import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { StatusPill, field, label } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { loadAdvSettings, loadStages } from "@/lib/academy/advanced/server";
import { isAdvancedBillingEnabled, isAdvancedFlagOn, isAutoAdvanceAllowed, stripeMode } from "@/lib/academy/advanced/flags";
import { ADV_PLANS, PLAN_META, stageDelta, stagePrice, stageRecommendation, usd } from "@/lib/academy/advanced/plans";
import { addPrice, approveStage, deactivatePrice, grantAccess, provisionPrices, resolveIssue, revokeGrant, saveAdvSettings, saveSubject, setFounding } from "./actions";

// Depends on the visitor (staff preview, membership) and on switches that change at runtime.
export const dynamic = "force-dynamic";

type Summary = Record<string, number> & { by_plan: Record<string, number>; by_stage: Record<string, number> };
const card = "rounded-xl border border-line bg-surface p-5 shadow-card";
const h2 = "font-display text-lg font-extrabold";
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
/** Card processing estimate only (2.9% + 30¢ per paid invoice). Real fees are in Stripe → Balance. */
const feeEstimate = (cents: number, invoices: number) => Math.round(cents * 0.029 + invoices * 30);

function Tile({ k, v, hint, warn }: { k: string; v: string | number; hint?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-card ${warn ? "border-warn/50" : "border-line"}`}>
      <span className="block text-xs font-semibold text-muted">{k}</span>
      <span className="mt-1 block font-display text-2xl font-extrabold">{typeof v === "number" ? v.toLocaleString("en-US") : v}</span>
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

export default async function ManageAdvanced({ searchParams }: PageProps<"/academy/manage/advanced">) {
  const s = await requireAcademyStaff(["admin"]);
  if (!s) notFound();
  const sp = await searchParams;
  const settings = await loadAdvSettings();
  if (!settings) {
    return <div className={card}><h2 className={h2}>Advanced Learning isn&apos;t set up yet</h2><p className="mt-2 text-sm text-ink-soft">Run the SQL migration <code>20270303001000_academy_advanced.sql</code> (then the seed <code>20270303002000</code>) in the Supabase SQL Editor, then reload this page.</p></div>;
  }
  const db = createAdminClient();
  const viewMode = sp.mode === "test" || sp.mode === "live" ? sp.mode : stripeMode() ?? "test";
  const lookup = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const [stages, sum, lib, subjects, prices, grants, issues, members, founding, foundUser] = await Promise.all([
    loadStages(),
    db.rpc("academy_adv_admin_summary", { p_mode: viewMode }).then((r) => (r.data ?? {}) as Summary),
    db.rpc("academy_adv_library").then((r) => ((r.data as { subjects: number; lessons: number; paid_lessons: number }[] | null)?.[0] ?? { subjects: 0, lessons: 0, paid_lessons: 0 })),
    db.from("academy_adv_subjects").select("slug, title, status, recommended_next, recommend_reason, sort_order").order("sort_order").then((r) => r.data ?? []),
    db.from("academy_adv_prices").select("id, mode, plan, stage, billing_interval, amount_cents, stripe_price_id, active, created_at").order("mode").order("stage").order("plan").then((r) => r.data ?? []),
    db.from("academy_adv_grants").select("id, user_id, scope, subjects, expires_at, reason, created_at").is("revoked_at", null).order("created_at", { ascending: false }).limit(50).then((r) => r.data ?? []),
    db.from("academy_adv_issues").select("id, kind, ref, user_id, details, created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(50).then((r) => r.data ?? []),
    db.from("academy_adv_memberships").select("id, user_id, plan, subjects, stage, amount_cents, status, cancel_at_period_end, current_period_end, created_at").eq("mode", viewMode).order("created_at", { ascending: false }).limit(25).then((r) => r.data ?? []),
    db.from("academy_adv_founding").select("user_id, position, stage_at_join, status, disqualified_reason, first_paid_at").eq("mode", viewMode).order("position", { ascending: false }).limit(25).then((r) => r.data ?? []),
    lookup ? db.rpc("academy_adv_find_user", { p_email: lookup }).then((r) => (r.data as string | null) ?? null) : Promise.resolve(null),
  ]);
  const customer = foundUser
    ? await Promise.all([
        db.rpc("academy_adv_access", { p_user_id: foundUser }).then((r) => r.data),
        db.from("academy_adv_memberships").select("plan, subjects, status, amount_cents, stage, mode, current_period_end, cancel_at_period_end, stripe_subscription_id").eq("user_id", foundUser).order("created_at", { ascending: false }).then((r) => r.data ?? []),
        db.from("academy_adv_founding").select("mode, position, status, stage_at_join").eq("user_id", foundUser).then((r) => r.data ?? []),
      ])
    : null;

  const rec = stageRecommendation(stages, settings.current_stage, sum.qualifying ?? 0, lib.lessons);
  const mapped = (mode: string, stage: number) => ADV_PLANS.every((p) => prices.some((x) => x.active && x.mode === mode && x.stage === stage && x.plan === p && x.billing_interval === "month"));
  const flags = { enabled: isAdvancedFlagOn(), billing: isAdvancedBillingEnabled(), auto: isAutoAdvanceAllowed() };
  const pubSubjects = subjects.filter((x) => x.status === "published");
  const fees = feeEstimate(sum.paid_30d_cents ?? 0, sum.paid_invoices_30d ?? 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6" data-testid="adv-admin">
      <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold">Advanced Learning</h2>
          <p className="text-sm text-ink-soft">Paid Academy memberships, founding-member pricing and subject pairings. <Link href="/academy/advanced" className="font-semibold text-accent-ink underline">Open the public page</Link></p>
        </div>
        <nav className="flex gap-1 text-sm" aria-label="Stripe mode">
          {(["test", "live"] as const).map((m) => <Link key={m} href={`?mode=${m}`} className={`rounded-md px-3 py-1.5 font-semibold ${viewMode === m ? "bg-navy text-white" : "border border-line text-ink-soft"}`}>{m === "test" ? "Test mode" : "Live mode"}</Link>)}
        </nav>
      </div>

      <div className="flex flex-wrap gap-2 text-xs" aria-label="Switches">
        {[
          ["ACADEMY_ADVANCED_ENABLED", flags.enabled], ["Shown to everyone (setting)", settings.enabled], ["ACADEMY_ADVANCED_BILLING_ENABLED", flags.billing],
          ["Enrollment open", settings.enrollment_open], ["ACADEMY_PRICE_AUTO_ADVANCE_ENABLED", flags.auto], ["Auto-advance (setting)", settings.auto_advance],
        ].map(([k, v]) => <span key={String(k)} className={`rounded-full px-2.5 py-1 font-semibold ${v ? "bg-ok-tint text-ok" : "bg-black/5 text-ink-soft"}`}>{String(k)}: {v ? "on" : "off"}</span>)}
        <span className="rounded-full bg-black/5 px-2.5 py-1 font-semibold text-ink-soft">This deploy&apos;s Stripe key: {stripeMode() ?? "none"}</span>
      </div>

      <section aria-labelledby="m-h">
        <h2 id="m-h" className={h2}>Membership ({viewMode} mode)</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile k="Active members" v={sum.members ?? 0} />
          <Tile k="Monthly recurring revenue" v={usd(sum.mrr_cents ?? 0)} hint="Before tax, fees and refunds" />
          <Tile k="Qualifying founding members" v={sum.qualifying ?? 0} hint={`${sum.founding_total ?? 0} ever paid · ${sum.founding_disqualified ?? 0} not counted · basis: ${settings.count_basis}`} />
          <Tile k="Current price stage" v={`Stage ${settings.current_stage}`} hint={`${usd(stagePrice(rec.current, "one_subject"))} / ${usd(stagePrice(rec.current, "two_subjects"))} / ${usd(stagePrice(rec.current, "all_access"))}`} />
          {ADV_PLANS.map((p) => <Tile key={p} k={PLAN_META[p].name} v={sum.by_plan?.[p] ?? 0} hint="active members" />)}
          <Tile k="Estimator seats (All Access)" v={sum.all_access_members ?? 0} hint="Individual Unlimited via All Access" />
          <Tile k="Collected, last 30 days" v={usd(sum.paid_30d_cents ?? 0)} hint={`${sum.paid_invoices_30d ?? 0} paid invoices`} />
          <Tile k="Processing fees, last 30 days" v={`≈ ${usd(fees)}`} hint="Estimate (2.9% + 30¢). Actual fees are in Stripe." />
          <Tile k="Refunded (all time)" v={usd(sum.refunded_cents ?? 0)} warn={(sum.refunded_cents ?? 0) > 0} />
          <Tile k="Failed payments, 30 days" v={sum.failed_30d ?? 0} hint={`${sum.past_due ?? 0} past due now`} warn={(sum.failed_30d ?? 0) > 0} />
          <Tile k="Disputes" v={sum.disputes_open ?? 0} hint={`${sum.disputes_lost ?? 0} lost`} warn={(sum.disputes_open ?? 0) > 0} />
          <Tile k="Churned, 30 days" v={sum.churned_30d ?? 0} hint={`${sum.canceling ?? 0} set to cancel at period end`} />
          <Tile k="Upgrades / conversions" v={`${sum.upgrades ?? 0} / ${sum.conversions ?? 0}`} hint="Upgrades · Individual Unlimited → All Access" />
          <Tile k="Learners, 30 days" v={sum.learners_30d ?? 0} hint={`${sum.completions_30d ?? 0} advanced lessons finished`} />
          <Tile k="Open price holds" v={sum.open_quotes ?? 0} hint="Quotes reserving a founding price" />
          <Tile k="AI cost" v="Not tracked separately" hint="Academy lessons make no AI calls. Estimator AI use counts in the normal AI usage report." />
        </div>
        {Object.keys(sum.by_stage ?? {}).length > 0 && (
          <p className="mt-3 text-sm text-ink-soft">Cohorts by founding stage: {Object.entries(sum.by_stage).sort().map(([k, v]) => `stage ${k === "0" ? "?" : k}: ${v}`).join(" · ")}</p>
        )}
      </section>

      <section aria-labelledby="st-h" className={card}>
        <h2 id="st-h" className={h2}>Founding-member price stage</h2>
        <p className="mt-1 text-sm text-ink-soft">One shared count of unique paying members across all three packages. Members keep the rate they joined at while they stay on their package without a break. Changing the stage only affects new members.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Stage</th><th>Members</th><th>One subject</th><th>Two subjects</th><th>All Access</th><th>Lessons needed</th><th>Stripe prices ({viewMode})</th></tr></thead>
            <tbody>
              {stages.map((x) => (
                <tr key={x.stage} className={`border-t border-line ${x.stage === settings.current_stage ? "bg-brand-tint/40 font-semibold" : ""}`}>
                  <td className="py-1.5">{x.stage}{x.stage === settings.current_stage ? " (current)" : ""}</td>
                  <td>{x.min_members}{x.max_members ? `–${x.max_members}` : "+"}</td>
                  <td>{usd(x.one_subject_cents)}</td><td>{usd(x.two_subjects_cents)}</td><td>{usd(x.all_access_cents)}</td>
                  <td>{x.min_published_lessons}</td>
                  <td>{mapped(viewMode, x.stage) ? <span className="text-ok">mapped</span> : <span className="text-warn">missing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg bg-paper p-3 text-sm" data-testid="stage-recommendation">
          {rec.next ? (
            <>
              <p><b>{rec.recommend ? `Ready for stage ${rec.next.stage}.` : `Not ready for stage ${rec.next.stage} yet.`}</b>{" "}
                Members: {sum.qualifying ?? 0} of {rec.current.max_members ?? "∞"} {rec.membersReady ? "✓" : `(${rec.membersNeeded} to go)`} · Published lessons: {lib.lessons} of {rec.next.min_published_lessons} {rec.libraryReady ? "✓" : `(${rec.lessonsNeeded} to go)`}</p>
              <p className="mt-1 text-ink-soft">Price change for new members: {stageDelta(rec.current, rec.next).map((d) => `${PLAN_META[d.plan].short} ${usd(d.from)} → ${usd(d.to)} (+${d.pct}%)`).join(" · ")}</p>
            </>
          ) : <p>This is the last stage.</p>}
        </div>
        <form action={approveStage} className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className={label}>Stage<select name="stage" defaultValue={rec.next?.stage ?? settings.current_stage} className={field}>{stages.map((x) => <option key={x.stage} value={x.stage}>Stage {x.stage}</option>)}</select></label>
          <label className={label}>Note for the audit log<input name="note" maxLength={500} className={field} placeholder="Why now" /></label>
          <Submit>Approve stage</Submit>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="confirm" /> I understand new members will see this stage&apos;s prices right away.</label>
        </form>
      </section>

      <section aria-labelledby="set-h" className={card}>
        <h2 id="set-h" className={h2}>Controls</h2>
        <form action={saveAdvSettings} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Show Advanced Learning to everyone (also needs ACADEMY_ADVANCED_ENABLED)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enrollment_open" defaultChecked={settings.enrollment_open} /> Enrollment open (off pauses new sign-ups; members keep access)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto_advance" defaultChecked={settings.auto_advance} /> Advance the stage automatically at thresholds (also needs ACADEMY_PRICE_AUTO_ADVANCE_ENABLED)</label>
          <label className={label}>Count members by<select name="count_basis" defaultValue={settings.count_basis} className={field}><option value="lifetime">Everyone who ever paid (recommended)</option><option value="active">Only currently active members</option></select></label>
          <label className={label}>Hold a quoted price for (minutes)<input name="reservation_minutes" type="number" min={31} max={120} defaultValue={settings.reservation_minutes} className={field} /></label>
          <div className="flex items-end justify-end"><Submit>Save controls</Submit></div>
        </form>
      </section>

      <section aria-labelledby="sub-h" className={card}>
        <h2 id="sub-h" className={h2}>Subjects and pairings</h2>
        <p className="mt-1 text-sm text-ink-soft">The pairing is the second subject recommended in the &quot;Learn + Expand&quot; option. A subject is only sold when it is Published here <em>and</em> its course is published in <Link href="/academy/manage/courses" className="underline">Courses</Link> with a free preview lesson.</p>
        <ul className="mt-3 grid gap-3">
          {subjects.map((x) => (
            <li key={x.slug} className="rounded-lg border border-line p-3">
              <form action={saveSubject} className="grid gap-2 md:grid-cols-[1.3fr_0.8fr_1fr_2fr_0.5fr_auto] md:items-end">
                <input type="hidden" name="slug" value={x.slug} />
                <div><span className="block text-sm font-bold">{x.title}</span><StatusPill status={x.status} /></div>
                <label className={label}>Status<select name="status" defaultValue={x.status} className={field}>{["draft", "upcoming", "published", "retired"].map((o) => <option key={o}>{o}</option>)}</select></label>
                <label className={label}>Pair with<select name="recommended_next" defaultValue={x.recommended_next ?? ""} className={field}><option value="">None</option>{subjects.filter((o) => o.slug !== x.slug).map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}</select></label>
                <label className={label}>Why (shown to customers)<input name="recommend_reason" maxLength={240} defaultValue={x.recommend_reason ?? ""} className={field} /></label>
                <label className={label}>Order<input name="sort_order" type="number" defaultValue={x.sort_order} className={field} /></label>
                <Submit size="sm">Save</Submit>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pr-h" className={card}>
        <h2 id="pr-h" className={h2}>Stripe prices</h2>
        <p className="mt-1 text-sm text-ink-soft">Prices live in Stripe and are mapped here, never in code. Create them on a <b>preview deploy</b> (it uses the test key). Live products and prices need the owner&apos;s approval and <code>ACADEMY_ADVANCED_PROVISION_LIVE=true</code>.</p>
        <form action={provisionPrices} className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dry_run" defaultChecked /> Dry run (show what would change)</label>
          <Submit variant="secondary" pending="Talking to Stripe…">Create {stripeMode() ?? "test"}-mode products and prices</Submit>
        </form>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Mode</th><th>Stage</th><th>Package</th><th>Amount</th><th>Stripe price</th><th>Status</th><th /></tr></thead>
            <tbody>
              {prices.length === 0 && <tr><td colSpan={7} className="py-2 text-ink-soft">No prices mapped yet.</td></tr>}
              {prices.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="py-1.5">{x.mode}</td><td>{x.stage}</td><td>{PLAN_META[x.plan as keyof typeof PLAN_META]?.name ?? x.plan}</td><td>{usd(x.amount_cents)}/{x.billing_interval}</td>
                  <td><code className="text-xs">{x.stripe_price_id}</code></td><td>{x.active ? "active" : "inactive"}</td>
                  <td>{x.active && <form action={deactivatePrice}><input type="hidden" name="id" value={x.id} /><Submit size="sm" variant="ghost" pending="…">Deactivate</Submit></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Map an existing Stripe price by hand</summary>
          <form action={addPrice} className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
            <label className={label}>Package<select name="plan" className={field}>{ADV_PLANS.map((p) => <option key={p} value={p}>{PLAN_META[p].name}</option>)}</select></label>
            <label className={label}>Stage<select name="stage" className={field}>{stages.map((x) => <option key={x.stage} value={x.stage}>{x.stage}</option>)}</select></label>
            <label className={label}>Stripe price id<input name="price_id" pattern="price_[A-Za-z0-9]+" required className={field} /></label>
            <Submit size="sm">Verify and map</Submit>
          </form>
          <p className="mt-1 text-xs text-muted">Checked against Stripe first: it must be active, monthly, USD and exactly the stage price.</p>
        </details>
      </section>

      <section aria-labelledby="lk-h" className={card}>
        <h2 id="lk-h" className={h2}>Customer lookup</h2>
        <form className="mt-2 flex gap-2"><input type="hidden" name="mode" value={viewMode} /><input name="q" type="email" defaultValue={lookup} placeholder="customer@example.com" className={field} /><Submit variant="secondary" pending="Looking…">Look up</Submit></form>
        {lookup && !foundUser && <p className="mt-2 text-sm text-ink-soft">No account uses that email.</p>}
        {customer && (
          <div className="mt-3 grid gap-2 text-sm" data-testid="adv-customer">
            <p><b>Access:</b> {JSON.stringify(customer[0])}</p>
            <p><b>Memberships:</b> {customer[1].length ? customer[1].map((m) => `${m.mode} ${m.plan} [${(m.subjects as string[]).join(", ")}] ${m.status}${m.cancel_at_period_end ? " (cancels)" : ""} ${usd(m.amount_cents ?? 0)} stage ${m.stage ?? "?"} until ${fmtDate(m.current_period_end)} · ${m.stripe_subscription_id}`).join(" | ") : "none"}</p>
            <p><b>Founding:</b> {customer[2].length ? customer[2].map((f) => `${f.mode} #${f.position} (${f.status}, joined stage ${f.stage_at_join})`).join(" | ") : "not a founding member"}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="gr-h" className={card}>
        <h2 id="gr-h" className={h2}>Complimentary course access</h2>
        <p className="mt-1 text-sm text-ink-soft">For staff, partners and make-goods. Grants open lessons only. They never include Individual Unlimited software and don&apos;t count as founding members.</p>
        <form action={grantAccess} className="mt-3 grid gap-2 md:grid-cols-2">
          <label className={label}>Customer email<input name="email" type="email" required className={field} /></label>
          <label className={label}>Reason<input name="reason" required minLength={3} maxLength={300} className={field} /></label>
          <label className={label}>Access<select name="scope" className={field}><option value="subjects">Selected subjects</option><option value="all_access">Every advanced subject</option></select></label>
          <label className={label}>Days (0 = no end date)<input name="days" type="number" min={0} max={3650} defaultValue={90} className={field} /></label>
          <fieldset className="md:col-span-2"><legend className="text-sm font-semibold">Subjects</legend>
            <div className="mt-1 flex flex-wrap gap-3">{pubSubjects.map((x) => <label key={x.slug} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="subjects" value={x.slug} /> {x.title}</label>)}</div>
          </fieldset>
          <div className="md:col-span-2 flex justify-end"><Submit>Grant access</Submit></div>
        </form>
        {grants.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{g.scope === "all_access" ? "All subjects" : (g.subjects as string[]).join(", ")} · {g.reason} · {g.expires_at ? `until ${fmtDate(g.expires_at)}` : "no end date"} · <code className="text-xs">{String(g.user_id).slice(0, 8)}</code></span>
                <form action={revokeGrant}><input type="hidden" name="id" value={g.id} /><Submit size="sm" variant="ghost" pending="…">Revoke</Submit></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="is-h" className={card}>
        <h2 id="is-h" className={h2}>Reconciliation issues ({issues.length})</h2>
        <p className="mt-1 text-sm text-ink-soft">Things the webhook couldn&apos;t match automatically (unknown prices, missing users, failed conversions). Fix them in Stripe, then mark them resolved.</p>
        {issues.length === 0 ? <p className="mt-2 text-sm text-ok">Nothing to reconcile.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span><b>{i.kind}</b> {i.ref && <code className="text-xs">{i.ref}</code>} · {fmtDate(i.created_at)}<br /><span className="text-xs text-muted">{JSON.stringify(i.details).slice(0, 300)}</span></span>
                <form action={resolveIssue}><input type="hidden" name="id" value={i.id} /><Submit size="sm" variant="secondary" pending="…">Resolved</Submit></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fm-h" className={card}>
        <h2 id="fm-h" className={h2}>Recent members and founding list ({viewMode})</h2>
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <ul className="divide-y divide-line text-sm">
            {members.length === 0 && <li className="py-2 text-ink-soft">No memberships yet.</li>}
            {members.map((m) => <li key={m.id} className="py-1.5">{PLAN_META[m.plan as keyof typeof PLAN_META]?.name} · {(m.subjects as string[]).join(", ") || "all"} · {usd(m.amount_cents ?? 0)} · stage {m.stage ?? "?"} · <StatusPill status={m.status} />{m.cancel_at_period_end ? " cancels" : ""}</li>)}
          </ul>
          <ul className="divide-y divide-line text-sm">
            {founding.length === 0 && <li className="py-2 text-ink-soft">No founding members yet.</li>}
            {founding.map((f) => (
              <li key={f.user_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>#{f.position} · stage {f.stage_at_join} · {fmtDate(f.first_paid_at)} · {f.status}{f.disqualified_reason ? ` (${f.disqualified_reason})` : ""}</span>
                <form action={setFounding} className="flex items-center gap-1">
                  <input type="hidden" name="user_id" value={f.user_id} /><input type="hidden" name="mode" value={viewMode} />
                  <select name="reason" aria-label="Founding status" className="rounded border border-line px-1 py-0.5 text-xs">
                    {f.status === "qualifying" ? <><option value="duplicate">Duplicate</option><option value="fraud">Fraud</option><option value="test">Test account</option><option value="admin">Other</option></> : <option value="restore">Count again</option>}
                  </select>
                  <Submit size="sm" variant="ghost" pending="…">{f.status === "qualifying" ? "Don't count" : "Restore"}</Submit>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
