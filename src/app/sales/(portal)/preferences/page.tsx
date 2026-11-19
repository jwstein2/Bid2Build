import { Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { LAYOUTS, preferenceSummary, QUESTIONS, recommendedLayout, type Answers } from "@/lib/sales/preferences";
import { clearPreferences, savePreferences } from "./actions";

export const metadata = { title: "My preferences" };

interface Prefs { status: string; answers: Answers; public_recognition: boolean; congrats_email: boolean; share_interests: boolean; dashboard_layout: string | null; animations: boolean }

const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold";
const input = "mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";

export default async function PreferencesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_preferences");
  if (error || !data) return <Notice title="Preferences are getting set up">Check back in a little while.</Notice>;
  const p = data as Prefs;
  const a = p.answers ?? {};
  const rec = recommendedLayout(a);
  const summary = preferenceSummary(a);
  const has = (id: string, v: string) => (Array.isArray(a[id]) ? (a[id] as string[]).includes(v) : a[id] === v);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">My preferences</h1>
        <p className="mt-1 text-ink-soft">Tell us how you like to work and be recognized, so the Sales Hub fits you. Every question is optional, and you can skip the whole thing.</p>
      </div>
      {sp.ok === "saved" && <Notice tone="ok">Saved. You can change these any time.</Notice>}
      {sp.ok === "skipped" && <Notice tone="ok">No problem. Nothing changes about your pay, leads or access. Come back whenever you like.</Notice>}
      {sp.ok === "cleared" && <Notice tone="ok">Your answers are deleted. Your display and email choices are kept.</Notice>}
      {sp.err && <Notice tone="danger">That didn&apos;t save. Try again.</Notice>}

      <Card className="p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">How we use this</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Only to choose how your dashboard is laid out, how we celebrate wins with you, and which rewards to suggest.</li>
          <li>It never affects your commissions, leads, opportunities or any decision about you. There is no score and no personality type.</li>
          <li>Admins see only how you like to be recognized, the rewards you&apos;d enjoy, and your hobbies if you choose to share them. Your other answers stay with you.</li>
          <li>This is a preferences form, not a psychological or clinical assessment.</li>
        </ul>
      </Card>

      {summary.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Your summary</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {summary.map((s) => <div key={s.label}><dt className="text-muted">{s.label}</dt><dd className="font-semibold">{s.value}</dd></div>)}
            <div><dt className="text-muted">Public recognition</dt><dd className="font-semibold">{p.public_recognition ? "Yes" : "Private only"}</dd></div>
            <div><dt className="text-muted">Owner congratulation emails</dt><dd className="font-semibold">{p.congrats_email ? "Yes" : "Off"}</dd></div>
          </dl>
        </Card>
      )}

      <form action={savePreferences} className="space-y-6">
        <Card className="space-y-4 p-5">
          <h2 className="text-lg font-bold">Display and privacy</h2>
          <fieldset>
            <legend className="text-sm font-semibold">Dashboard layout</legend>
            <p className="text-xs text-muted">Changes only the order. Every section, including your earnings, is always there.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
                <input type="radio" name="layout" value="" defaultChecked={!p.dashboard_layout} className="mt-1" />
                <span><span className="font-semibold">Recommended</span><span className="block text-xs text-muted">{LAYOUTS.find((l) => l.v === rec)?.label}, from your answers</span></span>
              </label>
              {LAYOUTS.map((l) => (
                <label key={l.v} className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
                  <input type="radio" name="layout" value={l.v} defaultChecked={p.dashboard_layout === l.v} className="mt-1" />
                  <span><span className="font-semibold">{l.label}</span><span className="block text-xs text-muted">{l.help}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="public_recognition" defaultChecked={p.public_recognition} className="mt-1" /> Include me in team celebrations others can see</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="congrats_email" defaultChecked={p.congrats_email} className="mt-1" /> Send me congratulation emails from the owner</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="share_interests" defaultChecked={p.share_interests} className="mt-1" /> Let admins see my hobbies and interests (for picking rewards)</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="animations" defaultChecked={p.animations} className="mt-1" /> Play celebration animations (your device&apos;s reduced-motion setting always wins)</label>
        </Card>

        <Card className="space-y-6 p-5">
          <h2 className="text-lg font-bold">Work preferences <span className="text-sm font-normal text-muted">(optional)</span></h2>
          {QUESTIONS.map((q, i) => (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-sm font-semibold">{i + 1}. {q.text}</legend>
              {q.help && <p className="text-xs text-muted">{q.help}</p>}
              {q.kind === "text" ? (
                <textarea name={q.id} maxLength={q.max} rows={q.max > 200 ? 3 : 1} defaultValue={typeof a[q.id] === "string" ? (a[q.id] as string) : ""} aria-label={q.text} className={input} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <label key={o.v} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/5">
                      <input type={q.kind === "one" ? "radio" : "checkbox"} name={q.id} value={o.v} defaultChecked={has(q.id, o.v)} />{o.label}
                    </label>
                  ))}
                  {q.kind === "many" && <p className="w-full text-xs text-muted">Pick up to {q.max}.</p>}
                </div>
              )}
            </fieldset>
          ))}
        </Card>

        <div className="flex flex-wrap gap-3">
          <button name="intent" value="save" className={btn}>Save preferences</button>
          <button name="intent" value="skip" className={btnLight}>Skip for now</button>
        </div>
      </form>

      {Object.keys(a).length > 0 && (
        <form action={clearPreferences} className="border-t border-line pt-4">
          <button className="text-sm font-semibold text-danger underline">Delete my answers</button>
          <p className="text-xs text-muted">Removes every survey answer, including hobbies and notes.</p>
        </form>
      )}
    </div>
  );
}
