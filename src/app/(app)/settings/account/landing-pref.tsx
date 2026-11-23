import { ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { landingLabel, type Landing, type Workspaces } from "@/lib/workspaces";
import { saveLanding } from "./landing-actions";

/**
 * "When I sign in, open…" for people with more than one workspace (contractor dashboard + Sales Hub).
 * A preference for a workspace they lose later falls back to one they still have.
 */
export function LandingPreference({ ws }: { ws: Workspaces }) {
  const options: Landing[] = ["auto", "contractor", "sales"];
  return (
    <Card className="p-5" data-testid="landing-pref">
      <h2 className="flex items-center gap-2 font-bold"><ArrowLeftRight className="h-4 w-4 text-brand" aria-hidden /> Workspaces</h2>
      <p className="text-sm text-ink-soft">Your one Built2Bid login opens your Contractor Dashboard and your Sales Hub. Switch any time from the account menu without signing in again.</p>
      <form action={saveLanding} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          When I sign in, open
          <select name="landing" defaultValue={ws.landing} className="mt-1 block min-h-11 rounded-lg border border-line bg-surface px-3 text-sm font-normal">
            {options.map((o) => <option key={o} value={o}>{landingLabel(o, ws)}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink/90 active:scale-[0.98]">Save</button>
      </form>
    </Card>
  );
}
