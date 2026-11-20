import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { Flash, btn, fmtDate, input } from "@/components/creator/flash";
import { CONSENT_PERMISSIONS, SHARE_PERMISSIONS, daysRemaining } from "@/lib/creator/program";
import { saveConsent, shareBid, unshareBid } from "./actions";

export const metadata: Metadata = { title: "Mentorship", robots: { index: false } };

type Membership = {
  program_id: string; workspace_name: string; channel_name: string | null; state: string; program_state: string; expires_at: string | null;
  consent: { allow_comments: boolean; allow_suggestions: boolean; share_pipeline_summary: boolean } | null;
  shares: { id: string; estimate_id: string; title: string | null; share_costs: boolean; share_margin: boolean; share_project_info: boolean; shared_at: string; unread: number }[];
};
type Resource = { id: string; kind: string; title: string; url: string | null; body: string | null; checklist: string[] | null };

export default async function MentorshipPage({ searchParams }: PageProps<"/mentorship">) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login?next=/mentorship");
  const db = await createClient();
  const { data, error } = await db.rpc("my_mentorship");
  const memberships = (error ? [] : (data ?? [])) as Membership[];
  if (!memberships.length) {
    return <div className="mx-auto max-w-2xl"><h1 className="text-2xl font-extrabold">Mentorship</h1><Notice className="mt-4">You don&apos;t have a gifted membership from a Built2Bid creator partner.</Notice></div>;
  }
  const m = memberships[0];
  const active = m.state === "active" && m.program_state === "active";
  const [{ data: bids }, { data: res }] = await Promise.all([
    db.from("estimates").select("id, title, updated_at").eq("user_id", user.id).neq("status", "archived").order("updated_at", { ascending: false }).limit(100),
    active ? db.rpc("program_resources", { p_program_id: m.program_id }) : Promise.resolve({ data: [] }),
  ]);
  const resources = (res ?? []) as Resource[];
  const days = daysRemaining(m.expires_at);
  const msg = typeof sp.msg === "string" ? sp.msg : undefined;
  const err = typeof sp.err === "string" ? sp.err : undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">Gifted by {m.channel_name ?? m.workspace_name}</p>
      <h1 className="text-2xl font-extrabold">Mentorship</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {active ? `Your complimentary Individual Unlimited membership runs through ${fmtDate(m.expires_at)}${days !== null ? ` (${days} days left)` : ""}. ` : "This gifted membership has ended. Your account and bids are still yours. "}
        This is your own account. Your mentor only sees the bids you share, with the details you choose, and never your customers&apos; names or contact details.
      </p>
      <div className="mt-4"><Flash msg={msg} err={err} /></div>

      {active && (
        <>
          <Card className="mt-4 p-5">
            <h2 className="font-bold">What your mentor can do</h2>
            <form action={saveConsent} className="mt-3 grid gap-3">
              <input type="hidden" name="programId" value={m.program_id} />
              {CONSENT_PERMISSIONS.map((p) => {
                const on = p.key === "allowComments" ? m.consent?.allow_comments : p.key === "allowSuggestions" ? m.consent?.allow_suggestions : m.consent?.share_pipeline_summary;
                return <label key={p.key} className="flex items-start gap-2 text-sm"><input type="checkbox" name={p.key} defaultChecked={Boolean(on)} className="mt-1" /><span><span className="font-semibold">{p.label}</span><br /><span className="text-ink-soft">{p.help}</span></span></label>;
              })}
              <div><button className={btn}>Save</button></div>
            </form>
          </Card>

          <Card className="mt-4 p-5">
            <h2 className="font-bold">Share a bid for feedback</h2>
            <form action={shareBid} className="mt-3 grid gap-3">
              <input type="hidden" name="programId" value={m.program_id} />
              <label className="grid gap-1 text-sm font-medium">Bid
                <select name="estimateId" required className={input} defaultValue={typeof sp.estimate === "string" ? sp.estimate : ""}>
                  <option value="" disabled>Choose a bid</option>
                  {(bids ?? []).map((b) => <option key={b.id} value={b.id}>{b.title || "Untitled bid"} · {fmtDate(b.updated_at)}</option>)}
                </select>
              </label>
              {SHARE_PERMISSIONS.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm">
                  {"always" in p ? <input type="checkbox" checked disabled className="mt-1" /> : <input type="checkbox" name={p.key} className="mt-1" />}
                  <span><span className="font-semibold">{p.label}</span>{"always" in p ? " (always included)" : ""}<br /><span className="text-ink-soft">{p.help}</span></span>
                </label>
              ))}
              <p className="text-xs text-ink-soft">Sharing the same bid again updates what&apos;s included. Your mentor can never edit your bid.</p>
              <div><button className={btn}>Share with my mentor</button></div>
            </form>
          </Card>
        </>
      )}

      <h2 className="mt-6 font-bold">Shared bids</h2>
      {m.shares.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing shared.</p> : (
        <div className="mt-2 grid gap-2">
          {m.shares.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <Link href={`/mentorship/shares/${s.id}`} className="font-semibold underline">{s.title || "Untitled bid"}</Link>
                <p className="mt-1 flex flex-wrap gap-1"><Badge>Proposal</Badge>{s.share_costs && <Badge>Costs</Badge>}{s.share_margin && <Badge>Margin</Badge>}{s.share_project_info && <Badge>Project info</Badge>}{s.unread > 0 && <Badge tone="accent">{s.unread} new note{s.unread === 1 ? "" : "s"}</Badge>}</p>
              </div>
              <form action={unshareBid}><input type="hidden" name="shareId" value={s.id} /><button className="text-sm font-semibold text-danger underline">Stop sharing</button></form>
            </Card>
          ))}
        </div>
      )}

      {resources.length > 0 && (
        <>
          <h2 className="mt-6 font-bold">Resources from your mentor</h2>
          <div className="mt-2 grid gap-2">
            {resources.map((r) => (
              <Card key={r.id} className="p-4">
                <p className="font-semibold">{r.title}</p>
                {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm underline break-all">{r.url}</a>}
                {r.body && <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>}
                {r.checklist && <ul className="mt-1 list-disc pl-5 text-sm">{r.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
