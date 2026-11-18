import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { Flash, btn, btnSecondary, fmtDate, input } from "@/components/creator/flash";
import { GIFT_STATE_LABELS, GIFT_STATE_TONES, PROGRAM_NAME, PROGRAM_STATE_LABELS, daysRemaining, type GiftState, type ProgramState } from "@/lib/creator/program";
import { confirmTerms, deleteResource, revokeGift, saveResource } from "./actions";
import { InviteForm, RotateButton } from "./gift-forms";

export const metadata: Metadata = { title: "Learning Enterprise", robots: { index: false } };

type ProgramSummary = { id: string; workspace_name: string; channel_name: string | null; state: ProgramState; gift_allowance: number; seats_used: number; starts_at: string | null; expires_at: string | null; creator_confirmed_at: string | null; terms_version: string | null };
type Gift = { id: string; email: string; display_name: string | null; state: GiftState; invited_at: string; invite_expires_at: string | null; claimed_at: string | null; business_name: string | null; primary_trade: string | null; last_engagement: string | null; shared_count: number; consent: { allow_comments: boolean; allow_suggestions: boolean; share_pipeline_summary: boolean } | null };
type Dashboard = { program: ProgramSummary; gifts: Gift[]; shares_awaiting_review: number; comments_30d: number };
type Share = { id: string; participant: string; business_name: string | null; title: string | null; trades: string[] | null; updated_at: string; share_costs: boolean; share_margin: boolean; share_project_info: boolean; total: string | number | null; comment_count: number; reviewed: boolean };
type Resource = { id: string; kind: "link" | "note" | "checklist"; title: string; url: string | null; body: string | null; checklist: string[] | null; sort_order: number };

