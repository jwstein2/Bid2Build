import Link from "next/link";
import { notFound } from "next/navigation";
import { agendaFor, fmtWhen, SESSIONS, slotsByDay, type SessionId } from "@/lib/sales/calendar";
import { loadSlots, US_ZONES, zoneOk } from "../slots";
import { bookSession } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book an onboarding session", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  taken: "Someone just took that time. Pick another.", too_many: "You already have three upcoming sessions booked.", contact: "Add your name and a valid email.",
  slow: "Too many tries. Wait a few minutes and try again.", invalid: "Something didn't match. Pick a time again.",
};
const input = "mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

export default async function MeetPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9-]{3,40}$/i.test(slug)) notFound();
  const { page, slots } = await loadSlots(slug.toLowerCase());
  if (!page) notFound();
  const tz = zoneOk(sp.tz, page.time_zone);
  const session = (["win", "run", "grow"] as const).find((s) => s === sp.session) as SessionId | undefined;
  const at = sp.at && slots.includes(sp.at) ? sp.at : null;
  const q = (o: Record<string, string>) => `/meet/${slug}?${new URLSearchParams({ ...(sp.tz ? { tz } : {}), ...o })}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm font-extrabold tracking-wide text-brand">BUILT2BID</p>
      <h1 className="mt-2 text-3xl font-extrabold">Book a session with {page.first_name}</h1>
      <p className="mt-1 text-ink-soft">Free {page.session_minutes}-minute onboarding sessions to help you get the most out of Built2Bid.</p>
      {sp.err && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">{ERRORS[sp.err] ?? ERRORS.invalid}</p>}
      {!page.enabled || slots.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line p-4">No times are open right now. Email <a className="font-semibold underline" href="mailto:support@built2bid.org">support@built2bid.org</a> and we&apos;ll help.</p>
      ) : (
        <>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {(Object.keys(SESSIONS) as SessionId[]).map((s, i) => (
              <li key={s}>
                <Link href={q({ session: s })} aria-current={session === s ? "true" : undefined} className={`block h-full rounded-xl border p-4 ${session === s ? "border-brand ring-2 ring-brand/30" : "border-line"}`}>
                  <p className="text-xs font-semibold text-muted">Session {i + 1}</p><p className="font-bold">{SESSIONS[s].title}</p><p className="mt-1 text-sm text-ink-soft">{SESSIONS[s].summary}</p>
                </Link>
              </li>
            ))}
          </ol>
          {session && !at && (
            <section className="mt-8" aria-labelledby="times-h">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 id="times-h" className="text-lg font-bold">Pick a time</h2>
                <form className="text-sm"><input type="hidden" name="session" value={session} />
                  <label>Times in <select name="tz" defaultValue={tz} className="rounded border border-line px-2 py-1">{US_ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label> <button className="underline">Update</button>
                </form>
              </div>
              <div className="mt-3 space-y-4">
                {slotsByDay(slots, tz).slice(0, 14).map((d) => (
                  <div key={d.day}><p className="text-sm font-semibold">{d.label}</p>
                    <div className="mt-1 flex flex-wrap gap-2">{d.times.map((t) => <Link key={t.iso} href={q({ session, at: t.iso })} className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-brand">{t.label}</Link>)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {session && at && (
            <section className="mt-8 rounded-xl border border-line p-5" aria-labelledby="confirm-h">
              <h2 id="confirm-h" className="text-lg font-bold">{SESSIONS[session].title}: {fmtWhen(at, tz)}</h2>
              <p className="text-sm text-muted"><Link href={q({ session })} className="underline">Pick a different time</Link></p>
              <p className="mt-3 text-sm font-semibold">What we&apos;ll cover</p>
              <ul className="list-disc pl-5 text-sm text-ink-soft">{agendaFor(session, null).map((a) => <li key={a}>{a}</li>)}</ul>
              <p className="mt-1 text-xs text-muted">If you&apos;re already a customer, we&apos;ll focus on what&apos;s in your plan.</p>
              <form action={bookSession} className="mt-4 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="session" value={session} /><input type="hidden" name="at" value={at} />
                <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <label className="text-sm">Your name<input name="name" required maxLength={120} autoComplete="name" className={input} /></label>
                <label className="text-sm">Email<input name="email" type="email" required maxLength={320} autoComplete="email" className={input} /></label>
                <label className="text-sm sm:col-span-2">Company (optional)<input name="company" maxLength={200} autoComplete="organization" className={input} /></label>
                <label className="text-sm sm:col-span-2">Anything you&apos;d like to cover? (optional)<textarea name="notes" rows={3} maxLength={1000} className={`${input} py-2`} /></label>
                <div className="sm:col-span-2"><button className="min-h-11 rounded-lg bg-ink px-5 font-semibold text-white">Book this time</button></div>
              </form>
              <p className="mt-2 text-xs text-muted">We use your email only to confirm and manage this session.</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
