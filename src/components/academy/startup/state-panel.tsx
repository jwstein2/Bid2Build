import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { KB_STATES, stateName } from "@/lib/academy/kb/location";
import { guideFor } from "@/lib/academy/startup/data";

/**
 * "What your state requires" panel for the trade's Starting a Business course and its lessons. Shows the verified
 * prerequisites and state license status for the visitor's state, with the full step-by-step guide one click away.
 */
export function StateRequirementsPanel({ state, trade, tradeName }: { state: string | null; trade: string; tradeName: string }) {
  const guide = state ? guideFor(state, trade) : null;
  const label = stateName(state) ?? state;
  const full = `/academy/start?state=${state ?? ""}&trade=${trade}`;
  return (
    <section className="mt-6 rounded-xl border border-brand/30 bg-brand-tint/40 p-4" aria-labelledby="state-req-h" data-testid="startup-state-panel">
      <h2 id="state-req-h" className="flex items-center gap-2 font-bold"><MapPin className="h-4 w-4 text-brand" aria-hidden />
        {state ? `What ${label} requires for a ${tradeName.toLowerCase()} business` : `What your state requires for a ${tradeName.toLowerCase()} business`}
      </h2>
      {!state || !guide ? (
        <>
          <p className="mt-1 text-sm text-ink-soft">{state && !guide ? `We're still verifying ${label} from official sources.` : "Licensing rules are set by each state. Pick yours to see what you need first and the steps in order."}</p>
          <form method="get" action="/academy/start" className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="trade" value={trade} />
            <select name="state" defaultValue={state ?? ""} required className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" aria-label="State">
              <option value="" disabled>Choose your state</option>
              {KB_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">Show requirements</button>
          </form>
        </>
      ) : (
        <>
          {guide.prerequisites.length === 0 && guide.coreUnconfirmed ? (
            <p className="mt-2 text-sm text-ink-soft">We haven&apos;t confirmed {label}&apos;s license requirements for this work yet. Check with the state licensing agency before you start.</p>
          ) : guide.prerequisites.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Based on what we&apos;ve confirmed, {label} doesn&apos;t require a state license or certificate before you start. Your city or county still may.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {guide.prerequisites.slice(0, 4).map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="font-semibold text-ink">{p.title}</span>{" "}
                  {p.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Being confirmed</Badge>}
                  {p.when && <span className="block text-ink-soft">Needed {p.when.charAt(0).toLowerCase() + p.when.slice(1)}.</span>}
                  {p.items.length > 0 && <span className="block text-ink-soft">{p.items.slice(0, 3).join(" · ")}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={full} className="font-semibold text-brand hover:underline">See every step for {label}</Link>
            <Link href={`/academy/start?trade=${trade}#startup-form`} className="text-muted hover:underline">Change state</Link>
          </p>
        </>
      )}
    </section>
  );
}
