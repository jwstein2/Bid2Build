import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { agendaFor, fmtWhen, hashToken, SESSIONS, slotsByDay, type SessionId } from "@/lib/sales/calendar";
import { loadSlots, zoneOk } from "../../slots";
import { cancelSession, rescheduleSession } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your Built2Bid session", robots: { index: false, follow: false } };

type B = { id: string; session: SessionId; starts_at: string; ends_at: string; status: string; customer_name: string; plan: string | null; rep_first_name: string; slug: string | null; time_zone: string; meeting_link: string | null };
const ERR: Record<string, string> = { taken: "That time was just taken. Pick another.", closed: "This session can't be changed anymore.", slow: "Too many tries. Wait a few minutes.", invalid: "Something didn't match. Try again." };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const { data } = await createAdminClient().rpc("sales_booking_by_token", { p_token_hash: hashToken(token) });
  const b = data as B | null;
  if (!b) notFound();
  const tz = zoneOk(sp.tz, b.time_zone);
  const live = b.status === "booked" && new Date(b.starts_at) > new Date();
  const slots = live && sp.change && b.slug ? (await loadSlots(b.slug)).slots : [];
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm font-extrabold tracking-wide text-brand">BUILT2BID</p>
      {sp.new && <p className="mt-3 rounded-lg border border-ok/40 bg-ok/5 p-3 text-sm font-semibold">You&apos;re booked. Save this page: it&apos;s how you change or cancel.</p>}
      {sp.moved && <p className="mt-3 rounded-lg border border-ok/40 bg-ok/5 p-3 text-sm font-semibold">Moved. Here&apos;s your new time.</p>}
      {sp.err && <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">{ERR[sp.err] ?? ERR.invalid}</p>}
      <h1 className="mt-3 text-3xl font-extrabold">{SESSIONS[b.session].title}</h1>
      {b.status === "canceled" ? (
        <p className="mt-2 text-ink-soft">This session is canceled.{b.slug && <> <Link href={`/meet/${b.slug}`} className="font-semibold underline">Book another time</Link>.</>}</p>
      ) : (
        <>
          <p className="mt-2 text-lg">{fmtWhen(b.starts_at, tz)} <span className="text-sm text-muted">({tz.replace("_", " ")})</span> with {b.rep_first_name}</p>
          {b.meeting_link && <p className="mt-1"><a href={b.meeting_link} className="font-semibold text-brand underline">Join link</a></p>}
          <p className="mt-4 text-sm font-semibold">What we&apos;ll cover</p>
          <ul className="list-disc pl-5 text-sm text-ink-soft">{agendaFor(b.session, b.plan).map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="mt-4"><a href={`/meet/booking/${token}/ics`} className="font-semibold text-brand underline">Add to my calendar (.ics)</a></p>
          {live && !sp.change && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={`/meet/booking/${token}?change=1`} className="min-h-11 rounded-lg border border-line px-4 py-2 font-semibold">Pick a new time</Link>
              <form action={cancelSession} className="flex gap-2"><input type="hidden" name="token" value={token} /><input name="reason" placeholder="Reason (optional)" maxLength={300} className="min-h-11 rounded-lg border border-line px-3 text-sm" /><button className="min-h-11 rounded-lg border border-line px-4 font-semibold">Cancel session</button></form>
            </div>
          )}
          {live && sp.change && (
            <section className="mt-6"><h2 className="font-bold">Pick a new time</h2>
              {slots.length === 0 ? <p className="text-sm text-ink-soft">No other times are open right now.</p> : slotsByDay(slots, tz).slice(0, 10).map((d) => (
                <div key={d.day} className="mt-3"><p className="text-sm font-semibold">{d.label}</p>
                  <div className="mt-1 flex flex-wrap gap-2">{d.times.map((t) => (
                    <form key={t.iso} action={rescheduleSession}><input type="hidden" name="token" value={token} /><input type="hidden" name="at" value={t.iso} /><button className="min-h-11 rounded-lg border border-line px-3 text-sm font-semibold hover:border-brand">{t.label}</button></form>
                  ))}</div>
                </div>
              ))}
              <p className="mt-3"><Link href={`/meet/booking/${token}`} className="text-sm underline">Keep my current time</Link></p>
            </section>
          )}
        </>
      )}
      <p className="mt-10 text-xs text-muted">Questions? <a href="mailto:support@built2bid.org" className="underline">support@built2bid.org</a></p>
    </main>
  );
}
