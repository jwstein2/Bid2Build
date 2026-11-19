import { Badge, Card } from "@/components/ui/misc";
import { fmtWhen, SESSIONS, type SessionId } from "@/lib/sales/calendar";
import { reassignBooking } from "./recognition-actions";

export type AdminBooking = { id: string; rep_id: string; rep: string; original_rep: string; session: SessionId; starts_at: string; customer_name: string; customer_company: string | null; reassigned_at: string | null; rep_away: boolean };

/** Upcoming client sessions. Times and names only: reps' private calendars are never shown here. */
export function BookingsPanel({ bookings, reps, canReassign }: { bookings: AdminBooking[]; reps: { id: string; name: string }[]; canReassign: boolean }) {
  const away = bookings.filter((b) => b.rep_away);
  return (
    <Card className="overflow-x-auto">
      <h2 className="p-4 pb-0 text-lg font-bold">Upcoming client sessions</h2>
      <p className="px-4 text-xs text-muted">Booked through reps&apos; links. {away.length > 0 ? `${away.length} fall during the rep's time off and may need a new time or another rep.` : "None fall during anyone's time off."} Reassigning keeps the original rep&apos;s attribution and commissions.</p>
      <table className="mt-2 w-full min-w-[760px] text-sm">
        <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">When (Central)</th><th className="p-3">Session</th><th className="p-3">Customer</th><th className="p-3">Rep</th><th className="p-3"></th></tr></thead>
        <tbody>
          {bookings.slice(0, 40).map((b) => (
            <tr key={b.id} className="border-b border-line align-top last:border-0">
              <td className="p-3">{fmtWhen(b.starts_at, "America/Chicago")}</td>
              <td className="p-3">{SESSIONS[b.session]?.title ?? b.session}</td>
              <td className="p-3">{b.customer_name}{b.customer_company && <p className="text-xs text-muted">{b.customer_company}</p>}</td>
              <td className="p-3">{b.rep}{b.rep_away && <> <Badge tone="warn">Out of office</Badge></>}{b.reassigned_at && <p className="text-xs text-muted">Originally {b.original_rep}</p>}</td>
              <td className="p-3">{canReassign && (
                <form action={reassignBooking} className="flex gap-1"><input type="hidden" name="id" value={b.id} />
                  <select name="rep_id" aria-label="Reassign to" className="min-h-11 rounded-lg border border-line bg-white px-2 text-sm">{reps.filter((r) => r.id !== b.rep_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  <button className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold">Reassign</button></form>)}</td>
            </tr>
          ))}
          {bookings.length === 0 && <tr><td colSpan={5} className="p-4 text-ink-soft">No client sessions booked.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}