const TABS = [["overview", "Overview"], ["team", "Team"], ["shares", "Shared bids"], ["pipeline", "Pipeline"], ["resources", "Resources"], ["settings", "Settings"]] as const;
type Tab = (typeof TABS)[number][0];
const STAGE_NAMES: Record<string, string> = { draft: "Draft", ready_for_review: "Ready for review", approved: "Approved", sent: "Sent", viewed: "Viewed", follow_up: "Follow-up", won: "Won", lost: "Lost", on_hold: "On hold" };
const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export default async function LearningPage({ searchParams }: PageProps<"/learning">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const user = await getUser();
  if (!user) redirect("/login?next=/learning");
  const db = await createClient();
  const { data: list, error: listError } = await db.rpc("my_creator_programs");
  const programs = (listError ? [] : (list ?? [])) as ProgramSummary[];
  if (!programs.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-extrabold">{PROGRAM_NAME}</h1>
        <Notice className="mt-4">Learning Enterprise is an invitation-only program for Built2Bid creator partners. There isn&apos;t a program on this account.</Notice>
      </div>
    );
  }
  const program = programs.find((p) => p.id === str("program")) ?? programs[0];
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(str("tab") ?? "") ? (str("tab") as Tab) : "overview";
  const href = (t: Tab, extra: Record<string, string> = {}) => `/learning?${new URLSearchParams({ program: program.id, tab: t, ...extra })}`;

  if (program.state !== "active") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-extrabold">{program.workspace_name}</h1>
        <Notice className="mt-4" tone="warn" title={PROGRAM_STATE_LABELS[program.state]}>
          {program.state === "awaiting_activation" ? "Accept your complimentary Team invitation (sent with your private link) to start the 12-month program." : `This program ended ${fmtDate(program.expires_at)}. Your own account and bids are unaffected.`}
        </Notice>
      </div>
    );
  }

  if (!program.creator_confirmed_at) {
    return (
      <div className="mx-auto max-w-2xl">
        <Flash msg={str("msg")} err={str("err")} />
        <h1 className="mt-2 text-2xl font-extrabold">Welcome to {PROGRAM_NAME}</h1>
        <Card className="mt-4 p-5 text-sm leading-relaxed">
          <p className="font-semibold">Before you invite anyone, please confirm the program terms ({program.terms_version ?? "pilot"}):</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Your Team access is complimentary for 12 months, through {fmtDate(program.expires_at)}. No payment details are needed and nothing renews automatically.</li>
            <li>You can gift up to {program.gift_allowance} complimentary Unlimited memberships. Gifts end no later than your program.</li>
            <li>Each person you invite gets their own independent account and company profile. They are not part of your company, and you never own or access their data.</li>
            <li>You only see a bid when the participant chooses to share it, with the details they choose. Customer names and contact details are never shared.</li>
            <li>Comments and suggestions are notes. Nothing you write ever changes a participant&apos;s bid.</li>
            <li>Built2Bid may end the program for misuse; your own bids remain yours.</li>
          </ul>
          <form action={confirmTerms} className="mt-5 grid gap-3">
            <input type="hidden" name="programId" value={program.id} />
            <label className="flex items-start gap-2"><input type="checkbox" name="agree" className="mt-1" required /> I&apos;ve read and agree to these terms.</label>
            <div><button className={btn}>Confirm and open my workspace</button></div>
          </form>
        </Card>
      </div>
    );
  }

  const { data: dashData, error: dashError } = await db.rpc("creator_dashboard", { p_program_id: program.id });
  if (dashError || !dashData) return <Notice tone="danger">Couldn&apos;t load your workspace. Try again shortly.</Notice>;
  const dash = dashData as Dashboard;
  const seatsLeft = Math.max(0, dash.program.gift_allowance - dash.program.seats_used);
  const active = dash.gifts.filter((g) => g.state === "active");
  const pending = dash.gifts.filter((g) => g.state === "invited" || g.state === "invite_expired");
  const days = daysRemaining(dash.program.expires_at);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">{PROGRAM_NAME}</p>
          <h1 className="text-2xl font-extrabold">{dash.program.workspace_name}</h1>
        </div>
        {programs.length > 1 && (
          <div className="flex gap-2 text-sm">{programs.map((p) => <Link key={p.id} href={`/learning?program=${p.id}`} className={p.id === program.id ? "font-bold underline" : "underline"}>{p.workspace_name}</Link>)}</div>
        )}
      </div>
      <nav aria-label="Learning Enterprise" className="mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href(k)} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap px-3 py-2 text-sm font-semibold ${tab === k ? "border-b-2 border-ink" : "text-ink-soft"}`}>{label}</Link>
        ))}
      </nav>
      <div className="mt-4"><Flash msg={str("msg")} err={str("err")} /></div>

      {tab === "overview" && (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Gift memberships" value={`${dash.program.seats_used} of ${dash.program.gift_allowance}`} hint={`${seatsLeft} available`} />
            <Stat label="Active participants" value={String(active.length)} hint={`${pending.length} invitation${pending.length === 1 ? "" : "s"} open`} />
            <Stat label="Bids awaiting review" value={String(dash.shares_awaiting_review)} hint={`${dash.comments_30d} notes in 30 days`} />
            <Stat label="Program ends" value={fmtDate(dash.program.expires_at)} hint={days !== null ? `${days} days left` : ""} />
          </div>
          <Card className="p-5">
            <h2 className="font-bold">Get started</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li><Link className="underline" href="/welcome">Set up your company branding</Link> for your own proposals.</li>
              <li><Link className="underline" href={href("team")}>Invite up to {dash.program.gift_allowance} people</Link> to their own complimentary Unlimited account.</li>
              <li><Link className="underline" href={href("resources")}>Add resources</Link> (links, notes, checklists) your team can see.</li>
              <li>Review the <Link className="underline" href={href("shares")}>bids participants share</Link> with you.</li>
            </ol>
          </Card>
        </div>
      )}

      {tab === "team" && (
        <div className="mt-4 grid gap-4">
          <Card className="p-5">
            <h2 className="font-bold">Invite someone ({seatsLeft} of {dash.program.gift_allowance} available)</h2>
            <p className="mt-1 text-sm text-ink-soft">Built2Bid doesn&apos;t email anyone for you. You&apos;ll get a private, single-use link to send yourself.</p>
            <div className="mt-3">
              <InviteForm programId={program.id} seatsLeft={seatsLeft} replaces={str("replace") ? { id: str("replace")!, label: "a removed participant" } : undefined} />
            </div>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper text-xs uppercase text-ink-soft"><tr><th className="p-3">Person</th><th className="p-3">Status</th><th className="p-3">Sharing</th><th className="p-3">Last activity</th><th className="p-3">Actions</th></tr></thead>
              <tbody>
                {dash.gifts.length === 0 && <tr><td colSpan={5} className="p-4 text-ink-soft">No one invited yet.</td></tr>}
                {dash.gifts.map((g) => (
                  <tr key={g.id} className="border-t border-line align-top">
                    <td className="p-3"><p className="font-semibold">{g.display_name || g.business_name || g.email}</p><p className="text-xs text-ink-soft">{g.business_name && g.display_name ? `${g.business_name} · ` : ""}{g.primary_trade ?? ""}</p><p className="text-xs text-ink-soft">{g.email}</p></td>
                    <td className="p-3"><Badge tone={GIFT_STATE_TONES[g.state]}>{GIFT_STATE_LABELS[g.state]}</Badge><p className="mt-1 text-xs text-ink-soft">{g.claimed_at ? `Joined ${fmtDate(g.claimed_at)}` : `Link expires ${fmtDate(g.invite_expires_at)}`}</p></td>
                    <td className="p-3 text-xs">{g.state === "active" ? (<>{g.shared_count} bid{g.shared_count === 1 ? "" : "s"} shared<br />{g.consent?.allow_comments ? "Comments on" : "Comments off"} · {g.consent?.allow_suggestions ? "Suggestions on" : "Suggestions off"}<br />{g.consent?.share_pipeline_summary ? <Link className="underline" href={href("pipeline", { gift: g.id })}>Pipeline shared</Link> : "Pipeline private"}</>) : "—"}</td>
                    <td className="p-3 text-xs">{fmtDate(g.last_engagement)}</td>
                    <td className="p-3">
                      <div className="grid gap-2">
                        {(g.state === "invited" || g.state === "invite_expired") && <RotateButton giftId={g.id} />}
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-danger">{g.claimed_at ? "Remove" : "Cancel invitation"}</summary>
                          <form action={revokeGift} className="mt-2 grid gap-2">
                            <input type="hidden" name="programId" value={program.id} />
                            <input type="hidden" name="giftId" value={g.id} />
                            <input name="reason" maxLength={300} placeholder="Reason (optional, private)" className={input} />
                            <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5" />{g.claimed_at ? "End their complimentary Unlimited now. They keep their account and bids. They can't be re-gifted in this program." : "Cancel this invitation. The link stops working."}</label>
                            <button className={btnSecondary}>Confirm</button>
                          </form>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-ink-soft">Removing someone frees the seat so you can invite a replacement. A replacement&apos;s membership still ends with your program on {fmtDate(dash.program.expires_at)}.</p>
        </div>
      )}

      {tab === "shares" && <SharesTab programId={program.id} />}
      {tab === "pipeline" && <PipelineTab programId={program.id} gifts={active} giftId={str("gift")} href={(g) => href("pipeline", { gift: g })} />}
      {tab === "resources" && <ResourcesTab programId={program.id} />}

      {tab === "settings" && (
        <Card className="mt-4 p-5 text-sm">
          <h2 className="font-bold">Program details</h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><dt className="text-ink-soft">Workspace</dt><dd>{dash.program.workspace_name}</dd></div>
            <div><dt className="text-ink-soft">Channel</dt><dd>{dash.program.channel_name ?? "—"}</dd></div>
            <div><dt className="text-ink-soft">Started</dt><dd>{fmtDate(dash.program.starts_at)}</dd></div>
            <div><dt className="text-ink-soft">Ends</dt><dd>{fmtDate(dash.program.expires_at)}</dd></div>
            <div><dt className="text-ink-soft">Terms</dt><dd>{dash.program.terms_version} · confirmed {fmtDate(dash.program.creator_confirmed_at)}</dd></div>
            <div><dt className="text-ink-soft">Gift allowance</dt><dd>{dash.program.gift_allowance}</dd></div>
          </dl>
          <p className="mt-4 text-ink-soft">Your company branding and proposals are managed in <Link className="underline" href="/settings/company">Company profile</Link>. To change the gift allowance or program dates, contact Built2Bid.</p>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card className="p-4"><p className="text-xs font-semibold uppercase text-ink-soft">{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p>{hint && <p className="text-xs text-ink-soft">{hint}</p>}</Card>;
}

async function SharesTab({ programId }: { programId: string }) {
  const db = await createClient();
  const { data, error } = await db.rpc("creator_shares", { p_program_id: programId });
  if (error) return <Notice tone="danger" className="mt-4">Couldn&apos;t load shared bids.</Notice>;
  const shares = (data ?? []) as Share[];
  if (!shares.length) return <Notice className="mt-4">No bids shared yet. Participants choose which bids to share, and what to include.</Notice>;
  return (
    <div className="mt-4 grid gap-3">
      {shares.map((s) => (
        <Link key={s.id} href={`/learning/shares/${s.id}`} className="block">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4 hover:border-line-strong">
            <div>
              <p className="font-semibold">{s.title ?? "Untitled bid (project details not shared)"}</p>
              <p className="text-xs text-ink-soft">{s.participant}{s.business_name && s.business_name !== s.participant ? ` · ${s.business_name}` : ""} · updated {fmtDate(s.updated_at)}</p>
              <p className="mt-1 flex flex-wrap gap-1"><Badge>Proposal</Badge>{s.share_costs && <Badge>Costs</Badge>}{s.share_margin && <Badge>Margin</Badge>}{s.share_project_info && <Badge>Project info</Badge>}</p>
            </div>
            <div className="text-right"><p className="font-bold">{money(s.total)}</p><Badge tone={s.reviewed ? "ok" : "accent"}>{s.reviewed ? `${s.comment_count} notes` : "Awaiting review"}</Badge></div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function PipelineTab({ programId, gifts, giftId, href }: { programId: string; gifts: Gift[]; giftId?: string; href: (g: string) => string }) {
  const shared = gifts.filter((g) => g.consent?.share_pipeline_summary);
  if (!shared.length) return <Notice className="mt-4">No participant has shared their pipeline summary. It&apos;s optional, counts only, and they can turn it off any time.</Notice>;
  const selected = shared.find((g) => g.id === giftId) ?? shared[0];
  const db = await createClient();
  const { data, error } = await db.rpc("creator_pipeline_summary", { p_program_id: programId, p_gift_id: selected.id });
  const s = (data ?? {}) as { by_stage?: Record<string, number>; sent_90d?: number; won_90d?: number; lost_90d?: number; created_90d?: number };
  return (
    <div className="mt-4 grid gap-4">
      <div className="flex flex-wrap gap-2 text-sm">{shared.map((g) => <Link key={g.id} href={href(g.id)} className={g.id === selected.id ? "font-bold underline" : "underline"}>{g.display_name || g.business_name || g.email}</Link>)}</div>
      {error ? <Notice tone="danger">This summary is no longer shared.</Notice> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Bids created (90d)" value={String(s.created_90d ?? 0)} />
            <Stat label="Sent (90d)" value={String(s.sent_90d ?? 0)} />
            <Stat label="Won (90d)" value={String(s.won_90d ?? 0)} />
            <Stat label="Lost (90d)" value={String(s.lost_90d ?? 0)} />
          </div>
          <Card className="p-4">
            <h2 className="font-bold">Open bids by stage</h2>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-3">{Object.entries(s.by_stage ?? {}).map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span>{STAGE_NAMES[k] ?? k}</span><span className="font-semibold">{n}</span></li>)}</ul>
            <p className="mt-3 text-xs text-ink-soft">Counts only. No customer names, addresses or amounts are shared.</p>
          </Card>
        </>
      )}
    </div>
  );
}

async function ResourcesTab({ programId }: { programId: string }) {
  const db = await createClient();
  const { data } = await db.rpc("program_resources", { p_program_id: programId });
  const resources = (data ?? []) as Resource[];
  return (
    <div className="mt-4 grid gap-4">
      {resources.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{r.title} <Badge>{r.kind}</Badge></p>
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm underline break-all">{r.url}</a>}
              {r.body && <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>}
              {r.checklist && <ul className="mt-1 list-disc pl-5 text-sm">{r.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </div>
            <form action={deleteResource}><input type="hidden" name="programId" value={programId} /><input type="hidden" name="id" value={r.id} /><button className="text-sm font-semibold text-danger underline">Delete</button></form>
          </div>
        </Card>
      ))}
      <Card className="p-5">
        <h2 className="font-bold">Add a resource</h2>
        <form action={saveResource} className="mt-3 grid gap-3">
          <input type="hidden" name="programId" value={programId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-medium">Type<select name="kind" className={input}><option value="link">Link (video, playlist, download)</option><option value="note">Note</option><option value="checklist">Checklist</option></select></label>
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">Title<input name="title" required maxLength={200} className={input} /></label>
          </div>
          <label className="grid gap-1 text-sm font-medium">Link (https://)<input name="url" type="url" className={input} /></label>
          <label className="grid gap-1 text-sm font-medium">Note<textarea name="body" rows={3} maxLength={4000} className={input} /></label>
          <label className="grid gap-1 text-sm font-medium">Checklist items (one per line)<textarea name="checklist" rows={3} className={input} /></label>
          <div><button className={btn}>Save resource</button></div>
        </form>
      </Card>
    </div>
  );
}
